import type { FlightRecord } from '../store/flights.ts';

const HOUR = 3600;
/** Filed flights count from 3 h past their ETD (late departures) to 12 h ahead. */
const FILED_PAST_S = 3 * HOUR;
const FILED_AHEAD_S = 12 * HOUR;
const ARRIVED_WITHIN_S = 2 * HOUR;

export type RankResult =
  | { kind: 'winner'; flight: FlightRecord }
  | { kind: 'choices'; flights: FlightRecord[] }
  | { kind: 'none' };

interface Tier {
  matches: (r: FlightRecord) => boolean;
  better: (a: FlightRecord, b: FlightRecord) => boolean; // a ranks above b
}

/**
 * Spec §7.4–7.5: active flights, then filed flights by ETD nearest now, then flights arrived in the last
 * 2 h. The best non-empty tier wins; it yields a pick list only when it holds several callsigns.
 */
export function rankFlights(rows: FlightRecord[], nowSec: number): RankResult {
  const tiers: Tier[] = [
    {
      matches: (r) => r.status === 'active',
      better: (a, b) => (a.atd ?? a.etd ?? a.updatedAt) > (b.atd ?? b.etd ?? b.updatedAt),
    },
    {
      matches: (r) => r.status === 'filed' && r.etd !== undefined && r.etd >= nowSec - FILED_PAST_S && r.etd <= nowSec + FILED_AHEAD_S,
      better: (a, b) => Math.abs((a.etd as number) - nowSec) < Math.abs((b.etd as number) - nowSec),
    },
    {
      matches: (r) => r.status === 'arrived' && (r.ata ?? r.updatedAt) >= nowSec - ARRIVED_WITHIN_S,
      better: (a, b) => (a.ata ?? a.updatedAt) > (b.ata ?? b.updatedAt),
    },
  ];
  for (const tier of tiers) {
    const bestByCallsign = new Map<string, FlightRecord>();
    for (const r of rows) {
      if (!tier.matches(r)) continue;
      const cur = bestByCallsign.get(r.callsign);
      if (!cur || tier.better(r, cur)) bestByCallsign.set(r.callsign, r);
    }
    const best = [...bestByCallsign.values()].sort((a, b) => (tier.better(a, b) ? -1 : tier.better(b, a) ? 1 : 0));
    if (best.length === 1) return { kind: 'winner', flight: best[0] as FlightRecord };
    if (best.length > 1) return { kind: 'choices', flights: best };
  }
  return { kind: 'none' };
}
