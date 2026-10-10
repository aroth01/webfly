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
  const d13 = distanceNm(a, p) / EARTH_RADIUS_NM;
  const t13 = toRad(bearingDeg(a, p));
  const t12 = toRad(bearingDeg(a, b));
  return Math.abs(Math.asin(Math.sin(d13) * Math.sin(t13 - t12)) * EARTH_RADIUS_NM);
}
