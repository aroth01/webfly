export type RoutePointKind = 'airport' | 'navaid' | 'fix' | 'latlon' | 'frd';

export interface RoutePoint {
  ident: string; // "ZEMMA", "ABI", "KDFW", "3530N/09720W", "ABI270015"
  lat: number;
  lon: number;
  kind: RoutePointKind;
  via?: string; // airway or procedure that produced it, e.g. "J52", "ANJLL4"
}

export interface NavTile {
  cycle: string; // AIRAC ident, e.g. "2610"
  navaids: Array<{ ident: string; type: string; lat: number; lon: number }>;
  airports: Array<{ icao: string; lat: number; lon: number }>;
}

export interface LiveState {
  t: number; // server time, epoch ms
  aircraft: null | {
    hex: string;
    lat: number;
    lon: number;
    altBaro?: number;
    gs?: number;
    track?: number;
    vs?: number;
    tas?: number;
    trueHeading?: number;
    windDir?: number;
    windSpd?: number;
    onGround: boolean;
    ageSec: number;
  };
  traffic: Array<{ hex: string; callsign?: string; lat: number; lon: number; alt?: number; track?: number; vs?: number }>;
}

export type Trail = Array<[t: number, lat: number, lon: number, alt: number | null]>;
