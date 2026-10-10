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

export interface Airport {
  icao: string;
  name: string;
  lat: number;
  lon: number;
}

export interface FlightView {
  query: string; // what the user typed
  callsign: string; // "AAL558"
  gufi?: string;
  operator?: string;
  acType?: string;
  origin?: Airport;
  dest?: Airport;
  status: 'filed' | 'active' | 'arrived' | 'unknown';
  etd?: number; // epoch s UTC
  atd?: number;
  eta?: number;
  route: {
    source: 'filed' | 'expected' | 'none';
    text?: string;
    points: RoutePoint[];
    partial: boolean;
    amendedAt?: number;
  };
  hex?: string; // ICAO 24-bit transponder address, when known
  navCycle: string; // "2610"
  degraded?: 'swim_delayed'; // no SWIM message kept for > 3 min
}

export interface FlightChoice {
  query: string;
  callsign: string;
  origin?: string;
  dest?: string;
  etd?: number;
  status: string;
}
