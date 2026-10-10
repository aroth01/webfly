import { alongTrackNm, bearingDeg, crossTrackNm, distanceNm, type LatLon } from '../../../shared/geo.ts';

/** How many legs ahead of the previous active leg the search may look. */
const SEARCH_WINDOW = 8;
/** A leg this far abeam can't be the one being flown, even if it brackets the position. */
const MAX_XT_NM = 50;

/**
 * Index of the active leg (points[i] → points[i+1]): among the legs from `prev` onward whose
 * along-track progress is within [0, 1], the one with the least cross-track distance (spec §9.4),
 * ignoring legs more than 50 nm abeam.
 * When no leg brackets the position, advance past legs whose end is already behind.
 */
export function findActiveLeg(points: LatLon[], pos: LatLon, prev = 0): number {
  if (points.length < 2) return 0;
  const start = Math.min(Math.max(0, prev), points.length - 2);
  const end = Math.min(points.length - 1, start + SEARCH_WINDOW);
  let best = -1;
  let bestXt = Infinity;
  for (let i = start; i < end; i++) {
    const a = points[i] as LatLon;
    const b = points[i + 1] as LatLon;
    const len = distanceNm(a, b);
    if (len < 0.01) continue;
    const f = alongTrackNm(pos, a, b) / len;
    if (f < 0 || f > 1) continue;
    const xt = crossTrackNm(pos, a, b);
    if (xt <= MAX_XT_NM && xt < bestXt) {
      bestXt = xt;
      best = i;
    }
  }
  if (best >= 0) return best;
  let i = start;
  while (i < points.length - 2 && alongTrackNm(pos, points[i] as LatLon, points[i + 1] as LatLon) > distanceNm(points[i] as LatLon, points[i + 1] as LatLon)) i++;
  return i;
}

export interface ToWaypoint {
  index: number; // index of the TO point in the route
  brgTrue: number;
  distNm: number;
  etaMs?: number; // at the TO waypoint
  remainingNm: number; // to the end of the route
  destEtaMs?: number;
}

/** Below this ground speed an ETA is meaningless (taxiing, or no data). */
const MIN_ETA_GS = 50;

export function toWaypoint(points: LatLon[], pos: LatLon, leg: number, gs: number | undefined, nowMs: number): ToWaypoint | undefined {
  if (points.length < 2) return undefined;
  const index = Math.min(leg + 1, points.length - 1);
  const to = points[index] as LatLon;
  const distNm = distanceNm(pos, to);
  let remainingNm = distNm;
  for (let i = index; i < points.length - 1; i++) remainingNm += distanceNm(points[i] as LatLon, points[i + 1] as LatLon);
  const out: ToWaypoint = { index, brgTrue: bearingDeg(pos, to), distNm, remainingNm };
  if (gs !== undefined && gs >= MIN_ETA_GS) {
    out.etaMs = nowMs + (distNm / gs) * 3_600_000;
    out.destEtaMs = nowMs + (remainingNm / gs) * 3_600_000;
  }
  return out;
}
