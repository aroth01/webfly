import { normalizeDeg } from '../../../shared/geo.ts';

/** Shown in place of any missing value (spec §9.3). */
export const DASHES = '---';

export const fmtInt = (v: number | undefined): string => (v === undefined || !Number.isFinite(v) ? DASHES : String(Math.round(v)));

/** Bearing as three digits, 360 rather than 000. */
export function fmtBearing(deg: number | undefined): string {
  if (deg === undefined) return DASHES;
  const d = Math.round(normalizeDeg(deg)) % 360;
  return String(d === 0 ? 360 : d).padStart(3, '0');
}

/** Distance in nm: one decimal below 20 nm, whole miles above. */
export function fmtDist(nm: number | undefined): string {
  if (nm === undefined) return DASHES;
  return nm < 20 ? nm.toFixed(1) : String(Math.round(nm));
}

/** Wind as "DDD/SS" (magnetic direction), or "---/---". */
export function fmtWind(dirMag: number | undefined, spd: number | undefined): string {
  if (dirMag === undefined || spd === undefined) return `${DASHES}/${DASHES}`;
  return `${fmtBearing(dirMag)}/${Math.round(spd)}`;
}

/** UTC clock time "HH:MM" of an epoch-ms instant. */
export function fmtUtc(epochMs: number | undefined): string {
  if (epochMs === undefined || !Number.isFinite(epochMs)) return DASHES;
  return new Date(epochMs).toISOString().slice(11, 16);
}

/** Flight level at or above the US transition altitude (18,000 ft), feet below it. */
export function fmtAltitude(ft: number | undefined, onGround = false): string {
  if (onGround) return 'GND';
  if (ft === undefined) return DASHES;
  if (ft >= 18_000) return `FL${String(Math.round(ft / 100)).padStart(3, '0')}`;
  return `${Math.round(ft / 100) * 100} FT`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Relative altitude of traffic in hundreds of feet: "+12", "-05", "00". */
export function fmtRelAlt(own: number | undefined, other: number | undefined): string | undefined {
  if (own === undefined || other === undefined) return undefined;
  const h = Math.round((other - own) / 100);
  return `${h > 0 ? '+' : h < 0 ? '-' : ''}${String(Math.abs(h)).padStart(2, '0')}`;
}

/** Compass label in tens of degrees, as on the ND rose: 0, 3, 6 … 33. */
export const compassLabel = (deg: number): string => String(Math.round(normalizeDeg(deg) / 10) % 36);
