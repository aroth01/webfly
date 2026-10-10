import type { LiveState } from '../../shared/types.ts';

/** One aircraft in readsb JSON, as served by adsb.lol. Only the fields we read. */
export interface AdsbAircraft {
  hex: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | 'ground';
  gs?: number;
  track?: number;
  baro_rate?: number;
  tas?: number;
  true_heading?: number;
  wd?: number;
  ws?: number;
  seen_pos?: number;
}

export interface AdsbOptions {
  fetch?: typeof fetch;
  now?: () => number; // epoch ms
  userAgent?: string;
  apiBase?: string;
  siteBase?: string;
}

interface Entry<T> {
  value: T;
  at: number;
}

const TTL_AIRCRAFT = 5_000;
const TTL_TRAFFIC = 5_000;
const TTL_TRACE = 30_000;
const TTL_ROUTESET = 10 * 60_000;
const TIMEOUT_MS = 5_000;
const BACKOFF_MIN = 1_000;
const BACKOFF_MAX = 60_000;
/** Traffic is cached per cell of this many degrees (about 6 nm of latitude). */
const CELL_DEG = 0.1;

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/**
 * adsb.lol client with a shared in-memory cache (spec section 6.4). Failures never throw out of the public
 * methods: they return the last cached value (with its true age) or an empty result, and 429/5xx responses
 * start an exponential backoff during which only cached values are served.
 */
export class AdsbClient {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly headers: Record<string, string>;
  private readonly apiBase: string;
  private readonly siteBase: string;
  private readonly cache = new Map<string, Entry<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private backoffUntil = 0;
  private failures = 0;

  constructor(opts: AdsbOptions = {}) {
    this.fetchFn = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
    this.headers = { 'User-Agent': opts.userAgent ?? 'webfly/0.1 (+https://github.com/aroth01/webfly)' };
    this.apiBase = opts.apiBase ?? 'https://api.adsb.lol';
    this.siteBase = opts.siteBase ?? 'https://adsb.lol';
  }

  /** The aircraft currently using this callsign, with when we fetched it (for true age), or null. */
  async aircraft(callsign: string): Promise<{ ac: AdsbAircraft; fetchedAt: number } | null> {
    const hit = await this.cached(`cs:${callsign}`, TTL_AIRCRAFT, async () => {
      const body = await this.getJson<{ ac?: AdsbAircraft[] }>(`${this.apiBase}/v2/callsign/${encodeURIComponent(callsign)}`);
      return (body.ac ?? []).find((a) => a.lat !== undefined && a.lon !== undefined) ?? null;
    });
    return hit && hit.value ? { ac: hit.value, fetchedAt: hit.at } : null;
  }

  /** Aircraft within 40 nm of the cell containing (lat, lon). */
  async traffic(lat: number, lon: number): Promise<AdsbAircraft[]> {
    const cl = Math.round(lat / CELL_DEG) * CELL_DEG;
    const co = Math.round(lon / CELL_DEG) * CELL_DEG;
    const key = `pt:${cl.toFixed(1)},${co.toFixed(1)}`;
    const hit = await this.cached(key, TTL_TRAFFIC, async () => {
      const body = await this.getJson<{ ac?: AdsbAircraft[] }>(`${this.apiBase}/v2/point/${cl.toFixed(1)}/${co.toFixed(1)}/40`);
      return body.ac ?? [];
    });
    return hit?.value ?? [];
  }

  /** Full readsb trace for a hex (undocumented endpoint, so null on any failure). */
  async trace(hex: string): Promise<unknown | null> {
    const h = hex.toLowerCase();
    const hit = await this.cached(`tr:${h}`, TTL_TRACE, () =>
      this.getJson<unknown>(`${this.siteBase}/data/traces/${h.slice(-2)}/trace_full_${h}.json`),
    );
    return hit?.value ?? null;
  }

  /** Best-effort origin/destination (ICAO) for a callsign near a position. Often empty. */
  async routeset(callsign: string, lat: number, lon: number): Promise<{ origin?: string; dest?: string }> {
    const hit = await this.cached(`rs:${callsign}`, TTL_ROUTESET, async () => {
      const body = await this.getJson<unknown>(`${this.apiBase}/api/0/routeset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planes: [{ callsign, lat, lng: lon }] }),
      });
      return parseRouteset(body);
    });
    return hit?.value ?? {};
  }

  private async cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<Entry<T> | null> {
    const prev = this.cache.get(key) as Entry<T> | undefined;
    const t = this.now();
    if (prev && t - prev.at < ttlMs) return prev;
    if (t < this.backoffUntil) return prev ?? null;
    const pending = this.inflight.get(key) as Promise<Entry<T> | null> | undefined;
    if (pending) return pending;
    const p = (async () => {
      try {
        const entry = { value: await load(), at: this.now() };
        this.cache.set(key, entry);
        this.failures = 0;
        return entry;
      } catch (e) {
        if (e instanceof HttpError && (e.status === 429 || e.status >= 500)) {
          this.failures++;
          this.backoffUntil = this.now() + Math.min(BACKOFF_MAX, BACKOFF_MIN * 2 ** (this.failures - 1));
        }
        return prev ?? null;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }

  private async getJson<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchFn(url, {
      ...init,
      headers: { ...this.headers, ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new HttpError(res.status);
    return (await res.json()) as T;
  }
}

/** routeset replies with a loosely typed body; accept `[{ airport_codes: "KDFW-KLAX" }]` or the same as a JSON string. */
export function parseRouteset(body: unknown): { origin?: string; dest?: string } {
  let v = body;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return {};
    }
  }
  const first = Array.isArray(v) ? v[0] : undefined;
  const codes = first && typeof first === 'object' ? (first as { airport_codes?: unknown }).airport_codes : undefined;
  if (typeof codes !== 'string') return {};
  const [origin, dest] = codes.split('-');
  return /^[A-Z0-9]{3,4}$/.test(origin ?? '') && /^[A-Z0-9]{3,4}$/.test(dest ?? '') ? { origin, dest } : {};
}

/** Build the `/api/live` payload: the aircraft (with true age) plus traffic within 40 nm of it. */
export async function liveState(client: AdsbClient, callsign: string, now: () => number = Date.now): Promise<LiveState> {
  const t = now();
  const hit = await client.aircraft(callsign);
  if (!hit) return { t, aircraft: null, traffic: [] };
  const { ac, fetchedAt } = hit;
  const lat = ac.lat as number;
  const lon = ac.lon as number;
  const traffic = (await client.traffic(lat, lon))
    .filter((o) => o.hex !== ac.hex && o.lat !== undefined && o.lon !== undefined)
    .map((o) => {
      const item: LiveState['traffic'][number] = { hex: o.hex, lat: o.lat as number, lon: o.lon as number };
      const cs = o.flight?.trim();
      if (cs) item.callsign = cs;
      if (typeof o.alt_baro === 'number') item.alt = o.alt_baro;
      if (o.track !== undefined) item.track = o.track;
      if (o.baro_rate !== undefined) item.vs = o.baro_rate;
      return item;
    });
  const aircraft: NonNullable<LiveState['aircraft']> = {
    hex: ac.hex,
    lat,
    lon,
    onGround: ac.alt_baro === 'ground',
    ageSec: Math.max(0, Math.round((ac.seen_pos ?? 0) + (t - fetchedAt) / 1000)),
  };
  if (typeof ac.alt_baro === 'number') aircraft.altBaro = ac.alt_baro;
  if (ac.gs !== undefined) aircraft.gs = ac.gs;
  if (ac.track !== undefined) aircraft.track = ac.track;
  if (ac.baro_rate !== undefined) aircraft.vs = ac.baro_rate;
  if (ac.tas !== undefined) aircraft.tas = ac.tas;
  if (ac.true_heading !== undefined) aircraft.trueHeading = ac.true_heading;
  if (ac.wd !== undefined) aircraft.windDir = ac.wd;
  if (ac.ws !== undefined) aircraft.windSpd = ac.ws;
  return { t, aircraft, traffic };
}
