import type { FlightRow, FlightStore } from '../store/flights.ts';
import { candidateCallsigns, normalizeQuery } from './normalize.ts';

const HOUR = 3600;

export type Resolution =
  | { kind: 'one'; row: FlightRow }
  | { kind: 'choices'; rows: FlightRow[] }
  | { kind: 'none'; candidates: string[] } // nothing in the store; caller may try adsb.lol
  | { kind: 'error'; code: 'bad_query' | 'unknown_airline' };

/**
 * Spec section 7.4: active flights beat filed ones departing within the next 12 h (nearest ETD first), which
 * beat flights that arrived in the last 2 h. Returns the best tier's equally ranked rows (one row = a clear winner).
 */
export function scoreRows(rows: FlightRow[], now: number): FlightRow[] {
  return collapseRefiled(bestTier(rows, now));
}

function bestTier(all: FlightRow[], now: number): FlightRow[] {
  const active = all.filter((r) => r.status === 'active');
  if (active.length) return active;

  const filed = all.filter((r) => r.status === 'filed' && r.etd !== undefined && r.etd >= now - 2 * HOUR && r.etd <= now + 12 * HOUR);
  if (filed.length) {
    const dist = (r: FlightRow) => Math.abs((r.etd as number) - now);
    const best = Math.min(...filed.map(dist));
    return filed.filter((r) => dist(r) === best);
  }

  const arrived = all.filter((r) => r.status === 'arrived' && (r.ata ?? r.updatedAt) >= now - 2 * HOUR);
  if (arrived.length) {
    const newest = Math.max(...arrived.map((r) => r.ata ?? r.updatedAt));
    return arrived.filter((r) => (r.ata ?? r.updatedAt) === newest);
  }
  return [];
}

/** A refiled plan arrives under a new gufi; among tied rows keep the freshest per callsign and city pair. */
function collapseRefiled(rows: FlightRow[]): FlightRow[] {
  const fresh = new Map<string, FlightRow>();
  for (const r of rows) {
    const key = `${r.callsign}|${r.origin ?? ''}|${r.dest ?? ''}`;
    const prev = fresh.get(key);
    if (!prev || r.updatedAt > prev.updatedAt) fresh.set(key, r);
  }
  return [...fresh.values()];
}

export function resolve(query: string, store: FlightStore, now: number): Resolution {
  const n = normalizeQuery(query);
  if (!n.ok) return { kind: 'error', code: n.code };
  const candidates = candidateCallsigns(n.airline, n.number);
  const winners = scoreRows(store.byCallsigns(candidates), now);
  if (winners.length === 1) return { kind: 'one', row: winners[0] };
  if (winners.length > 1) return { kind: 'choices', rows: winners };
  return { kind: 'none', candidates };
}
