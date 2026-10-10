import { distanceNm } from '../../shared/geo.ts';
import type { LiveAircraft, LiveState, Trail, Traffic } from '../../shared/types.ts';
import type { AdsbAircraft, AdsbSource, TraceFull } from './adsb.ts';
import { TtlCache } from './cache.ts';
import { trimTrace } from './trail.ts';

/** adsb.lol failed and there is no earlier value to fall back on. */
export class LiveUnavailableError extends Error {
  override name = 'LiveUnavailableError';
}

const TRAFFIC_RADIUS_NM = 40;
/** The query is centred on the 0.1° cell, up to ~4 nm from the subject, so ask a little wider. */
const TRAFFIC_QUERY_NM = 45;
const MAX_TRAFFIC_AGE_S = 60;

function toLive(ac: AdsbAircraft, now: number): LiveAircraft {
  const live: LiveAircraft = {
    hex: ac.hex,
    lat: ac.lat,
    lon: ac.lon,
    onGround: ac.onGround,
    ageSec: Math.max(0, Math.round((now - ac.posTime) / 100) / 10),
  };
  if (ac.altBaro !== undefined) live.altBaro = ac.altBaro;
  if (ac.gs !== undefined) live.gs = ac.gs;
  if (ac.track !== undefined) live.track = ac.track;
  if (ac.vs !== undefined) live.vs = ac.vs;
  if (ac.tas !== undefined) live.tas = ac.tas;
  if (ac.trueHeading !== undefined) live.trueHeading = ac.trueHeading;
  if (ac.windDir !== undefined) live.windDir = ac.windDir;
  if (ac.windSpd !== undefined) live.windSpd = ac.windSpd;
  return live;
}

function toTraffic(ac: AdsbAircraft): Traffic {
  const t: Traffic = { hex: ac.hex, lat: ac.lat, lon: ac.lon };
  if (ac.callsign) t.callsign = ac.callsign;
  if (ac.altBaro !== undefined) t.alt = ac.altBaro;
  if (ac.track !== undefined) t.track = ac.track;
  if (ac.vs !== undefined) t.vs = ac.vs;
  return t;
}

/** Live position, traffic and trail from adsb.lol behind shared caches (spec §6.4). */
export class LiveService {
  private readonly source: AdsbSource;
  private readonly now: () => number;
  private readonly aircraftCache: TtlCache<string, AdsbAircraft | null>;
  private readonly trafficCache: TtlCache<string, AdsbAircraft[]>;
  private readonly traceCache: TtlCache<string, TraceFull | null>;
  private readonly routeCache: TtlCache<string, string[] | null>;

  constructor(source: AdsbSource, now: () => number = Date.now) {
    this.source = source;
    this.now = now;
    this.aircraftCache = new TtlCache(5_000, 5_000, now);
    this.trafficCache = new TtlCache(5_000, 5_000, now);
    this.traceCache = new TtlCache(30_000, 1_000, now);
    this.routeCache = new TtlCache(600_000, 1_000, now);
  }

  /** The aircraft flying `callsign` (freshest position wins), or null if adsb.lol doesn't see it. */
  async aircraft(callsign: string): Promise<AdsbAircraft | null> {
    try {
      const hit = await this.aircraftCache.get(callsign, async () => {
        const list = await this.source.byCallsign(callsign);
        return list.reduce<AdsbAircraft | null>((best, ac) => (!best || ac.posTime > best.posTime ? ac : best), null);
      });
      return hit.value;
    } catch (err) {
      throw new LiveUnavailableError((err as Error).message);
    }
  }

  async liveState(callsign: string): Promise<LiveState> {
    const ac = await this.aircraft(callsign);
    const now = this.now();
    return { t: now, aircraft: ac && toLive(ac, now), traffic: ac ? await this.traffic(ac, now) : [] };
  }

  private async traffic(subject: AdsbAircraft, now: number): Promise<Traffic[]> {
    const cellLat = Math.round(subject.lat * 10);
    const cellLon = Math.round(subject.lon * 10);
    let list: AdsbAircraft[];
    try {
      list = (await this.trafficCache.get(`${cellLat}/${cellLon}`, () => this.source.around(cellLat / 10, cellLon / 10, TRAFFIC_QUERY_NM))).value;
    } catch {
      return [];
    }
    return list
      .filter(
        (ac) =>
          ac.hex !== subject.hex &&
          !ac.onGround &&
          now - ac.posTime <= MAX_TRAFFIC_AGE_S * 1000 &&
          distanceNm(ac, subject) <= TRAFFIC_RADIUS_NM,
      )
      .map(toTraffic);
  }

  /** Current-leg trail; empty when adsb.lol has no trace or the request fails (the trail then starts live). */
  async trail(hex: string, callsign?: string): Promise<Trail> {
    try {
      const trace = (await this.traceCache.get(hex, () => this.source.trace(hex))).value;
      return trace ? trimTrace(trace, callsign) : [];
    } catch {
      return [];
    }
  }

  /** Airports adsb.lol associates with the callsign, or null when unknown or unavailable. */
  async routeset(callsign: string, lat: number, lon: number): Promise<string[] | null> {
    try {
      return (await this.routeCache.get(callsign, () => this.source.routeset(callsign, lat, lon))).value;
    } catch {
      return null;
    }
  }
}
