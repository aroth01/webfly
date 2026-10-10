/** Aircraft as returned by adsb.lol v2 endpoints (readsb JSON); only the fields WebFly reads. */
export interface AdsbAircraftRaw {
  hex: string;
  flight?: string; // callsign, space padded
  lat?: number;
  lon?: number;
  alt_baro?: number | 'ground';
  gs?: number;
  track?: number;
  baro_rate?: number;
  geom_rate?: number;
  tas?: number;
  true_heading?: number;
  wd?: number; // wind direction, degrees true (only when derived from Comm-B data)
  ws?: number; // wind speed, kt
  seen_pos?: number; // seconds since the last position
  seen?: number;
}

export interface AdsbV2Response {
  ac: AdsbAircraftRaw[];
  now: number; // epoch ms
}

/** One trace_full point: [s after timestamp, lat, lon, alt ft | "ground" | null, gs, track, flags, vrate, details, ...]. */
export type TracePoint = [
  dt: number,
  lat: number,
  lon: number,
  alt: number | 'ground' | null,
  gs: number | null,
  track: number | null,
  flags: number,
  vrate: number | null,
  details: { flight?: string } | null,
  ...rest: unknown[],
];

export interface TraceFull {
  icao: string;
  timestamp: number; // epoch s
  trace: TracePoint[];
}

/** A normalized aircraft with an absolute position time. */
export interface AdsbAircraft {
  hex: string;
  callsign?: string;
  lat: number;
  lon: number;
  altBaro?: number;
  onGround: boolean;
  gs?: number;
  track?: number;
  vs?: number;
  tas?: number;
  trueHeading?: number;
  windDir?: number;
  windSpd?: number;
  posTime: number; // epoch ms of the position
}

export interface AdsbSource {
  byCallsign(callsign: string): Promise<AdsbAircraft[]>;
  around(lat: number, lon: number, radiusNm: number): Promise<AdsbAircraft[]>;
  /** Full trace of today's flights, or null when adsb.lol has none for this hex. */
  trace(hex: string): Promise<TraceFull | null>;
  /** Airports (ICAO) the callsign is known to fly, in order, or null when unknown. */
  routeset(callsign: string, lat: number, lon: number): Promise<string[] | null>;
}

export class UpstreamError extends Error {
  override name = 'UpstreamError';
}

export function normalizeAircraft(raw: AdsbAircraftRaw, nowMs: number): AdsbAircraft | undefined {
  if (typeof raw.lat !== 'number' || typeof raw.lon !== 'number') return undefined;
  const ac: AdsbAircraft = {
    hex: raw.hex,
    lat: raw.lat,
    lon: raw.lon,
    onGround: raw.alt_baro === 'ground',
    posTime: Math.round(nowMs - (raw.seen_pos ?? raw.seen ?? 0) * 1000),
  };
  const callsign = raw.flight?.trim();
  if (callsign) ac.callsign = callsign;
  if (typeof raw.alt_baro === 'number') ac.altBaro = raw.alt_baro;
  if (raw.gs !== undefined) ac.gs = raw.gs;
  if (raw.track !== undefined) ac.track = raw.track;
  const vs = raw.baro_rate ?? raw.geom_rate;
  if (vs !== undefined) ac.vs = vs;
  if (raw.tas !== undefined) ac.tas = raw.tas;
  if (raw.true_heading !== undefined) ac.trueHeading = raw.true_heading;
  if (raw.wd !== undefined) ac.windDir = raw.wd;
  if (raw.ws !== undefined) ac.windSpd = raw.ws;
  return ac;
}

/** Exponential backoff after 429/5xx: 2 s doubling to a 60 s cap, reset by a success. */
class Backoff {
  private until = 0;
  private delayMs = 0;

  check(now: number, host: string): void {
    if (now < this.until) throw new UpstreamError(`${host}: backing off for ${Math.ceil((this.until - now) / 1000)} s`);
  }

  fail(now: number): void {
    this.delayMs = this.delayMs ? Math.min(this.delayMs * 2, 60_000) : 2_000;
    this.until = now + this.delayMs;
  }

  ok(): void {
    this.delayMs = 0;
  }
}

export interface HttpAdsbOptions {
  userAgent: string;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  apiBase?: string;
  webBase?: string;
}

/** adsb.lol over HTTPS (spec §6.4): descriptive User-Agent, 5 s timeouts, backoff on 429/5xx. */
export class HttpAdsbSource implements AdsbSource {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly apiBase: string;
  private readonly webBase: string;
  private readonly backoff = new Map<string, Backoff>();

  constructor(opts: HttpAdsbOptions) {
    this.fetchFn = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
    this.userAgent = opts.userAgent;
    this.timeoutMs = opts.timeoutMs ?? 5_000;
    this.apiBase = opts.apiBase ?? 'https://api.adsb.lol';
    this.webBase = opts.webBase ?? 'https://adsb.lol';
  }

  /** Returns the response text, or null on 404. */
  private async request(url: string, init: RequestInit = {}): Promise<string | null> {
    const host = new URL(url).host;
    let backoff = this.backoff.get(host);
    if (!backoff) {
      backoff = new Backoff();
      this.backoff.set(host, backoff);
    }
    backoff.check(this.now(), host);
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        ...init,
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json', ...init.headers },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new UpstreamError(`${host}: ${(err as Error).message}`);
    }
    if (res.status === 429 || res.status >= 500) {
      backoff.fail(this.now());
      throw new UpstreamError(`${host}: HTTP ${res.status}`);
    }
    backoff.ok();
    if (res.status === 404) return null;
    if (!res.ok) throw new UpstreamError(`${host}: HTTP ${res.status}`);
    return res.text();
  }

  private async aircraftList(url: string): Promise<AdsbAircraft[]> {
    const text = await this.request(url);
    if (!text) return [];
    const body = JSON.parse(text) as AdsbV2Response;
    const now = typeof body.now === 'number' ? body.now : this.now();
    return (body.ac ?? []).map((a) => normalizeAircraft(a, now)).filter((a): a is AdsbAircraft => a !== undefined);
  }

  byCallsign(callsign: string): Promise<AdsbAircraft[]> {
    return this.aircraftList(`${this.apiBase}/v2/callsign/${encodeURIComponent(callsign)}`);
  }

  around(lat: number, lon: number, radiusNm: number): Promise<AdsbAircraft[]> {
    return this.aircraftList(`${this.apiBase}/v2/point/${lat.toFixed(2)}/${lon.toFixed(2)}/${Math.round(radiusNm)}`);
  }

  async trace(hex: string): Promise<TraceFull | null> {
    // Not a documented API: it backs the public map page (spec §6.4).
    const text = await this.request(`${this.webBase}/data/traces/${hex.slice(-2)}/trace_full_${hex}.json`);
    return text ? (JSON.parse(text) as TraceFull) : null;
  }

  async routeset(callsign: string, lat: number, lon: number): Promise<string[] | null> {
    const text = await this.request(`${this.apiBase}/api/0/routeset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planes: [{ callsign, lat, lng: lon }] }),
    });
    return text ? parseRouteset(text, callsign) : null;
  }
}

interface RoutesetEntry {
  callsign?: string;
  airport_codes?: string;
  plausible?: boolean | number;
  _airports?: Array<{ icao?: string }>;
}

/** Best-effort parse of a routeset reply (it has returned an empty body in testing, spec §6.5). */
export function parseRouteset(text: string, callsign: string): string[] | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(body)) return null;
  const entry = (body as RoutesetEntry[]).find((e) => e && e.callsign?.trim().toUpperCase() === callsign);
  if (!entry || entry.plausible === false || entry.plausible === 0) return null;
  const fromList = (entry._airports ?? []).map((a) => a.icao ?? '').filter(Boolean);
  const airports = fromList.length >= 2 ? fromList : (entry.airport_codes ?? '').split('-').filter((c) => /^[A-Z0-9]{3,4}$/.test(c));
  return airports.length >= 2 ? airports : null;
}
