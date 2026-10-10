import { bearingDeg, distanceNm, type LatLon } from '../../../shared/geo.ts';
import type { NdLayout } from './layout.ts';

export interface ScreenPoint {
  x: number;
  y: number;
  distNm: number;
}

/** Symbols farther than this multiple of the range are culled (spec §9.4). */
export const CULL_FACTOR = 1.1;

export type Project = (p: LatLon, cullFactor?: number) => ScreenPoint | null;

/**
 * Azimuthal projection around the aircraft: each feature's great-circle bearing and distance become
 * polar screen coordinates, rotated so that `upTrueDeg` points up, scaled so `rangeNm` is the arc.
 */
export function makeProjector(own: LatLon, upTrueDeg: number, rangeNm: number, layout: NdLayout): Project {
  const scale = layout.radius / rangeNm;
  return (p, cullFactor = CULL_FACTOR) => {
    const d = distanceNm(own, p);
    if (d > cullFactor * rangeNm) return null;
    const theta = ((bearingDeg(own, p) - upTrueDeg) * Math.PI) / 180;
    return { x: layout.cx + d * scale * Math.sin(theta), y: layout.cy - d * scale * Math.cos(theta), distNm: d };
  };
}

/** Screen position of a display bearing (degrees clockwise from up) at `r` pixels from the centre. */
export function polar(layout: NdLayout, displayDeg: number, r: number): { x: number; y: number } {
  const t = (displayDeg * Math.PI) / 180;
  return { x: layout.cx + r * Math.sin(t), y: layout.cy - r * Math.cos(t) };
}
