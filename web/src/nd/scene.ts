import { bearingDeg, distanceNm, type LatLon } from '../../../shared/geo.ts';
import type { Airport, FlightView, LiveState, NavTile, RoutePoint, Trail } from '../../../shared/types.ts';
import { activeLeg, etaMs } from './activeLeg.ts';
import type { TrackedPosition } from './interpolate.ts';
import { trueToMagnetic } from './projection.ts';

/** Position older than this shows the amber `POS nnS OLD` message (spec section 9.3). */
export const STALE_POS_SEC = 30;

export type RefMode = 'HDG' | 'TRK' | 'N';

export interface DataBlocks {
  gs?: number;
  tas?: number;
  windDir?: number;
  windSpd?: number;
  toIdent?: string;
  toBrgMag?: number;
  toDistNm?: number;
  etaMs?: number;
}

export interface Scene {
  /** Where the display is centred: the aircraft, else the origin airport, else nothing. */
  center: LatLon | null;
  hasPosition: boolean;
  /** True bearing drawn straight up. */
  refTrue: number;
  mode: RefMode;
  varEast: number;
  rangeNm: number;
  route: RoutePoint[];
  routeSource: FlightView['route']['source'];
  routePartial: boolean;
  /** Index into `route` of the TO waypoint, or null. */
  toIdx: number | null;
  /** Aircraft track and heading, true degrees, when known. */
  trackTrue?: number;
  headingTrue?: number;
  trail: Trail;
  traffic: LiveState['traffic'];
  ownAltFt?: number;
  tiles: NavTile[];
  origin?: Airport;
  dest?: Airport;
  blocks: DataBlocks;
  staleSec: number | null;
  frozen: boolean;
  degraded: boolean;
}

export interface SceneInput {
  flight: FlightView;
  live: LiveState | null;
  pos: TrackedPosition | null;
  /** Eased display reference (true degrees) from the animation loop; used when the aircraft has a reference. */
  easedRefTrue?: number;
  varEast: number;
  rangeNm: number;
  prevLegIdx: number;
  nowMs: number;
  tiles: NavTile[];
  trail: Trail;
}

/** What the display is referenced to: heading if the aircraft reports it, else track, else north-up. */
export function referenceFor(live: LiveState | null, pos: TrackedPosition | null): { mode: RefMode; target: number } {
  const ac = live?.aircraft;
  if (pos && ac?.trueHeading !== undefined) return { mode: 'HDG', target: ac.trueHeading };
  if (pos && pos.track !== undefined) return { mode: 'TRK', target: pos.track };
  return { mode: 'N', target: 0 };
}

export function buildScene(i: SceneInput): Scene {
  const { flight, live, pos } = i;
  const ac = live?.aircraft ?? null;
  const hasPosition = pos !== null;
  const originPt = flight.origin ?? flight.dest;
  const center: LatLon | null = pos ?? (originPt ? { lat: originPt.lat, lon: originPt.lon } : null);
  const ref = referenceFor(live, pos);

  const scene: Scene = {
    center,
    hasPosition,
    refTrue: ref.mode === 'N' ? 0 : (i.easedRefTrue ?? ref.target),
    mode: ref.mode,
    varEast: i.varEast,
    rangeNm: i.rangeNm,
    route: flight.route.points,
    routeSource: flight.route.source,
    routePartial: flight.route.partial,
    toIdx: null,
    trail: i.trail,
    traffic: live?.traffic ?? [],
    tiles: i.tiles,
    blocks: {},
    staleSec: pos && pos.ageSec > STALE_POS_SEC ? Math.round(pos.ageSec) : null,
    frozen: pos?.frozen ?? false,
    degraded: flight.degraded === 'swim_delayed',
  };
  if (pos?.track !== undefined) scene.trackTrue = pos.track;
  if (ac?.trueHeading !== undefined) scene.headingTrue = ac.trueHeading;
  if (ac?.altBaro !== undefined) scene.ownAltFt = ac.altBaro;
  if (flight.origin) scene.origin = flight.origin;
  if (flight.dest) scene.dest = flight.dest;

  const b = scene.blocks;
  const gs = pos?.gs ?? ac?.gs;
  if (gs !== undefined) b.gs = gs;
  if (ac?.tas !== undefined) b.tas = ac.tas;
  if (ac?.windDir !== undefined) b.windDir = ac.windDir;
  if (ac?.windSpd !== undefined) b.windSpd = ac.windSpd;

  if (pos && scene.route.length > 0) {
    const leg = activeLeg(scene.route, pos, i.prevLegIdx);
    if (leg) {
      scene.toIdx = leg.toIdx;
      const to = scene.route[leg.toIdx];
      b.toIdent = to.ident;
      b.toBrgMag = trueToMagnetic(bearingDeg(pos, to), i.varEast);
      b.toDistNm = distanceNm(pos, to);
      const eta = etaMs(leg.remainingNm, gs, i.nowMs);
      if (eta !== null) b.etaMs = eta;
    }
  }
  return scene;
}
