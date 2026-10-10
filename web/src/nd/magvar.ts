import geomagnetism from 'geomagnetism';
import { distanceNm, type LatLon } from '../../../shared/geo.ts';

/** Magnetic declination (east positive) at a point, from the World Magnetic Model (WMM2025). */
export function declination(p: LatLon, date: Date = new Date(), altKm = 0): number {
  return geomagnetism.model(date).point([p.lat, p.lon, altKm]).decl;
}

/** Declination along a flight, recomputed only after the aircraft moves more than 10 nm (spec §9.4). */
export class MagVar {
  private readonly model: ReturnType<typeof geomagnetism.model>;
  private at: LatLon | undefined;
  private value = 0;

  constructor(date: Date = new Date()) {
    this.model = geomagnetism.model(date);
  }

  get(p: LatLon): number {
    if (!this.at || distanceNm(this.at, p) > 10) {
      this.at = { lat: p.lat, lon: p.lon };
      this.value = this.model.point([p.lat, p.lon]).decl;
    }
    return this.value;
  }
}
