import type { Trail } from '../../shared/types.ts';

type TracePoint = [number, number, number, number | 'ground' | null, ...unknown[]];

/**
 * Trim an adsb.lol readsb trace to the flight's current leg: the points after the last on-ground point
 * that belong to `callsign`. Detail objects (index 8) only appear when something changes, so the callsign
 * in force carries forward from point to point. Without a callsign, no filtering by callsign is done.
 */
export function trimTrail(trace: unknown, callsign?: string): Trail {
  const t = trace as { timestamp?: number; trace?: TracePoint[] } | null;
  if (!t || typeof t.timestamp !== 'number' || !Array.isArray(t.trace)) return [];
  const want = callsign?.trim().toUpperCase() || undefined;
  const mine: Trail = [];
  let lastGround = -1;
  let current: string | undefined;
  for (const p of t.trace) {
    const detail = p[8] as { flight?: string } | null | undefined;
    if (detail && typeof detail === 'object' && typeof detail.flight === 'string') current = detail.flight.trim().toUpperCase();
    if (want !== undefined && current !== undefined && current !== want) continue;
    const alt = typeof p[3] === 'number' ? p[3] : null;
    mine.push([t.timestamp + p[0], p[1], p[2], alt]);
    if (p[3] === 'ground') lastGround = mine.length - 1;
  }
  return mine.slice(lastGround + 1);
}
