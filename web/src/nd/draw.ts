import { compassLabel, fmtBearing, fmtDist, fmtInt, fmtUtc, fmtWind } from './format.ts';
import { ARC_HALF_SPAN_DEG, type NdLayout } from './layout.ts';
import { angleDiff } from './motion.ts';
import { makeProjector, polar, type Project } from './projection.ts';
import type { Scene } from './scene.ts';
import { airportSymbol, COLORS, directionArrow, navaidSymbol, ownAircraft, trafficSymbol, trendArrow, waypointStar } from './symbols.ts';

type Ctx = CanvasRenderingContext2D;

const MONO = '"B612 Mono", ui-monospace, Menlo, monospace';
/** The compass arc and range arcs run a little past the nominal span so their ends meet the screen edge. */
const ARC_DRAW_DEG = ARC_HALF_SPAN_DEG + 8;
/** Route lines are projected without culling; the clip region trims them. */
const NO_CULL = 1e9;

const canvasAngle = (displayDeg: number) => ((displayDeg - 90) * Math.PI) / 180;

function text(ctx: Ctx, s: string, x: number, y: number, color: string, size: number, align: CanvasTextAlign = 'left'): number {
  ctx.font = `${size}px ${MONO}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
  return ctx.measureText(s).width;
}

/** Draw the whole ND for one frame. */
export function drawNd(ctx: Ctx, layout: NdLayout, scene: Scene): void {
  const { width, height, cx, cy, radius: r } = layout;
  const fs = Math.max(11, Math.min(17, r / 16));
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  const project = makeProjector(scene.center, scene.upTrue, scene.range, layout);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  drawRangeArcs(ctx, layout);
  drawTrail(ctx, scene, project);
  drawRouteLine(ctx, scene, project);
  drawDatabase(ctx, scene, project, fs);
  drawRoutePoints(ctx, scene, project, fs);
  drawTraffic(ctx, scene, project, fs);
  ctx.restore();

  drawCompass(ctx, layout, scene, fs);
  drawRangeLabel(ctx, layout, scene, fs);
  if (!scene.noPosition) ownAircraft(ctx, cx, cy, Math.max(0.75, Math.min(1.2, r / 250)));
  drawDataBlocks(ctx, layout, scene, fs);
  drawFlags(ctx, layout, scene, fs);
}

function drawRangeArcs(ctx: Ctx, l: NdLayout): void {
  ctx.strokeStyle = COLORS.white;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([6, 7]);
  for (const f of [0.25, 0.5, 0.75]) {
    ctx.beginPath();
    ctx.arc(l.cx, l.cy, l.radius * f, canvasAngle(-ARC_DRAW_DEG), canvasAngle(ARC_DRAW_DEG));
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawTrail(ctx: Ctx, scene: Scene, project: Project): void {
  ctx.fillStyle = COLORS.trail;
  for (const p of scene.trail) {
    const s = project(p);
    if (!s) continue;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRouteLine(ctx: Ctx, scene: Scene, project: Project): void {
  ctx.strokeStyle = COLORS.green;
  ctx.lineWidth = 2.2;
  ctx.lineJoin = 'round';
  for (const leg of scene.routeLine) {
    ctx.beginPath();
    leg.forEach((p, i) => {
      const s = project(p, NO_CULL) as { x: number; y: number };
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.stroke();
  }
}

function drawDatabase(ctx: Ctx, scene: Scene, project: Project, fs: number): void {
  const { declutter } = scene;
  for (const a of scene.airports) {
    const s = project(a);
    if (!s) continue;
    airportSymbol(ctx, s.x, s.y, COLORS.magenta);
    if (declutter.airportIdents) text(ctx, a.icao, s.x + 10, s.y - 7, COLORS.magenta, fs * 0.82);
  }
  for (const n of scene.navaids) {
    const s = project(n);
    if (!s) continue;
    navaidSymbol(ctx, s.x, s.y, n.type, COLORS.magenta);
    if (declutter.navaidIdents) text(ctx, n.ident, s.x + 10, s.y - 7, COLORS.magenta, fs * 0.82);
  }
}

function drawRoutePoints(ctx: Ctx, scene: Scene, project: Project, fs: number): void {
  for (const p of scene.routePoints) {
    const s = project(p);
    if (!s) continue;
    if (p.role === 'airport') {
      airportSymbol(ctx, s.x, s.y, COLORS.white);
      text(ctx, p.ident, s.x + 11, s.y - 8, COLORS.white, fs * 0.9);
      continue;
    }
    const color = p.role === 'to' ? COLORS.white : COLORS.green;
    waypointStar(ctx, s.x, s.y, color);
    text(ctx, p.ident, s.x + 10, s.y - 8, color, fs * 0.9);
  }
}

function drawTraffic(ctx: Ctx, scene: Scene, project: Project, fs: number): void {
  for (const t of scene.traffic) {
    const s = project(t);
    if (!s) continue;
    trafficSymbol(ctx, s.x, s.y, t.proximate);
    if (t.relAlt) text(ctx, t.relAlt, s.x, t.above ? s.y - 10 : s.y + 10 + fs * 0.8, COLORS.white, fs * 0.8, 'center');
    if (t.trend) trendArrow(ctx, s.x + 11, s.y, t.trend);
  }
}

function drawCompass(ctx: Ctx, l: NdLayout, scene: Scene, fs: number): void {
  const { radius: r } = l;
  ctx.strokeStyle = COLORS.white;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(l.cx, l.cy, r, canvasAngle(-ARC_DRAW_DEG), canvasAngle(ARC_DRAW_DEG));
  ctx.stroke();

  ctx.lineWidth = 1.6;
  for (let h = 0; h < 360; h += 5) {
    const d = angleDiff(scene.refMag, h);
    if (Math.abs(d) > ARC_DRAW_DEG) continue;
    const major = h % 10 === 0;
    const a = polar(l, d, r);
    const b = polar(l, d, r + (major ? 12 : 6));
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    if (h % 30 === 0) {
      const p = polar(l, d, r + 15);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((d * Math.PI) / 180);
      text(ctx, compassLabel(h), 0, 0, COLORS.white, fs * 1.05, 'center');
      ctx.restore();
    }
  }

  // Lubber line: the fixed reference at the top of the arc.
  ctx.strokeStyle = COLORS.yellow;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(l.cx, l.cy - r + 4);
  ctx.lineTo(l.cx, l.cy - r - 20);
  ctx.stroke();

  if (!scene.noPosition) {
    // Track diamond, on the inside of the arc.
    const d = scene.mode === 'HDG' ? (scene.trackDiamond ?? 0) : 0;
    const c = polar(l, d, r - 9);
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate((d * Math.PI) / 180);
    ctx.strokeStyle = COLORS.green;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(5, 0);
    ctx.lineTo(0, 6);
    ctx.lineTo(-5, 0);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  const label = scene.mode === 'NORTH' ? 'NORTH UP' : scene.mode;
  const y = l.top + fs * 1.1;
  if (scene.mode === 'NORTH') {
    text(ctx, label, l.cx, y, COLORS.white, fs * 0.85, 'center');
  } else {
    const value = fmtBearing(scene.refMag);
    ctx.font = `${fs * 0.85}px ${MONO}`;
    const w1 = ctx.measureText(`${label} `).width;
    ctx.font = `${fs}px ${MONO}`;
    const w2 = ctx.measureText(value).width;
    const x0 = l.cx - (w1 + w2) / 2;
    text(ctx, `${label} `, x0, y, COLORS.white, fs * 0.85);
    text(ctx, value, x0 + w1, y, COLORS.green, fs);
  }
}

function drawRangeLabel(ctx: Ctx, l: NdLayout, scene: Scene, fs: number): void {
  const half = scene.range / 2;
  const p = polar(l, -ARC_HALF_SPAN_DEG + 6, l.radius / 2);
  text(ctx, String(half), p.x - 4, p.y - 4, COLORS.cyan, fs * 0.9, 'right');
}

function drawDataBlocks(ctx: Ctx, l: NdLayout, scene: Scene, fs: number): void {
  const { data } = scene;
  const small = fs * 0.85;
  const line1 = l.top + fs * 1.1;
  const line2 = line1 + fs * 1.45;
  const line3 = line2 + fs * 1.45;

  let x = 8;
  x += text(ctx, 'GS ', x, line1, COLORS.white, small);
  x += text(ctx, fmtInt(data.gs), x, line1, COLORS.green, fs);
  x += text(ctx, '  TAS ', x, line1, COLORS.white, small);
  text(ctx, fmtInt(data.tas), x, line1, COLORS.green, fs);
  const ww = text(ctx, fmtWind(data.windDirMag, data.windSpd), 8, line2, COLORS.green, fs);
  if (data.windArrow !== undefined) directionArrow(ctx, 8 + ww / 2, line3 + 4, data.windArrow, 22, COLORS.green);

  if (data.to) {
    const right = l.width - 8;
    text(ctx, data.to.ident, right, line1, COLORS.white, fs * 1.05, 'right');
    const nm = text(ctx, 'NM', right, line2, COLORS.cyan, small, 'right');
    const dist = text(ctx, fmtDist(data.to.distNm), right - nm - 2, line2, COLORS.green, fs, 'right');
    text(ctx, `${fmtBearing(data.to.brgMag)}°`, right - nm - dist - fs * 0.9, line2, COLORS.green, fs, 'right');
    text(ctx, fmtUtc(data.to.etaMs), right, line3, COLORS.green, fs, 'right');
  }
}

function flag(ctx: Ctx, l: NdLayout, s: string, fs: number): void {
  const y = l.cy - l.radius * 0.55;
  ctx.font = `${fs * 1.1}px ${MONO}`;
  const w = ctx.measureText(s).width;
  ctx.fillStyle = '#000';
  ctx.fillRect(l.cx - w / 2 - 6, y - fs * 1.15, w + 12, fs * 1.6);
  text(ctx, s, l.cx, y, COLORS.amber, fs * 1.1, 'center');
}

function drawFlags(ctx: Ctx, l: NdLayout, scene: Scene, fs: number): void {
  if (scene.noPosition) flag(ctx, l, 'NO POSITION', fs);
  else if (scene.data.posOldSec !== undefined) flag(ctx, l, `POS ${scene.data.posOldSec}S OLD`, fs);
}
