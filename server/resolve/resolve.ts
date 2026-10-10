import type { NavDb } from '../../navdata/navdb.ts';
import { distanceNm, type LatLon } from '../../shared/geo.ts';
import type { Airport, FlightChoice, FlightView, RoutePoint } from '../../shared/types.ts';
import type { AdsbAircraft } from '../live/adsb.ts';
import type { LiveService } from '../live/live.ts';
import { decodeRoute, type DecodedRoute } from '../route/decode.ts';
import type { FlightRecord, FlightStore } from '../store/flights.ts';
import { isSwimDelayed, type SwimStatus } from '../swim/status.ts';
import type { AirlineDb } from './airlines.ts';
import { candidateCallsigns, normalizeQuery } from './normalize.ts';
import { rankFlights } from './rank.ts';

export type ResolveResult =
  | { kind: 'flight'; view: FlightView }
  | { kind: 'choices'; choices: FlightChoice[] }
  | { kind: 'error'; status: 400 | 404; code: string; message: string };

export interface ResolverDeps {
  nav: () => NavDb; // a getter: the nav DB is swapped when a new NASR cycle loads
  flights: FlightStore;
  live: LiveService;
  airlines: AirlineDb;
  swim: () => SwimStatus;
  now?: () => number; // epoch ms
}

type Route = FlightView['route'];

const RESULT_TTL_MS = 60_000;
const ROUTE_CACHE_MAX = 2_000;
/** /api/flight shouldn't wait long on adsb.lol just to learn the transponder hex. */
const HEX_LOOKUP_MS = 2_000;
/** Preferred-route types in order of preference for an airliner. */
const PREF_TYPE_ORDER = ['H', 'L', 'TEC', 'NAR'];

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    timer.unref?.();
    p.then(resolve, () => resolve(fallback)).finally(() => clearTimeout(timer));
  });
}

function airportOf(db: NavDb, code: string | undefined): Airport | undefined {
  const a = code ? db.airport(code) : undefined;
  return a && { icao: a.icao ?? a.id, name: a.name, lat: a.lat, lon: a.lon };
}

function airportPoint(db: NavDb, code: string): RoutePoint | undefined {
  const a = db.airport(code);
  return a && { ident: code, lat: a.lat, lon: a.lon, kind: 'airport' };
}

/** The leg of a multi-stop route the aircraft is on: the pair it deviates least from. */
function pickLeg(db: NavDb, airports: string[], pos: LatLon): [string, string] | undefined {
  let best: [string, string] | undefined;
  let bestDetour = Infinity;
  for (let i = 0; i + 1 < airports.length; i++) {
    const a = db.airport(airports[i] as string);
    const b = db.airport(airports[i + 1] as string);
    if (!a || !b) continue;
    const detour = distanceNm(a, pos) + distanceNm(pos, b) - distanceNm(a, b);
    if (detour < bestDetour) {
      bestDetour = detour;
      best = [airports[i] as string, airports[i + 1] as string];
    }
  }
  return best;
}

/** Turns a typed flight number into a FlightView, a pick list or an error (spec §7, §6.5). */
export class FlightResolver {
  private readonly deps: ResolverDeps;
  private readonly now: () => number;
  private readonly results = new Map<string, { at: number; result: ResolveResult }>();
  private readonly routes = new Map<string, DecodedRoute>();

  constructor(deps: ResolverDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  async resolve(input: string): Promise<ResolveResult> {
    const q = normalizeQuery(input);
    if (!q) return { kind: 'error', status: 400, code: 'malformed_query', message: 'Enter an airline code and flight number, like AA558.' };
    const candidates = candidateCallsigns(q, this.deps.airlines);
    if (!candidates) return { kind: 'error', status: 400, code: 'unknown_airline', message: `Unknown airline code "${q.code}".` };

    // "AA558" and "AAL558" search the same callsigns, so they share a cache entry.
    const key = candidates.join(',');
    const now = this.now();
    let cached = this.results.get(key);
    if (!cached || now - cached.at >= RESULT_TTL_MS) {
      cached = { at: now, result: await this.lookup(candidates) };
      this.results.set(key, cached);
      this.pruneResults(now);
    }
    return this.personalize(cached.result, input.trim(), q.code + q.number, now);
  }

  /** Per-request fields: what this user typed, and the live SWIM health flag. */
  private personalize(result: ResolveResult, query: string, display: string, now: number): ResolveResult {
    if (result.kind === 'error' && result.code === 'not_found') {
      return { ...result, message: `No flight ${display} found today. Try the operating carrier's code.` };
    }
    if (result.kind !== 'flight') return result;
    const view: FlightView = { ...result.view, query };
    if (isSwimDelayed(this.deps.swim(), now)) view.degraded = 'swim_delayed';
    return { kind: 'flight', view };
  }

  private pruneResults(now: number): void {
    if (this.results.size < 1_000) return;
    for (const [k, v] of this.results) if (now - v.at >= RESULT_TTL_MS) this.results.delete(k);
  }

  private async lookup(candidates: string[]): Promise<ResolveResult> {
    const rows = this.deps.flights.byCallsigns(candidates);
    const ranked = rankFlights(rows, Math.floor(this.now() / 1000));
    if (ranked.kind === 'winner') return { kind: 'flight', view: await this.viewFromPlan(ranked.flight) };
    if (ranked.kind === 'choices') {
      return {
        kind: 'choices',
        choices: ranked.flights.map((r) => {
          const c: FlightChoice = { query: r.callsign, callsign: r.callsign, status: r.status };
          if (r.origin) c.origin = r.origin;
          if (r.dest) c.dest = r.dest;
          if (r.etd !== undefined) c.etd = r.etd;
          return c;
        }),
      };
    }
    return (await this.liveFallback(candidates)) ?? { kind: 'error', status: 404, code: 'not_found', message: 'No flight found today.' };
  }

  private async viewFromPlan(rec: FlightRecord): Promise<FlightView> {
    const db = this.deps.nav();
    const view: FlightView = {
      query: rec.callsign,
      callsign: rec.callsign,
      gufi: rec.gufi,
      status: rec.status === 'cancelled' ? 'unknown' : rec.status,
      route: rec.routeText ? this.filedRoute(db, rec) : this.expectedRoute(db, rec.origin, rec.dest),
      navCycle: db.airac,
    };
    const operator = this.deps.airlines.operatorOf(rec.callsign);
    if (operator) view.operator = operator;
    if (rec.acType) view.acType = rec.acType;
    const origin = airportOf(db, rec.origin);
    const dest = airportOf(db, rec.dest);
    if (origin) view.origin = origin;
    if (dest) view.dest = dest;
    if (rec.etd !== undefined) view.etd = rec.etd;
    if (rec.atd !== undefined) view.atd = rec.atd;
    if (rec.eta !== undefined) view.eta = rec.eta;
    if (rec.status !== 'arrived') {
      const ac = await withTimeout(this.deps.live.aircraft(rec.callsign), HEX_LOOKUP_MS, null);
      if (ac) view.hex = ac.hex;
    }
    return view;
  }

  private decodeCached(db: NavDb, text: string, origin?: string, dest?: string): DecodedRoute {
    const key = `${db.cycle}|${origin ?? ''}|${dest ?? ''}|${text}`;
    let decoded = this.routes.get(key);
    if (!decoded) {
      const opts: { origin?: string; dest?: string } = {};
      if (origin) opts.origin = origin;
      if (dest) opts.dest = dest;
      decoded = decodeRoute(text, db, opts);
      if (decoded.partial) {
        console.warn(`route ${origin ?? '?'}-${dest ?? '?'}: unresolved [${decoded.unresolved.join(' ')}] dropped [${decoded.dropped.join(' ')}]`);
      }
      if (this.routes.size >= ROUTE_CACHE_MAX) this.routes.delete(this.routes.keys().next().value as string);
      this.routes.set(key, decoded);
    }
    return decoded;
  }

  private filedRoute(db: NavDb, rec: FlightRecord): Route {
    const d = this.decodeCached(db, rec.routeText as string, rec.origin, rec.dest);
    const route: Route = { source: 'filed', text: rec.routeText as string, points: d.points, partial: d.partial };
    if (rec.amendedAt !== undefined) route.amendedAt = rec.amendedAt;
    return route;
  }

  /** Spec §6.5 step 2: the FAA preferred route for the pair, else a great circle. */
  private expectedRoute(db: NavDb, origin?: string, dest?: string): Route {
    const o = origin ? db.airport(origin) : undefined;
    const d = dest ? db.airport(dest) : undefined;
    if (!origin || !dest || !o || !d) return { source: 'none', points: [], partial: false };
    const rank = (t: string) => {
      const i = PREF_TYPE_ORDER.indexOf(t);
      return i < 0 ? PREF_TYPE_ORDER.length : i;
    };
    const prefs = [...db.prefRoutes(o.id, d.id)].sort((a, b) => rank(a.type) - rank(b.type));
    // Preferred routes name airports by FAA id ("DFW"); show them by ICAO id like filed routes do.
    const icaoIdent = (pt: RoutePoint): RoutePoint => {
      const a = pt.kind === 'airport' ? db.airport(pt.ident) : undefined;
      return a?.icao && a.icao !== pt.ident ? { ...pt, ident: a.icao } : pt;
    };
    let fallback: Route | undefined;
    for (const p of prefs) {
      const decoded = this.decodeCached(db, p.route, origin, dest);
      const route: Route = { source: 'expected', text: p.route, points: decoded.points.map(icaoIdent), partial: decoded.partial };
      if (!decoded.partial) return route;
      fallback ??= route;
    }
    if (fallback) return fallback;
    return { source: 'expected', points: [airportPoint(db, origin), airportPoint(db, dest)] as RoutePoint[], partial: false };
  }

  /** Spec §7.5: no stored plan, so ask adsb.lol about every candidate callsign. */
  private async liveFallback(candidates: string[]): Promise<ResolveResult | undefined> {
    const settled = await Promise.allSettled(candidates.map((cs) => this.deps.live.aircraft(cs)));
    const hits: Array<[string, AdsbAircraft]> = [];
    settled.forEach((s, i) => {
      if (s.status === 'fulfilled' && s.value) hits.push([candidates[i] as string, s.value]);
    });
    if (hits.length === 0) return undefined;
    if (hits.length > 1) {
      return {
        kind: 'choices',
        choices: hits.map(([cs, ac]) => ({ query: cs, callsign: cs, status: ac.onGround ? 'unknown' : 'active' })),
      };
    }
    const [callsign, ac] = hits[0] as [string, AdsbAircraft];
    const db = this.deps.nav();
    const airports = await this.deps.live.routeset(callsign, ac.lat, ac.lon);
    const leg = airports ? pickLeg(db, airports, ac) : undefined;
    const view: FlightView = {
      query: callsign,
      callsign,
      status: ac.onGround ? 'unknown' : 'active',
      route: this.expectedRoute(db, leg?.[0], leg?.[1]),
      hex: ac.hex,
      navCycle: db.airac,
    };
    const operator = this.deps.airlines.operatorOf(callsign);
    if (operator) view.operator = operator;
    const origin = airportOf(db, leg?.[0]);
    const dest = airportOf(db, leg?.[1]);
    if (origin) view.origin = origin;
    if (dest) view.dest = dest;
    return { kind: 'flight', view };
  }
}
