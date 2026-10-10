import * as geomagnetism from 'geomagnetism';
import { distanceNm, type LatLon } from '../../../shared/geo.ts';

/** Declination (east positive) at a point and date, from the WMM. */
export type DeclinationFn = (pos: LatLon, date: Date) => number;

export const wmmDeclination: DeclinationFn = (pos, date) => geomagnetism.model(date).point([pos.lat, pos.lon]).decl;

const RECOMPUTE_NM = 10;

/** Magnetic variation that is recomputed only after the aircraft has moved more than 10 nm (spec section 9.4). */
export class MagVar {
  private at: LatLon | undefined;
  private value = 0;

  constructor(private readonly decl: DeclinationFn = wmmDeclination) {}

  get(pos: LatLon, date: Date = new Date()): number {
    if (!this.at || distanceNm(this.at, pos) > RECOMPUTE_NM) {
      this.value = this.decl(pos, date);
      this.at = { lat: pos.lat, lon: pos.lon };
    }
    return this.value;
  }
}
