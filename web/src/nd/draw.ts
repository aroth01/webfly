import { destinationPoint, bearingDeg, distanceNm, distanceToSegmentNm, normalizeDeg, type LatLon } from '../../../shared/geo.ts';
import { project, projectAny, trueToMagnetic, type Geom, type Projected } from './projection.ts';
import type { Scene } from './scene.ts';

export const COLORS = {
  bg: '#000',
  white: '#fff',
  green: '#19ff5a',
  magenta: '#ff52ff',
  cyan: '#2fe6ff',
  yellow: '#ffd21f',
  amber: '#ffae1a',
  grey: '#666',
} as const;

/** The ARC display spans this many degrees either side of straight up. */
export const ARC_HALF_SPAN = 50;
const RAD = Math.PI / 180;

export interface NdLayout extends Geom {
  w: number;
  h: number;
  font: number; // px
}

/** Ownship at ~80% of ND height, centred; the compass arc radius is the selected range. */
export function ndLayout(w: number, h: number): NdLayout {
  const cy = h * 0.8;
  const font = Math.max(11, Math.min(15, w / 28));
  const radius = Math.max(40, Math.min(cy - font * 4.4, (w / 2 - 8) / Math.sin(ARC_HALF_SPAN * RAD)));
  return { w, h, cx: w / 2, cy, radius, font };
}

const mono = (px: number) => `${px}px "B612 Mono", ui-monospace, monospace`;
const pad2 = (n: number) => String(Math.round(n)).padStart(2, '0');
const fmt3 = (n: number) => String(Math.round(normalizeDeg(n)) % 360).padStart(3, '0');

/** Screen point on the compass arc at `deg` relative to straight up, at `r` pixels from ownship. */
const arcPoint = (L: Geom, r: number, deg: number) => ({ x: L.cx + Math.sin(deg * RAD) * r, y: L.cy - Math.cos(deg * RAD) * r });

export function drawNd(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene): void {
  const L = ndLayout(w, h);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'middle';

  const center = scene.center;
  if (!center) {
    text(ctx, 'NO POSITION', L.cx, L.cy * 0.6, COLORS.amber, mono(L.font * 1.3), 'center');
    return;
  }

  const refMag = trueToMagnetic(scene.refTrue, scene.varEast);
  const proj = (p: LatLon) => project(center, scene.refTrue, scene.rangeNm, L, p);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, L.cy + L.radius * 0.14);
  ctx.clip();
  ctx.beginPath();
  ctx.arc(L.cx, L.cy, L.radius * 1.02, 0, Math.PI * 2);
  ctx.clip();
  drawDbFeatures(ctx, scene, L, proj);
  drawTrail(ctx, scene, proj);
  drawRoute(ctx, scene, L, center);
  drawTraffic(ctx, scene, L, proj);
  ctx.restore();

  drawRangeArcs(ctx, scene, L);
  drawCompass(ctx, scene, L, refMag);
  if (scene.hasPosition) drawOwnship(ctx, L);
  drawBlocks(ctx, scene, L);
  drawMessages(ctx, scene, L);
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, font: string, align: CanvasTextAlign = 'left'): void {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(s, x, y);
}

function drawRangeArcs(ctx: CanvasRenderingContext2D, scene: Scene, L: NdLayout): void {
  ctx.save();
  ctx.strokeStyle = COLORS.white;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  for (const f of [0.25, 0.5, 0.75]) {
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, L.radius * f, (-90 - ARC_HALF_SPAN) * RAD, (-90 + ARC_HALF_SPAN) * RAD);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const f of [0.25, 0.5, 0.75]) {
    const v = scene.rangeNm * f;
    const label = Number.isInteger(v) ? String(v) : v.toFixed(1);
    const p = arcPoint(L, L.radius * f, -24);
    text(ctx, label, p.x, p.y, COLORS.cyan, mono(L.font * 0.9), 'center');
  }
  ctx.restore();
}

function drawCompass(ctx: CanvasRenderingContext2D, scene: Scene, L: NdLayout, refMag: number): void {
  ctx.save();
  ctx.strokeStyle = COLORS.white;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(L.cx, L.cy, L.radius, (-90 - ARC_HALF_SPAN) * RAD, (-90 + ARC_HALF_SPAN) * RAD);
  ctx.stroke();

  ctx.lineWidth = 1;
  const first = Math.ceil((refMag - ARC_HALF_SPAN) / 5) * 5;
  for (let m = first; m <= refMag + ARC_HALF_SPAN; m += 5) {
    const rel = m - refMag;
    const major = normalizeDeg(m) % 10 === 0;
    const a = arcPoint(L, L.radius, rel);
    const b = arcPoint(L, L.radius - (major ? 11 : 6), rel);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    if (normalizeDeg(m) % 30 === 0) {
      const t = arcPoint(L, L.radius - 24, rel);
      text(ctx, pad2(normalizeDeg(m) / 10), t.x, t.y, COLORS.white, mono(L.font), 'center');
    }
  }

  // Fixed yellow lubber line at the top of the arc.
  ctx.strokeStyle = COLORS.yellow;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(L.cx, L.cy - L.radius - 4);
  ctx.lineTo(L.cx, L.cy - L.radius + 13);
  ctx.stroke();

  // Reference label above the arc, and the green track diamond on it.
  const label = scene.mode === 'HDG' ? 'HDG' : scene.mode === 'TRK' ? 'TRK' : 'N-UP';
  const valueMag = scene.mode === 'N' ? undefined : refMag;
  text(ctx, label, L.cx - 4, L.cy - L.radius - L.font * 1.2, COLORS.white, mono(L.font * 0.9), 'right');
  text(ctx, valueMag === undefined ? '---' : fmt3(valueMag), L.cx + 4, L.cy - L.radius - L.font * 1.2, COLORS.green, mono(L.font * 0.95), 'left');

  if (scene.trackTrue !== undefined) {
    const rel = scene.mode === 'TRK' ? 0 : ((scene.trackTrue - scene.refTrue + 540) % 360) - 180;
    if (Math.abs(rel) <= ARC_HALF_SPAN) {
      const p = arcPoint(L, L.radius, rel);
      ctx.strokeStyle = COLORS.green;
      ctx.lineWidth = 2;
      diamond(ctx, p.x, p.y, 6);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
}

function star4(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 0.28, y - r * 0.28);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x + r * 0.28, y + r * 0.28);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r * 0.28, y + r * 0.28);
  ctx.lineTo(x - r, y);
  ctx.lineTo(x - r * 0.28, y - r * 0.28);
  ctx.closePath();
}

function hexagon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i * 60 - 90) * RAD;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawDbFeatures(ctx: CanvasRenderingContext2D, scene: Scene, L: NdLayout, proj: (p: LatLon) => Projected | null): void {
  const f = mono(L.font * 0.85);
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = COLORS.magenta;
  const detail = scene.rangeNm <= 160;
  for (const tile of scene.tiles) {
    if (detail) {
      for (const n of tile.navaids) {
        const p = proj(n);
        if (!p) continue;
        ctx.setLineDash([]);
        navaidSymbol(ctx, n.type, p.x, p.y);
        text(ctx, n.ident, p.x + 8, p.y - 7, COLORS.magenta, f);
      }
    }
    for (const a of tile.airports) {
      const p = proj(a);
      if (!p) continue;
      ctx.setLineDash([]);
      airportSymbol(ctx, p.x, p.y);
      if (detail) text(ctx, a.icao, p.x + 8, p.y + 8, COLORS.magenta, f);
    }
  }
  ctx.setLineDash([]);
}

function navaidSymbol(ctx: CanvasRenderingContext2D, type: string, x: number, y: number): void {
  ctx.strokeStyle = COLORS.magenta;
  if (type === 'NDB' || type === 'NDB/DME') {
    ctx.setLineDash([1.5, 2.5]);
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  if (type === 'DME') {
    ctx.strokeRect(x - 4, y - 4, 8, 8);
    return;
  }
  hexagon(ctx, x, y, 5.5);
  ctx.stroke();
  if (type !== 'VOR') {
    // VOR/DME, VORTAC and TACAN carry tabs on alternate sides of the hexagon.
    for (const a of [30, 150, 270]) {
      const px = x + Math.cos(a * RAD) * 7.5;
      const py = y + Math.sin(a * RAD) * 7.5;
      ctx.strokeRect(px - 2, py - 2, 4, 4);
    }
  }
  ctx.fillStyle = COLORS.magenta;
  ctx.fillRect(x - 1, y - 1, 2, 2);
}

function airportSymbol(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.strokeStyle = COLORS.magenta;
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 7, y);
  ctx.lineTo(x + 7, y);
  ctx.moveTo(x, y - 7);
  ctx.lineTo(x, y + 7);
  ctx.stroke();
}

function drawTrail(ctx: CanvasRenderingContext2D, scene: Scene, proj: (p: LatLon) => Projected | null): void {
  ctx.fillStyle = COLORS.grey;
  for (const [, lat, lon] of scene.trail) {
    const p = proj({ lat, lon });
    if (p) ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
  }
}

/** Points along the great circle a to b, at most `stepNm` apart (and at most 80 pieces). */
export function legPoints(a: LatLon, b: LatLon, stepNm = 15): LatLon[] {
  const len = distanceNm(a, b);
  const n = Math.max(1, Math.min(80, Math.ceil(len / stepNm)));
  if (n === 1 || len === 0) return [a, b];
  const brg = bearingDeg(a, b);
  const pts: LatLon[] = [a];
  for (let i = 1; i < n; i++) pts.push(destinationPoint(a, brg, (len * i) / n));
  pts.push(b);
  return pts;
}

function drawRoute(ctx: CanvasRenderingContext2D, scene: Scene, L: NdLayout, center: LatLon): void {
  const pts = scene.route;
  if (pts.length === 0) return;
  const range = scene.rangeNm;
  const toScreen = (p: LatLon) => projectAny(center, scene.refTrue, range, L, p);

  ctx.strokeStyle = COLORS.green;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (distanceToSegmentNm(center, a, b) > range * 1.3) continue;
    ctx.beginPath();
    legPoints(a, b).forEach((g, k) => {
      const s = toScreen(g);
      if (k === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.stroke();
  }

  const f = mono(L.font * 0.9);
  pts.forEach((pt, i) => {
    const s = project(center, scene.refTrue, range, L, pt);
    if (!s) return;
    const isTo = i === scene.toIdx;
    const color = isTo || pt.kind === 'airport' ? COLORS.white : COLORS.green;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    if (pt.kind === 'airport') airportSymbol(ctx, s.x, s.y);
    else {
      star4(ctx, s.x, s.y, 6.5);
      ctx.stroke();
    }
    text(ctx, pt.ident, s.x + 9, s.y - 8, color, f);
  });
}

/** Traffic within 6 nm and +/-1,200 ft is drawn filled (spec section 9.3). */
function drawTraffic(ctx: CanvasRenderingContext2D, scene: Scene, L: NdLayout, proj: (p: LatLon) => Projected | null): void {
  const f = mono(L.font * 0.85);
  ctx.strokeStyle = COLORS.white;
  ctx.fillStyle = COLORS.white;
  ctx.lineWidth = 1.5;
  for (const t of scene.traffic) {
    const p = proj(t);
    if (!p) continue;
    const dAlt = t.alt !== undefined && scene.ownAltFt !== undefined ? t.alt - scene.ownAltFt : undefined;
    const near = p.distNm < 6 && dAlt !== undefined && Math.abs(dAlt) <= 1200;
    diamond(ctx, p.x, p.y, 5.5);
    if (near) ctx.fill();
    else ctx.stroke();
    if (dAlt !== undefined) {
      const hundreds = Math.round(Math.abs(dAlt) / 100);
      const arrow = t.vs !== undefined && Math.abs(t.vs) > 500 ? (t.vs > 0 ? '↑' : '↓') : '';
      const label = `${dAlt < 0 ? '-' : '+'}${pad2(hundreds)}${arrow}`;
      text(ctx, label, p.x, p.y + (dAlt >= 0 ? -13 : 14), COLORS.white, f, 'center');
    }
  }
}

function drawOwnship(ctx: CanvasRenderingContext2D, L: NdLayout): void {
  ctx.save();
  ctx.strokeStyle = COLORS.yellow;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(L.cx, L.cy - 17);
  ctx.lineTo(L.cx, L.cy + 14);
  ctx.moveTo(L.cx - 14, L.cy + 5);
  ctx.lineTo(L.cx + 14, L.cy + 5);
  ctx.moveTo(L.cx - 6, L.cy + 14);
  ctx.lineTo(L.cx + 6, L.cy + 14);
  ctx.stroke();
  ctx.restore();
}

const dash = (n: number | undefined, f: (n: number) => string): string => (n === undefined || !Number.isFinite(n) ? '---' : f(n));

export function formatUtc(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function drawBlocks(ctx: CanvasRenderingContext2D, scene: Scene, L: NdLayout): void {
  const b = scene.blocks;
  const f = mono(L.font);
  const x0 = 8;
  const y1 = L.font * 0.9 + 4;
  const y2 = y1 + L.font * 1.35;

  text(ctx, 'GS', x0, y1, COLORS.white, f);
  text(ctx, dash(b.gs, (n) => String(Math.round(n))), x0 + L.font * 2.0, y1, COLORS.green, f);
  text(ctx, 'TAS', x0 + L.font * 5.2, y1, COLORS.white, f);
  text(ctx, dash(b.tas, (n) => String(Math.round(n))), x0 + L.font * 8.5, y1, COLORS.green, f);

  const wind = b.windDir === undefined || b.windSpd === undefined ? '---/--' : `${fmt3(b.windDir)}/${Math.round(b.windSpd)}`;
  text(ctx, wind, x0, y2, COLORS.green, f);
  if (b.windDir !== undefined && b.windSpd !== undefined) {
    const ax = x0 + L.font * 7.2;
    windArrow(ctx, ax, y2, normalizeDeg(b.windDir + 180 - scene.refTrue), L.font);
  }

  const xr = L.w - 8;
  text(ctx, b.toIdent ?? '---', xr, y1, COLORS.white, f, 'right');
  const brg = dash(b.toBrgMag, (n) => `${fmt3(n)}°`);
  const dist = dash(b.toDistNm, (n) => `${n < 100 ? n.toFixed(1) : Math.round(n)}NM`);
  text(ctx, `${brg} ${dist}`, xr, y2, COLORS.green, f, 'right');
  text(ctx, b.etaMs === undefined ? '--:--' : formatUtc(b.etaMs), xr, y2 + L.font * 1.35, COLORS.green, f, 'right');
}

function windArrow(ctx: CanvasRenderingContext2D, x: number, y: number, deg: number, font: number): void {
  const r = font * 0.6;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(deg * RAD);
  ctx.strokeStyle = COLORS.green;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, r);
  ctx.lineTo(0, -r);
  ctx.moveTo(-r * 0.5, -r * 0.35);
  ctx.lineTo(0, -r);
  ctx.lineTo(r * 0.5, -r * 0.35);
  ctx.stroke();
  ctx.restore();
}

function drawMessages(ctx: CanvasRenderingContext2D, scene: Scene, L: NdLayout): void {
  const f = mono(L.font * 1.1);
  let y = L.font * 0.9 + 4;
  const line = (s: string) => {
    text(ctx, s, L.cx, y, COLORS.amber, f, 'center');
    y += L.font * 1.4;
  };
  if (scene.staleSec !== null) line(`POS ${scene.staleSec}S OLD`);
  if (!scene.hasPosition) text(ctx, 'NO POSITION', L.cx, L.cy * 0.62, COLORS.amber, mono(L.font * 1.3), 'center');
  if (scene.routeSource === 'none') text(ctx, 'NO FILED ROUTE', L.cx, L.cy * 0.5, COLORS.amber, mono(L.font * 1.1), 'center');
}
