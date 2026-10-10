import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LatLon } from '../../../shared/geo.ts';
import type { FlightView, LiveState } from '../../../shared/types.ts';
import { drawNd } from './draw.ts';
import { ndLayout } from './layout.ts';
import { MagVar } from './magvar.ts';
import { EasedAngle, Motion } from './motion.ts';
import { RANGES, stepRange } from './range.ts';
import { buildScene, densifyRoute } from './scene.ts';
import { tilesForCircle, type TileCache } from './tiles.ts';
import { findActiveLeg, toWaypoint } from './toWaypoint.ts';

export interface NavInfo {
  remainingNm?: number;
  destEtaMs?: number;
}

interface Props {
  flight: FlightView;
  live: LiveState | null;
  liveReceivedAt: number;
  trail: LatLon[];
  tiles: TileCache;
  range: number;
  onRange: (range: number) => void;
  onNavInfo?: (info: NavInfo) => void;
}

/** The ND canvas: redrawn every animation frame from the latest props, which live in a ref. */
export function NdView(props: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  const route = useMemo(() => densifyRoute(props.flight.route.points), [props.flight.route.points]);
  const routeRef = useRef(route);
  useLayoutEffect(() => {
    propsRef.current = props;
    routeRef.current = route;
  });
  const motion = useRef(new Motion());
  const [, setFontsReady] = useState(false);

  // New position reports feed the dead-reckoning model, timed by the client clock.
  useEffect(() => {
    const ac = props.live?.aircraft;
    if (!ac) return;
    const fix = { lat: ac.lat, lon: ac.lon, t: props.liveReceivedAt - ac.ageSec * 1000 } as Parameters<Motion['update']>[0];
    if (ac.gs !== undefined) fix.gs = ac.gs;
    if (ac.track !== undefined) fix.track = ac.track;
    motion.current.update(fix, Date.now());
  }, [props.live, props.liveReceivedAt]);

  useEffect(() => {
    motion.current.reset();
  }, [props.flight.callsign]);

  useEffect(() => {
    void document.fonts?.load('16px "B612 Mono"').then(() => setFontsReady(true));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let size = { w: 0, h: 0, dpr: 1 };
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      size = { w: Math.max(1, Math.round(rect.width)), h: Math.max(1, Math.round(rect.height)), dpr };
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
      canvas.style.width = `${size.w}px`;
      canvas.style.height = `${size.h}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const eased = new EasedAngle();
    const magVar = new MagVar();
    let activeLeg = 0;
    let lastFrame = Date.now();
    let lastInfo = 0;
    let raf = 0;

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const p = propsRef.current;
      const now = Date.now();
      const dt = now - lastFrame;
      lastFrame = now;
      const pos = motion.current.position(now);
      const ac = p.live?.aircraft ?? null;
      const points = p.flight.route.points;
      const up = eased.update(ac?.trueHeading ?? ac?.track ?? eased.value ?? 0, dt);
      if (pos) activeLeg = findActiveLeg(points, pos, activeLeg);
      const center = pos ?? p.flight.origin ?? points[0] ?? { lat: 39, lon: -98 };
      const ageMs = motion.current.ageMs(now);
      const scene = buildScene({
        now,
        flight: p.flight,
        live: ac,
        traffic: p.live?.traffic ?? [],
        trail: p.trail,
        tiles: p.tiles.get(p.flight.navCycle, tilesForCircle(center, p.range)),
        range: p.range,
        route: routeRef.current,
        ownPos: pos,
        upTrue: up,
        magVar: magVar.get(center),
        activeLeg,
        ...(ageMs !== undefined ? { posAgeSec: ageMs / 1000 } : {}),
      });
      ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      drawNd(ctx, ndLayout(size.w, size.h), scene);

      if (p.onNavInfo && now - lastInfo > 1000) {
        lastInfo = now;
        const to = pos && toWaypoint(points, pos, activeLeg, ac?.gs, now);
        const info: NavInfo = {};
        if (to) info.remainingNm = to.remainingNm;
        if (to?.destEtaMs !== undefined) info.destEtaMs = to.destEtaMs;
        p.onNavInfo(info);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  // Pinch to zoom (two pointers) and the mouse wheel step through the ranges.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef(0);
  const lastWheel = useRef(0);
  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const zoom = (dir: 1 | -1) => props.onRange(stepRange(propsRef.current.range, dir));

  return (
    <div className="nd" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        aria-label={`Navigation display, ${props.range} nautical mile range`}
        role="img"
        onPointerDown={(e) => {
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 2) pinchStart.current = spread();
        }}
        onPointerMove={(e) => {
          if (!pointers.current.has(e.pointerId)) return;
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size !== 2 || pinchStart.current === 0) return;
          const ratio = spread() / pinchStart.current;
          if (ratio > 1.35 || ratio < 0.74) {
            zoom(ratio > 1 ? -1 : 1);
            pinchStart.current = spread();
          }
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          pinchStart.current = 0;
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          pinchStart.current = 0;
        }}
        onWheel={(e) => {
          const now = Date.now();
          if (now - lastWheel.current < 250 || e.deltaY === 0) return;
          lastWheel.current = now;
          zoom(e.deltaY > 0 ? 1 : -1);
        }}
      />
      <div className="range-bar">
        <button type="button" className="range-btn" aria-label="Zoom in" disabled={props.range <= RANGES[0]} onClick={() => zoom(-1)}>
          −
        </button>
        <span className="range-value">{props.range} NM</span>
        <button type="button" className="range-btn" aria-label="Zoom out" disabled={props.range >= RANGES[RANGES.length - 1]!} onClick={() => zoom(1)}>
          +
        </button>
      </div>
    </div>
  );
}
