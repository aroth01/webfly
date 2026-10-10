import { alongTrackNm, crossTrackNm, distanceNm, distanceToSegmentNm, type LatLon } from '../../../shared/geo.ts';

export interface ActiveLeg {
  /** Index of the leg's start point; the TO waypoint is points[toIdx]. */
  idx: number;
  toIdx: number;
  /** Distance to the TO waypoint plus every later leg. */
  remainingNm: number;
}

/** Cross-track differences smaller than this don't justify skipping to a later leg (self-crossing routes). */
const TIE_NM = 1;

/**
 * The active leg (spec section 9.4): of the legs from `prevIdx` forward whose along-track progress lies in
 * [0, 1], the one with the least cross-track distance. If the aircraft is abeam none of them (off route, or
 * before the first or past the last waypoint) it falls back to the nearest leg by segment distance. Zero-length
 * legs are skipped. A one-point route is "active" toward its single point.
 */
export function activeLeg(points: LatLon[], pos: LatLon, prevIdx = 0): ActiveLeg | null {
  if (points.length === 0) return null;
  if (points.length === 1) return { idx: 0, toIdx: 0, remainingNm: distanceNm(pos, points[0]) };

  const start = Math.max(0, Math.min(prevIdx, points.length - 2));
  let best = -1;
  let bestXt = Infinity;
  let nearest = -1;
  let nearestD = Infinity;
  for (let i = start; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = distanceNm(a, b);
    if (len === 0) continue;
    const d = distanceToSegmentNm(pos, a, b);
    if (d < nearestD - TIE_NM) {
      nearestD = d;
      nearest = i;
    }
    const along = alongTrackNm(pos, a, b);
    if (along < 0 || along > len) continue;
    const xt = crossTrackNm(pos, a, b);
    if (xt < bestXt - TIE_NM) {
      bestXt = xt;
      best = i;
    }
  }
  const idx = best >= 0 ? best : nearest;
  if (idx < 0) return { idx: points.length - 2, toIdx: points.length - 1, remainingNm: distanceNm(pos, points[points.length - 1]) };

  let remaining = distanceNm(pos, points[idx + 1]);
  for (let i = idx + 1; i < points.length - 1; i++) remaining += distanceNm(points[i], points[i + 1]);
  return { idx, toIdx: idx + 1, remainingNm: remaining };
}

/** Estimated arrival, epoch ms, or null when ground speed is unknown or ~zero. */
export function etaMs(remainingNm: number, gsKt: number | undefined, nowMs: number): number | null {
  if (gsKt === undefined || !(gsKt > 1)) return null;
  return nowMs + (remainingNm / gsKt) * 3_600_000;
}
