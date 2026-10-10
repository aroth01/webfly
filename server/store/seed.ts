import { readFileSync } from 'node:fs';
import type { FlightRecord, FlightStore, StoredStatus } from './flights.ts';

export interface SeedFlight {
  callsign: string;
  origin: string;
  dest: string;
  acType: string;
  status: StoredStatus;
  route?: string;
  partial?: boolean; // decodes with unresolved tokens on purpose (shows the PARTIAL badge)
  etdMin?: number;
  atdMin?: number;
  etaMin?: number;
  ataMin?: number;
  amendedMin?: number;
}

export function readSeedFlights(): SeedFlight[] {
  return (JSON.parse(readFileSync(new URL('./seed-flights.json', import.meta.url), 'utf8')) as { flights: SeedFlight[] }).flights;
}

/** Write the development flight plans with times relative to `nowMs`; returns how many were written. */
export function seedFlights(store: FlightStore, nowMs: number, seeds: SeedFlight[] = readSeedFlights()): number {
  const now = Math.floor(nowMs / 1000);
  const at = (min: number | undefined) => (min === undefined ? undefined : now + min * 60);
  for (const s of seeds) {
    const rec: FlightRecord = { gufi: `seed-${s.callsign}`, callsign: s.callsign, origin: s.origin, dest: s.dest, acType: s.acType, status: s.status, updatedAt: now };
    if (s.route) rec.routeText = s.route;
    const times = { etd: at(s.etdMin), atd: at(s.atdMin), eta: at(s.etaMin), ata: at(s.ataMin), amendedAt: at(s.amendedMin) };
    for (const [k, v] of Object.entries(times)) if (v !== undefined) (rec as unknown as Record<string, number>)[k] = v;
    store.upsert(rec);
  }
  return seeds.length;
}
