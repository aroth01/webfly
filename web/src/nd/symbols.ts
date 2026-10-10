// ND symbology (spec §9.3). Every symbol is drawn centred on (x, y) in CSS pixels.

export const COLORS = {
  white: '#ffffff',
  green: '#00ff00',
  cyan: '#00ffff',
  magenta: '#ff2cff',
  amber: '#ffb000',
  yellow: '#ffff00',
  trail: '#666666',
} as const;

type Ctx = CanvasRenderingContext2D;

function polygon(ctx: Ctx, pts: Array<[number, number]>): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
}

/** Route waypoint: a four-pointed star. */
export function waypointStar(ctx: Ctx, x: number, y: number, color: string, r = 7): void {
  const k = r * 0.28;
  polygon(ctx, [
    [x, y - r],
    [x + k, y - k],
    [x + r, y],
    [x + k, y + k],
    [x, y + r],
    [x - k, y + k],
    [x - r, y],
    [x - k, y - k],
  ]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.stroke();
}

function hexagon(ctx: Ctx, x: number, y: number, r: number): void {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    pts.push([x + r * Math.cos(a), y + r * Math.sin(a)]);
  }
  polygon(ctx, pts);
  ctx.stroke();
}

/** Database navaid by type: VOR hexagon, VOR/DME boxed, VORTAC/TACAN with tabs, DME box, NDB dotted circle. */
export function navaidSymbol(ctx: Ctx, x: number, y: number, type: string, color: string): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.4;
  const r = 5;
  if (type === 'NDB' || type === 'NDB/DME') {
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI / 5) * i;
      ctx.beginPath();
      ctx.arc(x + 6 * Math.cos(a), y + 6 * Math.sin(a), 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, 1.4, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (type === 'DME') {
    ctx.strokeRect(x - r, y - r, 2 * r, 2 * r);
    return;
  }
  hexagon(ctx, x, y, r);
  ctx.beginPath();
  ctx.arc(x, y, 1, 0, Math.PI * 2);
  ctx.fill();
  if (type === 'VOR/DME') ctx.strokeRect(x - r - 2, y - r - 1, 2 * r + 4, 2 * r + 2);
  if (type === 'VORTAC' || type === 'TACAN') {
    // Three tabs on alternate sides of the hexagon.
    for (const side of [1, 3, 5]) {
      const a = (Math.PI / 3) * side + Math.PI / 6;
      ctx.save();
      ctx.translate(x + (r + 2) * Math.cos(a), y + (r + 2) * Math.sin(a));
      ctx.rotate(a + Math.PI / 2);
      ctx.fillRect(-3, -1.5, 6, 3);
      ctx.restore();
    }
  }
}

/** Airport: a star inside a circle. */
export function airportSymbol(ctx: Ctx, x: number, y: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.stroke();
  waypointStar(ctx, x, y, color, 5);
}

/** TCAS-style traffic diamond: hollow, or filled when proximate. */
export function trafficSymbol(ctx: Ctx, x: number, y: number, proximate: boolean): void {
  const r = 6;
  polygon(ctx, [
    [x, y - r],
    [x + r, y],
    [x, y + r],
    [x - r, y],
  ]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = COLORS.white;
  ctx.fillStyle = COLORS.white;
  if (proximate) ctx.fill();
  else ctx.stroke();
}

/** Vertical arrow beside a traffic symbol. */
export function trendArrow(ctx: Ctx, x: number, y: number, dir: 'up' | 'down'): void {
  const s = dir === 'up' ? -1 : 1;
  ctx.strokeStyle = COLORS.white;
  ctx.fillStyle = COLORS.white;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y - 6 * s);
  ctx.lineTo(x, y + 4 * s);
  ctx.stroke();
  polygon(ctx, [
    [x, y + 7 * s],
    [x - 3, y + 3 * s],
    [x + 3, y + 3 * s],
  ]);
  ctx.fill();
}

/** Own aircraft: the fixed yellow airplane symbol, its wings on the arc centre. */
export function ownAircraft(ctx: Ctx, x: number, y: number, scale = 1): void {
  ctx.strokeStyle = COLORS.yellow;
  ctx.lineWidth = 3.5 * scale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y - 10 * scale);
  ctx.lineTo(x, y + 22 * scale);
  ctx.moveTo(x - 20 * scale, y);
  ctx.lineTo(x + 20 * scale, y);
  ctx.moveTo(x - 7 * scale, y + 18 * scale);
  ctx.lineTo(x + 7 * scale, y + 18 * scale);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

/** Arrow pointing toward display angle `deg` (clockwise from up), centred on (x, y). */
export function directionArrow(ctx: Ctx, x: number, y: number, deg: number, len: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, len / 2);
  ctx.lineTo(0, -len / 2 + 4);
  ctx.stroke();
  polygon(ctx, [
    [0, -len / 2 - 1],
    [-4, -len / 2 + 6],
    [4, -len / 2 + 6],
  ]);
  ctx.fill();
  ctx.restore();
}
