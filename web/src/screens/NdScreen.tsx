import { useEffect, useRef, useState } from 'react';
import type { FlightView, LiveState, Trail } from '../../../shared/types.ts';
import { drawNd, formatUtc } from '../nd/draw.ts';
import { easeAngle, PositionTracker } from '../nd/interpolate.ts';
import { MagVar } from '../nd/magvar.ts';
import { defaultRange, stepRange } from '../nd/ranges.ts';
import { buildScene, referenceFor } from '../nd/scene.ts';
import { useTiles } from '../nd/useTiles.ts';
import { navigate } from '../router.ts';
import type { DataSource } from '../source.ts';
import { useFlight } from '../useFlight.ts';
import { PickList } from './PickList.tsx';

const ROTATION_TAU_MS = 500;
const PINCH_IN = 1.35;
const PINCH_OUT = 0.74;

export function NdScreen({ query, source }: { query: string; source: DataSource }) {
  const state = useFlight(query, source);
  if (state.status === 'loading') return <main className="input-screen"><p className="cyan">LOADING {query.toUpperCase()}…</p></main>;
  if (state.status === 'error') {
    return (
      <main className="input-screen">
        <p className="amber" role="alert">{state.message}</p>
        <button type="button" className="back" onClick={() => navigate('/')}>← NEW SEARCH</button>
      </main>
    );
  }
  if (state.status === 'choices') return <PickList choices={state.choices} query={query} />;
  return <NdView flight={state.flight} live={state.live} trail={state.trail} source={source} />;
}

function formatAlt(live: LiveState | null): string {
  const ac = live?.aircraft;
  if (!ac) return '';
  if (ac.onGround) return 'GND';
  if (ac.altBaro === undefined) return '';
  return ac.altBaro >= 18_000 ? `FL${String(Math.round(ac.altBaro / 100)).padStart(3, '0')}` : `${Math.round(ac.altBaro).toLocaleString('en-US')} FT`;
}

function routeBadge(flight: FlightView): string {
  const { source, partial, amendedAt } = flight.route;
  const base = source === 'filed' ? 'FILED ROUTE' : source === 'expected' ? 'EXPECTED ROUTE' : 'NO FILED ROUTE';
  const amended = source === 'filed' && amendedAt !== undefined ? ` · amended ${formatUtc(amendedAt * 1000)}Z` : '';
  return `${base}${partial && source !== 'none' ? ' · PARTIAL' : ''}${amended}`;
}

function NdView({ flight, live, trail, source }: { flight: FlightView; live: LiveState | null; trail: Trail; source: DataSource }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tracker = useRef(new PositionTracker());
  const magvar = useRef(new MagVar());
  const eased = useRef<number | null>(null);
  const legIdx = useRef(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchBase = useRef(0);
  const [userRange, setUserRange] = useState<number | null>(null);
  const tiles = useTiles(source, flight.navCycle);

  const range = userRange ?? defaultRange(live?.aircraft?.altBaro);
  // The animation loop reads the latest props through a ref instead of restarting on every poll.
  const latest = useRef({ flight, live, trail, range, tiles });
  latest.current = { flight, live, trail, range, tiles };

  useEffect(() => {
    const ac = live?.aircraft;
    if (ac) tracker.current.push({ lat: ac.lat, lon: ac.lon, ...(ac.track !== undefined ? { track: ac.track } : {}), ...(ac.gs !== undefined ? { gs: ac.gs } : {}), ageSec: ac.ageSec }, Date.now());
  }, [live]);

  useEffect(() => {
    legIdx.current = 0; // a new or amended route restarts the active-leg search
  }, [flight.route.points]);

  useEffect(() => {
    const canvas = canvasRef.current as HTMLCanvasElement;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    let raf = 0;
    let last = performance.now();
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(250, t - last);
      last = t;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const v = latest.current;
      const now = Date.now();
      const pos = tracker.current.hasFix ? tracker.current.at(now) : null;
      const ref = referenceFor(v.live, pos);
      if (ref.mode === 'N') eased.current = null;
      else eased.current = eased.current === null ? ref.target : easeAngle(eased.current, ref.target, dt, ROTATION_TAU_MS);

      const origin = v.flight.origin ?? v.flight.dest;
      const center = pos ?? (origin ? { lat: origin.lat, lon: origin.lon } : null);
      const tileList = center ? (v.tiles.ensure(center.lat, center.lon, v.range), v.tiles.get(center.lat, center.lon, v.range)) : [];
      const scene = buildScene({
        flight: v.flight,
        live: v.live,
        pos,
        ...(eased.current !== null ? { easedRefTrue: eased.current } : {}),
        varEast: center ? magvar.current.get(center, new Date(now)) : 0,
        rangeNm: v.range,
        prevLegIdx: legIdx.current,
        nowMs: now,
        tiles: tileList,
        trail: v.trail,
      });
      if (scene.toIdx !== null) legIdx.current = Math.max(0, scene.toIdx - 1);
      drawNd(ctx, w, h, scene);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) pinchBase.current = pinchDistance(pointers.current);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size !== 2 || pinchBase.current === 0) return;
    const ratio = pinchDistance(pointers.current) / pinchBase.current;
    // Spreading the fingers zooms in, which is a smaller range.
    if (ratio > PINCH_IN) {
      setUserRange((r) => stepRange(r ?? latest.current.range, -1));
      pinchBase.current = pinchDistance(pointers.current);
    } else if (ratio < PINCH_OUT) {
      setUserRange((r) => stepRange(r ?? latest.current.range, 1));
      pinchBase.current = pinchDistance(pointers.current);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    pinchBase.current = 0;
  };

  const ac = live?.aircraft;
  return (
    <div className="nd-screen">
      <div className="nd-wrap" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <canvas ref={canvasRef} aria-label={`Navigation display for ${flight.callsign}`} />
        {flight.degraded === 'swim_delayed' && <div className="banner amber" role="status">Filed routes may be delayed</div>}
        <div className="range-controls">
          <button type="button" aria-label="Decrease range" onClick={() => setUserRange(stepRange(range, -1))}>−</button>
          <span className="cyan">{range} NM</span>
          <button type="button" aria-label="Increase range" onClick={() => setUserRange(stepRange(range, 1))}>+</button>
        </div>
        <button type="button" className="home" aria-label="New search" onClick={() => navigate('/')}>⌂</button>
      </div>
      <footer className="strip">
        <div className="strip-main">
          <strong>{flight.callsign}</strong>
          {flight.acType && <span>{flight.acType}</span>}
          <span>
            {flight.origin?.icao ?? '----'} → {flight.dest?.icao ?? '----'}
          </span>
          {ac && <span>{formatAlt(live)}</span>}
        </div>
        <div className="strip-route">{routeBadge(flight)}</div>
        <div className="strip-attr">adsb.lol (ODbL) · FAA NASR {flight.navCycle}</div>
      </footer>
    </div>
  );
}

function pinchDistance(p: Map<number, { x: number; y: number }>): number {
  const [a, b] = [...p.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}
