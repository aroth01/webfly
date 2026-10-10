// Development only (`--sim`): stored active flights fly their decoded routes, with synthetic traffic around them.
import type { NavDb } from '../../navdata/navdb.ts';
import { bearingDeg, destinationPoint, distanceNm, interpolateGc, normalizeDeg, type LatLon } from '../../shared/geo.ts';
import type { RoutePoint } from '../../shared/types.ts';
import { decodeRoute } from '../route/decode.ts';
import type { FlightRecord, FlightStore } from '../store/flights.ts';
import type { AdsbAircraft, AdsbSource, TraceFull, TracePoint } from './adsb.ts';

const CRUISE_FT = 35_000;
const CLIMB_FPM = 2_500;
const DESCENT_FT_PER_NM = 318; // 3° path
const WIND = { dir: 260, spd: 45 }; // true, kt
const TRAFFIC_COUNT = 12;

/** Deterministic 0..1 pseudo-random numbers from an integer seed. */
function rand(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const hexOf = (s: string) => (hash(s) & 0xffffff).toString(16).padStart(6, '0');

interface SimState {
  pos: LatLon;
  track: number;
  gs: number;
  alt: number;
  vs: number;
  onGround: boolean;
}

export interface SimOptions {
  flights: FlightStore;
  nav: () => NavDb;
  now?: () => number;
  fallback?: AdsbSource;
}

export class SimAdsbSource implements AdsbSource {
  private readonly opts: SimOptions;
  private readonly now: () => number;
  private readonly routes = new Map<string, { points: RoutePoint[]; cum: number[] }>();

  constructor(opts: SimOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
  }

  private route(rec: FlightRecord): { points: RoutePoint[]; cum: number[] } | undefined {
    if (!rec.routeText) return undefined;
    const db = this.opts.nav();
    const key = `${db.cycle}|${rec.gufi}|${rec.routeText}`;
    let r = this.routes.get(key);
    if (!r) {
      const opts: { origin?: string; dest?: string } = {};
      if (rec.origin) opts.origin = rec.origin;
      if (rec.dest) opts.dest = rec.dest;
      const points = decodeRoute(rec.routeText, db, opts).points;
      const cum = [0];
      for (let i = 1; i < points.length; i++) cum.push((cum[i - 1] as number) + distanceNm(points[i - 1] as LatLon, points[i] as LatLon));
      r = { points, cum };
      this.routes.set(key, r);
    }
    return r.points.length >= 2 ? r : undefined;
  }

  private flight(callsign: string): FlightRecord | undefined {
    return this.opts.flights.byCallsigns([callsign]).find((r) => r.status === 'active' && r.atd !== undefined && r.routeText);
  }

  /** Where a simulated flight is at time t (epoch ms). */
  stateAt(rec: FlightRecord, t: number): SimState | undefined {
    const r = this.route(rec);
    if (!r || rec.atd === undefined) return undefined;
    const total = r.cum[r.cum.length - 1] as number;
    const hours = rec.eta !== undefined && rec.eta > rec.atd ? (rec.eta - rec.atd) / 3600 : total / 450;
    const gs = Math.max(250, Math.min(520, total / hours));
    const elapsedH = Math.max(0, (t / 1000 - rec.atd) / 3600);
    const flown = Math.min(total, elapsedH * gs);
    let i = 1;
    while (i < r.cum.length - 1 && (r.cum[i] as number) < flown) i++;
    const a = r.points[i - 1] as LatLon;
    const b = r.points[i] as LatLon;
    const legLen = (r.cum[i] as number) - (r.cum[i - 1] as number);
    const f = legLen > 0 ? (flown - (r.cum[i - 1] as number)) / legLen : 1;
    const pos = interpolateGc(a, b, f);
    const track = bearingDeg(f < 1 ? pos : a, f < 1 ? b : interpolateGc(a, b, 1));
    const climbAlt = elapsedH * 60 * CLIMB_FPM;
    const descentAlt = (total - flown) * DESCENT_FT_PER_NM;
    const alt = Math.max(0, Math.min(CRUISE_FT, climbAlt, descentAlt));
    const vs = alt >= CRUISE_FT ? 0 : climbAlt <= descentAlt ? CLIMB_FPM : -Math.round((gs / 60) * DESCENT_FT_PER_NM);
    return { pos, track, gs: flown >= total ? 0 : gs, alt: Math.round(alt / 25) * 25, vs, onGround: flown >= total };
  }

  async byCallsign(callsign: string): Promise<AdsbAircraft[]> {
    const rec = this.flight(callsign);
    const now = this.now();
    const s = rec && this.stateAt(rec, now);
    if (!s) return this.opts.fallback ? this.opts.fallback.byCallsign(callsign) : [];
    // Wind triangle: the heading that holds the track, and the airspeed that gives this ground speed.
    const rel = ((WIND.dir - s.track) * Math.PI) / 180;
    const tas = s.gs + WIND.spd * Math.cos(rel);
    const wca = (Math.asin((WIND.spd * Math.sin(rel)) / Math.max(tas, 1)) * 180) / Math.PI;
    const ac: AdsbAircraft = {
      hex: hexOf(callsign),
      callsign,
      lat: s.pos.lat,
      lon: s.pos.lon,
      onGround: s.onGround,
      gs: s.gs,
      track: s.track,
      vs: s.vs,
      posTime: now,
    };
    if (!s.onGround) {
      Object.assign(ac, { altBaro: s.alt, tas: Math.round(tas), trueHeading: normalizeDeg(s.track + wca), windDir: WIND.dir, windSpd: WIND.spd });
    }
    return [ac];
  }

  async around(lat: number, lon: number, radiusNm: number): Promise<AdsbAircraft[]> {
    const now = this.now();
    const epoch = Math.floor(now / 600_000); // traffic is re-dealt every 10 minutes
    const rnd = rand(hash(`${lat.toFixed(1)},${lon.toFixed(1)},${epoch}`));
    const out: AdsbAircraft[] = [];
    for (let k = 0; k < TRAFFIC_COUNT; k++) {
      const base = destinationPoint({ lat, lon }, rnd() * 360, 3 + rnd() * (radiusNm - 8));
      const track = rnd() * 360;
      const gs = 280 + rnd() * 220;
      const pos = destinationPoint(base, track, (gs * (now - epoch * 600_000)) / 3_600_000);
      if (distanceNm(pos, { lat, lon }) > radiusNm) continue;
      const climbing = rnd();
      out.push({
        hex: hexOf(`traffic-${epoch}-${k}`),
        callsign: `SIM${100 + k}`,
        lat: pos.lat,
        lon: pos.lon,
        altBaro: Math.round((24_000 + rnd() * 16_000) / 100) * 100,
        onGround: false,
        gs,
        track,
        vs: climbing < 0.2 ? 1_500 : climbing > 0.8 ? -1_200 : 0,
        posTime: now,
      });
    }
    return out;
  }

  async trace(hex: string): Promise<TraceFull | null> {
    const f = this.opts.flights.active().find((r) => hexOf(r.callsign) === hex && this.route(r));
    if (!f || f.atd === undefined) return this.opts.fallback ? this.opts.fallback.trace(hex) : null;
    const start = f.atd * 1000;
    const trace: TracePoint[] = [];
    for (let t = start; t <= this.now(); t += 20_000) {
      const s = this.stateAt(f, t) as SimState;
      trace.push([(t - start) / 1000, s.pos.lat, s.pos.lon, s.onGround ? 'ground' : s.alt, s.gs, s.track, 0, s.vs, trace.length === 0 ? { flight: f.callsign } : null]);
    }
    return { icao: hex, timestamp: f.atd, trace };
  }

  async routeset(callsign: string, lat: number, lon: number): Promise<string[] | null> {
    return this.opts.fallback ? this.opts.fallback.routeset(callsign, lat, lon) : null;
  }
}
