import type { AirlineDb } from './airlines.ts';

/** Airline code (3-letter ICAO or 2-character IATA) followed by a 1-4 digit flight number (spec §7.1). */
const QUERY_RE = /^([A-Z]{3}|[A-Z0-9]{2})(\d{1,4})$/;

export interface FlightQuery {
  code: string; // "AA" or "AAL"
  number: string; // leading zeros stripped
}

/** Uppercase, drop whitespace and parse; undefined when the input isn't a flight number. */
export function normalizeQuery(input: string): FlightQuery | undefined {
  const m = QUERY_RE.exec(input.toUpperCase().replace(/\s+/g, ''));
  return m ? { code: m[1] as string, number: String(Number(m[2])) } : undefined;
}

/**
 * Callsigns that may be flying this flight number: the mainline ICAO callsign first, then the brand's
 * regional operators (spec §7.2–7.3). Undefined for an unknown 2-character code.
 */
export function candidateCallsigns(q: FlightQuery, airlines: AirlineDb): string[] | undefined {
  const brand = q.code.length === 2 ? airlines.byIata(q.code) : airlines.byIcao(q.code);
  if (q.code.length === 2 && !brand) return undefined;
  const mainline = brand?.icao ?? q.code;
  return [...new Set([mainline, ...(brand?.regionals ?? [])])].map((op) => op + q.number);
}
