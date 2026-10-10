import { bearingDeg, distanceNm, type LatLon } from '../../../shared/geo.ts';

/** ND drawing frame: ownship sits at (cx, cy) and `radius` pixels span the selected range. */
export interface Geom {
  cx: number;
  cy: number;
  radius: number;
}

export interface Projected {
  x: number;
  y: number;
  distNm: number;
  /** True bearing from ownship, degrees. */
  brgDeg: number;
}

/** Features farther than this multiple of the range are culled (spec section 9.4). */
export const CULL_FACTOR = 1.1;

/**
 * Project a feature onto the ND. Straight up on screen is the true bearing `refDeg`: the caller converts the
 * display reference (magnetic track or heading) to true by adding the magnetic variation. Returns null when
 * the feature is beyond 1.1 x range.
 */
export function project(own: LatLon, refDeg: number, rangeNm: number, geom: Geom, f: LatLon): Projected | null {
  const distNm = distanceNm(own, f);
  if (distNm > rangeNm * CULL_FACTOR) return null;
  const brgDeg = distNm === 0 ? refDeg : bearingDeg(own, f);
  const rel = ((brgDeg - refDeg) * Math.PI) / 180;
  const px = (distNm * geom.radius) / rangeNm;
  return { x: geom.cx + Math.sin(rel) * px, y: geom.cy - Math.cos(rel) * px, distNm, brgDeg };
}

/** Magnetic to true bearing, given east-positive variation. */
export const magneticToTrue = (magDeg: number, varEastDeg: number): number => (((magDeg + varEastDeg) % 360) + 360) % 360;
/** True to magnetic bearing, given east-positive variation. */
export const trueToMagnetic = (trueDeg: number, varEastDeg: number): number => (((trueDeg - varEastDeg) % 360) + 360) % 360;
