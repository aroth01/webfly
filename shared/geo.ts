export const EARTH_RADIUS_NM = 3440.065;

export interface LatLon {
  lat: number;
  lon: number;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Wrap any angle into [0, 360). */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Great-circle distance in nautical miles (haversine). */
export function distanceNm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial true bearing from a to b, degrees in [0, 360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return normalizeDeg(toDeg(Math.atan2(y, x)));
}

/** Point reached from `from` after travelling `distNm` on initial true bearing `bearing`. */
export function destinationPoint(from: LatLon, bearing: number, distNm: number): LatLon {
  const la1 = toRad(from.lat);
  const lo1 = toRad(from.lon);
  const brg = toRad(bearing);
  const dr = distNm / EARTH_RADIUS_NM;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(dr) + Math.cos(la1) * Math.sin(dr) * Math.cos(brg));
  const lo2 =
    lo1 + Math.atan2(Math.sin(brg) * Math.sin(dr) * Math.cos(la1), Math.cos(dr) - Math.sin(la1) * Math.sin(la2));
  return { lat: toDeg(la2), lon: ((toDeg(lo2) + 540) % 360) - 180 };
}

/** Unsigned distance (nm) of point p from the great circle through a and b. */
export function crossTrackNm(p: LatLon, a: LatLon, b: LatLon): number {
  if (a.lat === b.lat && a.lon === b.lon) return distanceNm(a, p); // zero-length leg: no defined line
  const d13 = distanceNm(a, p) / EARTH_RADIUS_NM;
  const t13 = toRad(bearingDeg(a, p));
  const t12 = toRad(bearingDeg(a, b));
  return Math.abs(Math.asin(Math.sin(d13) * Math.sin(t13 - t12)) * EARTH_RADIUS_NM);
}

/**
 * Signed distance (nm) of p's closest approach along the great circle from a toward b, measured from a:
 * negative when p is behind a, beyond the leg length when ahead of b. Zero for a zero-length leg.
 */
export function alongTrackNm(p: LatLon, a: LatLon, b: LatLon): number {
  if (a.lat === b.lat && a.lon === b.lon) return 0;
  const d13 = distanceNm(a, p) / EARTH_RADIUS_NM;
  const dTheta = toRad(bearingDeg(a, p) - bearingDeg(a, b));
  const xt = Math.asin(Math.sin(d13) * Math.sin(dTheta));
  const along = Math.acos(Math.max(-1, Math.min(1, Math.cos(d13) / Math.cos(xt)))) * EARTH_RADIUS_NM;
  return Math.cos(dTheta) >= 0 ? along : -along;
}

/**
 * Distance (nm) of point p from the great-circle segment a–b: the cross-track distance when p lies abeam the
 * segment, else the distance to the nearer end (so a point far beyond b on the same line still counts as far).
 */
export function distanceToSegmentNm(p: LatLon, a: LatLon, b: LatLon): number {
  if (a.lat === b.lat && a.lon === b.lon) return distanceNm(a, p);
  // p is abeam the segment when it is within 90 degrees of the segment's direction as seen from both ends.
  const offA = Math.abs(normalizeDeg(bearingDeg(a, p) - bearingDeg(a, b) + 180) - 180);
  const offB = Math.abs(normalizeDeg(bearingDeg(b, p) - bearingDeg(b, a) + 180) - 180);
  if (offA > 90 || offB > 90) return Math.min(distanceNm(a, p), distanceNm(b, p));
  return crossTrackNm(p, a, b);
}
