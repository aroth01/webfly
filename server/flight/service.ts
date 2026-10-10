import { type NavDb } from '../../navdata/navdb.ts';
import type { Airport, FlightChoice, FlightView, RoutePoint } from '../../shared/types.ts';
import type { AdsbClient } from '../live/adsb.ts';
import { operatorName } from '../resolve/normalize.ts';
import { resolve } from '../resolve/resolve.ts';
import { decodeRoute, type DecodedRoute } from '../route/decode.ts';
import type { FlightRow, FlightStore } from '../store/flights.ts';

const VIEW_TTL_MS = 60_000;
const SWIM_STALE_MS = 3 * 60_000;
const ROUTE_CACHE_MAX = 500;

export type Lookup =
  | { kind: 'view'; view: FlightView }
  | { kind: 'choices'; choices: FlightChoice[] }
  | { kind: 'error'; status: 400 | 404; code: string; message: string };

export interface SwimStatus {
  enabled: boolean;
  lastMessageAt?: number; // epoch ms of the last kept message
}

export interface FlightServiceDeps {
  store: FlightStore;
  nav: () => NavDb; // a getter, so a new cycle can be swapped in
  adsb: AdsbClient;
  now?: () => number; // epoch ms
  log?: (msg: string) => void;
  swim?: () => SwimStatus;
}

const MESSAGES: Record<string, string> = {
  bad_query: 'Enter an airline code and flight number, like AA558.',
  unknown_airline: 'Unknown airline code. Try the 3-letter ICAO code, like AAL558.',
};

/** Resolves a flight number to a FlightView (spec sections 6.3, 6.5, 7), caching results for 60 s. */
export class FlightService {
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  private readonly views = new Map<string, { at: number; value: Lookup }>();
  private readonly routes = new Map<string, DecodedRoute>();

  constructor(private readonly deps: FlightServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? (() => {});
  }

  async lookup(rawQuery: string): Promise<Lookup> {
    const query = rawQuery.trim();
    const key = query.toUpperCase().replace(/\s+/g, '');
    const hit = this.views.get(key);
    if (hit && this.now() - hit.at < VIEW_TTL_MS) return hit.value;
    const value = await this.compute(query);
    if (value.kind !== 'error') this.views.set(key, { at: this.now(), value });
    return value;
  }

  private async compute(query: string): Promise<Lookup> {
    const r = resolve(query, this.deps.store, Math.floor(this.now() / 1000));
    switch (r.kind) {
      case 'error':
        return { kind: 'error', status: 400, code: r.code, message: MESSAGES[r.code] };
      case 'choices':
        return { kind: 'choices', choices: r.rows.map(toChoice) };
      case 'one':
        return { kind: 'view', view: await this.fromRow(query, r.row) };
      case 'none': {
        for (const callsign of r.candidates) {
          const hit = await this.deps.adsb.aircraft(callsign);
          if (hit && hit.ac.alt_baro !== 'ground') {
            return { kind: 'view', view: await this.fromAirborne(query, callsign, hit.ac.hex, hit.ac.lat as number, hit.ac.lon as number) };
          }
        }
        return { kind: 'error', status: 404, code: 'not_found', message: `No flight ${query.toUpperCase()} found today. Try the operating carrier's code.` };
      }
    }
  }

  private async fromRow(query: string, row: FlightRow): Promise<FlightView> {
    const nav = this.deps.nav();
    const live = await this.deps.adsb.aircraft(row.callsign);
    const view = this.base(query, row.callsign, nav);
    view.gufi = row.gufi;
    view.status = row.status === 'cancelled' ? 'unknown' : row.status;
    if (row.acType) view.acType = row.acType;
    for (const k of ['etd', 'atd', 'eta'] as const) if (row[k] !== undefined) view[k] = row[k];
    if (live) view.hex = live.ac.hex;
    const origin = airport(nav, row.origin);
    const dest = airport(nav, row.dest);
    if (origin) view.origin = origin;
    if (dest) view.dest = dest;

    if (row.routeText) {
      const decoded = this.decode(`${row.gufi}|${row.amendedAt ?? 0}|${nav.cycle}`, row.routeText, nav, row.origin, row.dest, row.callsign);
      view.route = { source: 'filed', text: row.routeText, points: decoded.points, partial: decoded.partial };
      if (row.amendedAt !== undefined) view.route.amendedAt = row.amendedAt;
    } else {
      view.route = this.expectedRoute(nav, row.origin, row.dest, row.callsign);
    }
    return this.withDegraded(view);
  }

  private async fromAirborne(query: string, callsign: string, hex: string, lat: number, lon: number): Promise<FlightView> {
    const nav = this.deps.nav();
    const { origin, dest } = await this.deps.adsb.routeset(callsign, lat, lon);
    const view = this.base(query, callsign, nav);
    view.status = 'active';
    view.hex = hex;
    const o = airport(nav, origin);
    const d = airport(nav, dest);
    if (o) view.origin = o;
    if (d) view.dest = d;
    view.route = this.expectedRoute(nav, origin, dest, callsign);
    return this.withDegraded(view);
  }

  private base(query: string, callsign: string, nav: NavDb): FlightView {
    const view: FlightView = {
      query,
      callsign,
      status: 'unknown',
      route: { source: 'none', points: [], partial: false },
      navCycle: nav.navCycle,
    };
    const operator = operatorName(callsign);
    if (operator) view.operator = operator;
    return view;
  }

  /** Spec section 6.5 steps 2-3: preferred route for the pair, else a great circle, else nothing. */
  private expectedRoute(nav: NavDb, origin: string | undefined, dest: string | undefined, callsign: string): FlightView['route'] {
    const o = origin ? nav.airport(origin) : undefined;
    const d = dest ? nav.airport(dest) : undefined;
    if (!origin || !dest || !o || !d) return { source: 'none', points: [], partial: false };
    const pref = nav.bestPrefRoute(o.id, d.id);
    if (pref) {
      const decoded = this.decode(`pref|${o.id}|${d.id}|${nav.cycle}`, pref.route, nav, origin, dest, callsign);
      return { source: 'expected', text: pref.route, points: decoded.points, partial: decoded.partial };
    }
    const points: RoutePoint[] = [
      { ident: origin, lat: o.lat, lon: o.lon, kind: 'airport' },
      { ident: dest, lat: d.lat, lon: d.lon, kind: 'airport' },
    ];
    return { source: 'expected', points, partial: false };
  }

  private decode(key: string, text: string, nav: NavDb, origin: string | undefined, dest: string | undefined, callsign: string): DecodedRoute {
    const cached = this.routes.get(key);
    if (cached) return cached;
    const opts: { origin?: string; dest?: string } = {};
    if (origin) opts.origin = origin;
    if (dest) opts.dest = dest;
    const decoded = decodeRoute(text, nav, opts);
    if (decoded.unresolved.length) this.log(`route ${callsign}: unresolved ${decoded.unresolved.join(' ')} in "${text}"`);
    if (decoded.dropped.length) this.log(`route ${callsign}: zig-zag dropped ${decoded.dropped.join(' ')} in "${text}"`);
    if (this.routes.size >= ROUTE_CACHE_MAX) this.routes.delete(this.routes.keys().next().value as string);
    this.routes.set(key, decoded);
    return decoded;
  }

  private withDegraded(view: FlightView): FlightView {
    const swim = this.deps.swim?.();
    if (swim?.enabled && (swim.lastMessageAt === undefined || this.now() - swim.lastMessageAt > SWIM_STALE_MS)) view.degraded = 'swim_delayed';
    return view;
  }
}

function airport(nav: NavDb, id: string | undefined): Airport | undefined {
  const a = id ? nav.airport(id) : undefined;
  return a ? { icao: a.icao ?? a.id, name: a.name, lat: a.lat, lon: a.lon } : undefined;
}

function toChoice(r: FlightRow): FlightChoice {
  const c: FlightChoice = { query: r.callsign, callsign: r.callsign, status: r.status };
  if (r.origin) c.origin = r.origin;
  if (r.dest) c.dest = r.dest;
  if (r.etd !== undefined) c.etd = r.etd;
  return c;
}
