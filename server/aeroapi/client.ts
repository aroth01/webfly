import { RateLimiter } from '../api/ratelimit.ts';
import type { FlightRow, FlightStatus } from '../store/flights.ts';

/** The fields of an AeroAPI v4 flight that we use. */
export interface AeroFlight {
  ident?: string;
  ident_icao?: string | null;
  fa_flight_id?: string;
  origin?: { code_icao?: string | null } | null;
  destination?: { code_icao?: string | null } | null;
  route?: string | null;
  aircraft_type?: string | null;
  cancelled?: boolean;
  blocked?: boolean;
  position_only?: boolean;
  scheduled_off?: string | null;
  estimated_off?: string | null;
  actual_off?: string | null;
  estimated_on?: string | null;
  actual_on?: string | null;
}

const sec = (iso: string | null | undefined): number | undefined => {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor(t / 1000) : undefined;
};

/** Map an AeroAPI flight to a store row, or null if it has no usable identity. */
export function toFlightRow(f: AeroFlight, nowSec: number): FlightRow | null {
  const callsign = (f.ident_icao ?? f.ident)?.toUpperCase();
  if (!callsign || !f.fa_flight_id) return null;
  const status: FlightStatus = f.cancelled ? 'cancelled' : f.actual_on ? 'arrived' : f.actual_off ? 'active' : 'filed';
  const row: FlightRow = { gufi: f.fa_flight_id, callsign, status, updatedAt: nowSec };
  if (f.origin?.code_icao) row.origin = f.origin.code_icao;
  if (f.destination?.code_icao) row.dest = f.destination.code_icao;
  if (f.route) row.routeText = f.route;
  if (f.aircraft_type) row.acType = f.aircraft_type;
  const etd = sec(f.estimated_off) ?? sec(f.scheduled_off);
  if (etd !== undefined) row.etd = etd;
  const atd = sec(f.actual_off);
  if (atd !== undefined) row.atd = atd;
  const eta = sec(f.estimated_on);
  if (eta !== undefined) row.eta = eta;
  const ata = sec(f.actual_on);
  if (ata !== undefined) row.ata = ata;
  return row;
}

export interface AeroApiOptions {
  apiKey: string;
  fetch?: typeof fetch;
  now?: () => number; // epoch ms
  baseUrl?: string;
  /** How long one ident's answer is reused. The Personal tier is tightly rate limited, so keep this generous. */
  ttlMs?: number;
  /** Outbound calls per minute (a safety cap below the tier's limit). */
  perMinute?: number;
  log?: (msg: string) => void;
}

const CACHE_MAX = 1_000;
const BACKOFF_MS = 60_000;

/**
 * FlightAware AeroAPI v4 client for filed routes (`GET /flights/{ident}`). Answers are cached per ident, calls
 * are capped per minute, and a 429 pauses all calls for a minute. It never throws: on any failure it returns
 * what it has (possibly nothing). Note the Personal tier's license is for personal, non-public use.
 */
export class AeroApiClient {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly baseUrl: string;
  private readonly ttlMs: number;
  private readonly limiter: RateLimiter;
  private readonly log: (msg: string) => void;
  private readonly cache = new Map<string, { at: number; flights: AeroFlight[] }>();
  private pausedUntil = 0;

  constructor(private readonly opts: AeroApiOptions) {
    this.fetchFn = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
    this.baseUrl = opts.baseUrl ?? 'https://aeroapi.flightaware.com/aeroapi';
    this.ttlMs = opts.ttlMs ?? 120_000;
    const perMinute = opts.perMinute ?? 8;
    this.limiter = new RateLimiter({ capacity: Math.min(perMinute, 5), perMinute, now: this.now });
    this.log = opts.log ?? (() => {});
  }

  async flights(ident: string): Promise<AeroFlight[]> {
    const key = ident.toUpperCase();
    const hit = this.cache.get(key);
    const t = this.now();
    if (hit && t - hit.at < this.ttlMs) return hit.flights;
    if (t < this.pausedUntil || !this.limiter.take('aeroapi')) return hit?.flights ?? [];
    try {
      const res = await this.fetchFn(`${this.baseUrl}/flights/${encodeURIComponent(key)}`, {
        headers: { 'x-apikey': this.opts.apiKey, Accept: 'application/json; charset=UTF-8' },
        signal: AbortSignal.timeout(8_000),
      });
      if (res.status === 429) {
        this.pausedUntil = t + BACKOFF_MS;
        this.log('aeroapi: 429, pausing for 60 s');
        return hit?.flights ?? [];
      }
      if (!res.ok) {
        this.log(`aeroapi: HTTP ${res.status} for ${key}`);
        return hit?.flights ?? [];
      }
      const body = (await res.json()) as { flights?: AeroFlight[] };
      const flights = Array.isArray(body.flights) ? body.flights : [];
      this.cache.delete(key);
      this.cache.set(key, { at: t, flights });
      if (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
      return flights;
    } catch (e) {
      this.log(`aeroapi: ${e instanceof Error ? e.message : String(e)}`);
      return hit?.flights ?? [];
    }
  }

  /** Fetch an ident and turn its flights into store rows. */
  async rows(ident: string): Promise<FlightRow[]> {
    const nowSec = Math.floor(this.now() / 1000);
    return (await this.flights(ident)).map((f) => toFlightRow(f, nowSec)).filter((r): r is FlightRow => r !== null);
  }
}
