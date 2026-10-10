export type RoutePointKind = 'airport' | 'navaid' | 'fix' | 'latlon' | 'frd';

export interface RoutePoint {
  ident: string; // "ZEMMA", "ABI", "KDFW", "3530N/09720W", "ABI270015"
  lat: number;
  lon: number;
  kind: RoutePointKind;
  via?: string; // airway or procedure that produced it, e.g. "J52", "ANJLL4"
}

export interface Airport {
  icao: string; // "KDFW" (FAA id when the airport has no ICAO id)
  name: string;
  lat: number;
  lon: number;
}

export type FlightStatus = 'filed' | 'active' | 'arrived' | 'unknown';
export type RouteSource = 'filed' | 'expected' | 'none';

export interface FlightView {
  query: string; // what the user typed
  callsign: string; // "AAL558"
  gufi?: string;
  operator?: string; // "American Airlines"
  acType?: string; // "A321"
  origin?: Airport;
  dest?: Airport;
  status: FlightStatus;
  etd?: number; // epoch s UTC
  atd?: number;
  eta?: number;
  route: {
    source: RouteSource;
    text?: string;
    points: RoutePoint[];
    partial: boolean;
    amendedAt?: number;
  };
  hex?: string; // ICAO 24-bit transponder address, when known
  navCycle: string; // AIRAC ident, "2610"
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

export interface LiveAircraft {
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
}

export interface Traffic {
  hex: string;
  callsign?: string;
  lat: number;
  lon: number;
  alt?: number;
  track?: number;
  vs?: number;
}

export interface LiveState {
  t: number; // server time, epoch ms
  aircraft: null | LiveAircraft;
  traffic: Traffic[];
}

/** Flown trail of the current leg: [epoch s, lat, lon, baro altitude ft or null]. */
export type Trail = Array<[t: number, lat: number, lon: number, alt: number | null]>;

export interface NavTile {
  cycle: string; // AIRAC ident
  navaids: Array<{ ident: string; type: string; lat: number; lon: number }>;
  airports: Array<{ icao: string; lat: number; lon: number }>;
}

export interface Health {
  swim: {
    enabled: boolean;
    connected: boolean;
    lastMessageAt: number | null; // epoch ms
    keptPerMin: number;
    droppedPerMin: number;
    reconnects: number;
  };
  navCycle: string; // AIRAC ident
  navEffective: string; // "2026-10-01"
  navUpdate?: { lastCheckAt: number | null; lastError: string | null };
  flights: number; // rows in the flight-plan store
  uptimeSec: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
