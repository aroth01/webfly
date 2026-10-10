export interface AirportRec {
  id: string; // FAA location id, e.g. "DFW"
  icao?: string; // e.g. "KDFW"
  name: string;
  lat: number;
  lon: number;
  rwyFt: number; // longest runway length, feet (0 if none)
  pub: boolean; // public use
}

export type NavaidType = 'VOR' | 'VOR/DME' | 'VORTAC' | 'TACAN' | 'DME' | 'NDB' | 'NDB/DME';

export interface NavaidRec {
  id: string;
  type: NavaidType;
  name: string;
  lat: number;
  lon: number;
  varDeg: number; // magnetic variation, east positive
}

export interface FixRec {
  id: string;
  lat: number;
  lon: number;
}

export interface AirwayRec {
  id: string; // "J52", "V16", "Q30"
  loc: string; // "C" contiguous US, "A" Alaska, "H" Hawaii
  pts: string[]; // ordered point idents
}

export interface ProcRec {
  name: string; // "AKUNA9" (SID) or "ANJLL4" (STAR)
  kind: 'SID' | 'STAR';
  airports: string[]; // FAA ids served
  body: string[]; // runway-independent part of the body, in flight order
  transitions: Record<string, string[]>; // transition fix -> points in flight order
}

export interface PrefRouteRec {
  orig: string;
  dest: string;
  type: string; // "H", "L", "TEC", "NAR", ...
  route: string; // space separated, includes orig and dest
}

export interface NavDataFile {
  cycle: string; // "2026-10-01"
  airports: AirportRec[];
  navaids: NavaidRec[];
  fixes: FixRec[];
  airways: AirwayRec[];
  procs: ProcRec[];
  prefRoutes: PrefRouteRec[];
}
