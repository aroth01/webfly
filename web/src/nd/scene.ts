import { distanceNm, interpolateGc, normalizeDeg, type LatLon } from '../../../shared/geo.ts';
import type { FlightView, LiveAircraft, NavTile, RoutePoint, Traffic } from '../../../shared/types.ts';
import { declutterFor, type Declutter } from './declutter.ts';
import { fmtRelAlt } from './format.ts';
import { toWaypoint } from './toWaypoint.ts';

export type DisplayMode = 'TRK' | 'HDG' | 'NORTH';

export interface SceneTraffic {
  lat: number;
  lon: number;
  relAlt?: string; // "+12" / "-05"
  above?: boolean;
  trend?: 'up' | 'down';
  proximate: boolean; // < 6 nm and within ±1,200 ft (spec §9.3)
}

export interface SceneRoutePoint extends RoutePoint {
  role: 'wpt' | 'to' | 'airport';
}

export interface Scene {
  center: LatLon; // what the ND is centred on: the aircraft, or the origin when there is no position
  noPosition: boolean;
  upTrue: number; // true bearing that points up
  magVar: number; // east positive
  mode: DisplayMode;
  refMag: number; // displayed TRK/HDG value
  trackDiamond?: number; // display angle of the track diamond (HDG mode)
  range: number;
  declutter: Declutter;
  routeLine: LatLon[][]; // densified polylines, starting at the active leg
  routePoints: SceneRoutePoint[];
  navaids: NavTile['navaids'];
  airports: NavTile['airports'];
  traffic: SceneTraffic[];
  trail: LatLon[];
  data: {
    gs?: number;
    tas?: number;
    windDirMag?: number;
    windSpd?: number;
    windArrow?: number; // display angle the wind blows toward
    to?: { ident: string; brgMag: number; distNm: number; etaMs?: number };
    posOldSec?: number; // set when the position is more than 30 s old
  };
}

export interface SceneInput {
  now: number;
  flight: FlightView;
  live: LiveAircraft | null;
  traffic: Traffic[];
  trail: LatLon[];
  tiles: NavTile[];
  range: number;
  route: DensifiedRoute;
  ownPos: LatLon | undefined; // interpolated
  upTrue: number; // eased display reference
  magVar: number;
  posAgeSec?: number;
  activeLeg: number;
}

/** Route legs split into short great-circle steps, for drawing only (computed once per route). */
export type DensifiedRoute = LatLon[][];

const STALE_POS_SEC = 30;
const PROXIMATE_NM = 6;
const PROXIMATE_FT = 1_200;
const TREND_FPM = 500;

export function densifyRoute(points: LatLon[], stepNm = 20): DensifiedRoute {
  const legs: DensifiedRoute = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i] as LatLon;
    const b = points[i + 1] as LatLon;
    const n = Math.max(1, Math.ceil(distanceNm(a, b) / stepNm));
    const leg: LatLon[] = [];
    for (let k = 0; k <= n; k++) leg.push(k === 0 ? a : k === n ? b : interpolateGc(a, b, k / n));
    legs.push(leg);
  }
  return legs;
}

export function buildScene(input: SceneInput): Scene {
  const { flight, live, ownPos, magVar, range } = input;
  const points = flight.route.points;
  const noPosition = ownPos === undefined;
  const center: LatLon = ownPos ?? flight.origin ?? points[0] ?? flight.dest ?? { lat: 39, lon: -98 };
  const mode: DisplayMode = noPosition ? 'NORTH' : live?.trueHeading !== undefined ? 'HDG' : 'TRK';
  const upTrue = noPosition ? 0 : input.upTrue;
  const declutter = declutterFor(range);

  const fromIdx = noPosition ? 0 : Math.min(input.activeLeg, Math.max(0, points.length - 2));
  const toIdx = noPosition || points.length < 2 ? -1 : fromIdx + 1;
  const last = points.length - 1;
  const routePoints: SceneRoutePoint[] = points
    .map((p, i): SceneRoutePoint | undefined => {
      const role = p.kind === 'airport' && (i === 0 || i === last) ? 'airport' : i === toIdx ? 'to' : 'wpt';
      // Sequenced (passed) waypoints disappear, as on an FMS; the origin airport stays.
      return i < fromIdx && role !== 'airport' ? undefined : { ...p, role };
    })
    .filter((p): p is SceneRoutePoint => p !== undefined);
  // Show origin/destination even when the route doesn't (no route, or a route that stops short).
  for (const a of [flight.origin, flight.dest]) {
    if (a && !routePoints.some((p) => p.role === 'airport' && p.ident === a.icao)) {
      routePoints.push({ ident: a.icao, lat: a.lat, lon: a.lon, kind: 'airport', role: 'airport' });
    }
  }

  const routeIdents = new Set(points.map((p) => p.ident));
  const navaids: NavTile['navaids'] = [];
  const airports: NavTile['airports'] = [];
  for (const t of input.tiles) {
    for (const n of t.navaids) if (declutter.navaidTypes.has(n.type) && !routeIdents.has(n.ident)) navaids.push(n);
    if (declutter.airports) {
      for (const a of t.airports) {
        if (a.rwyFt < declutter.minRwyFt) continue;
        if (!routeIdents.has(a.icao) && a.icao !== flight.origin?.icao && a.icao !== flight.dest?.icao) airports.push(a);
      }
    }
  }

  const ownAlt = live?.onGround ? undefined : live?.altBaro;
  const traffic: SceneTraffic[] = noPosition
    ? []
    : input.traffic.map((t) => {
        const dAlt = ownAlt !== undefined && t.alt !== undefined ? t.alt - ownAlt : undefined;
        const s: SceneTraffic = {
          lat: t.lat,
          lon: t.lon,
          proximate: dAlt !== undefined && Math.abs(dAlt) <= PROXIMATE_FT && distanceNm(center, t) < PROXIMATE_NM,
        };
        const rel = fmtRelAlt(ownAlt, t.alt);
        if (rel !== undefined && dAlt !== undefined) {
          s.relAlt = rel;
          s.above = dAlt > 0;
        }
        if (t.vs !== undefined && Math.abs(t.vs) > TREND_FPM) s.trend = t.vs > 0 ? 'up' : 'down';
        return s;
      });

  const scene: Scene = {
    center,
    noPosition,
    upTrue,
    magVar,
    mode,
    refMag: normalizeDeg(upTrue - magVar),
    range,
    declutter,
    routeLine: input.route.slice(noPosition ? 0 : fromIdx),
    routePoints,
    navaids,
    airports,
    traffic,
    trail: input.trail,
    data: {},
  };
  if (mode === 'HDG' && live?.track !== undefined) scene.trackDiamond = normalizeDeg(live.track - upTrue);

  if (live && !noPosition) {
    if (live.gs !== undefined) scene.data.gs = live.gs;
    if (live.tas !== undefined) scene.data.tas = live.tas;
    if (live.windDir !== undefined && live.windSpd !== undefined) {
      scene.data.windDirMag = normalizeDeg(live.windDir - magVar);
      scene.data.windSpd = live.windSpd;
      scene.data.windArrow = normalizeDeg(live.windDir + 180 - upTrue);
    }
    const to = ownPos && toWaypoint(points, ownPos, fromIdx, live.gs, input.now);
    if (to) {
      scene.data.to = { ident: (points[to.index] as RoutePoint).ident, brgMag: normalizeDeg(to.brgTrue - magVar), distNm: to.distNm };
      if (to.etaMs !== undefined) scene.data.to.etaMs = to.etaMs;
    }
  }
  if (input.posAgeSec !== undefined && input.posAgeSec > STALE_POS_SEC) scene.data.posOldSec = Math.round(input.posAgeSec);
  return scene;
}
