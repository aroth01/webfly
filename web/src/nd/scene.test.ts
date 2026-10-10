import { describe, expect, it } from 'vitest';
import { distanceNm } from '../../../shared/geo.ts';
import type { FlightView, LiveState } from '../../../shared/types.ts';
import type { TrackedPosition } from './interpolate.ts';
import { buildScene, referenceFor, type SceneInput } from './scene.ts';

const flight: FlightView = {
  query: 'AA1',
  callsign: 'AAL1',
  status: 'active',
  navCycle: '2610',
  origin: { icao: 'KAAA', name: 'A', lat: 30, lon: -100 },
  dest: { icao: 'KBBB', name: 'B', lat: 30, lon: -90 },
  route: {
    source: 'filed',
    partial: false,
    points: [
      { ident: 'KAAA', lat: 30, lon: -100, kind: 'airport' },
      { ident: 'MID', lat: 30, lon: -95, kind: 'fix' },
      { ident: 'KBBB', lat: 30, lon: -90, kind: 'airport' },
    ],
  },
};
const live = (o: Partial<NonNullable<LiveState['aircraft']>> = {}): LiveState => ({
  t: 0,
  aircraft: { hex: 'a', lat: 30, lon: -97, onGround: false, ageSec: 1, ...o },
  traffic: [],
});
const pos = (o: Partial<TrackedPosition> = {}): TrackedPosition => ({ lat: 30, lon: -97, ageSec: 1, frozen: false, track: 90, gs: 450, ...o });
const input = (o: Partial<SceneInput> = {}): SceneInput => ({ flight, live: live(), pos: pos(), varEast: 5, rangeNm: 80, prevLegIdx: 0, nowMs: 0, tiles: [], trail: [], ...o });

describe('referenceFor', () => {
  it('prefers heading, then track, then north-up', () => {
    expect(referenceFor(live({ trueHeading: 88 }), pos())).toEqual({ mode: 'HDG', target: 88 });
    expect(referenceFor(live(), pos())).toEqual({ mode: 'TRK', target: 90 });
    expect(referenceFor(live(), pos({ track: undefined }))).toEqual({ mode: 'N', target: 0 });
    expect(referenceFor(null, null)).toEqual({ mode: 'N', target: 0 });
  });
});

describe('buildScene', () => {
  it('computes the TO waypoint block and ETA', () => {
    const s = buildScene(input({ nowMs: 1000 }));
    expect(s.toIdx).toBe(1);
    expect(s.blocks.toIdent).toBe('MID');
    expect(Math.abs(s.blocks.toBrgMag! - 85)).toBeLessThan(1); // true ~90 minus 5 east variation
    expect(s.blocks.toDistNm).toBeGreaterThan(100);
    const remaining = distanceNm({ lat: 30, lon: -97 }, flight.route.points[1]) + distanceNm(flight.route.points[1], flight.route.points[2]);
    expect(s.blocks.etaMs).toBeCloseTo(1000 + (remaining / 450) * 3_600_000, -2);
    expect(s.mode).toBe('TRK');
    expect(s.staleSec).toBeNull();
  });
  it('shows dashes (omits values) when the aircraft reports no speeds or wind', () => {
    const s = buildScene(input({ pos: pos({ gs: undefined, track: undefined }) }));
    expect(s.blocks.gs).toBeUndefined();
    expect(s.blocks.tas).toBeUndefined();
    expect(s.blocks.etaMs).toBeUndefined();
    expect(s.mode).toBe('N');
    expect(s.refTrue).toBe(0);
  });
  it('centres on the origin airport with no position', () => {
    const s = buildScene(input({ live: live(), pos: null }));
    expect(s.hasPosition).toBe(false);
    expect(s.center).toEqual({ lat: 30, lon: -100 });
    expect(s.mode).toBe('N');
    expect(s.toIdx).toBeNull();
  });
  it('has no centre when there is neither a position nor an airport', () => {
    const { origin: _o, dest: _d, ...bare } = flight;
    expect(buildScene(input({ flight: bare, pos: null })).center).toBeNull();
  });
  it('flags stale positions and a frozen aircraft', () => {
    const s = buildScene(input({ pos: pos({ ageSec: 45.4, frozen: false }) }));
    expect(s.staleSec).toBe(45);
    expect(buildScene(input({ pos: pos({ ageSec: 90, frozen: true }) })).frozen).toBe(true);
  });
  it('copes with an empty route (source none)', () => {
    const none: FlightView = { ...flight, route: { source: 'none', points: [], partial: false } };
    const s = buildScene(input({ flight: none }));
    expect(s.toIdx).toBeNull();
    expect(s.routeSource).toBe('none');
  });
  it('uses the eased reference when there is one', () => {
    expect(buildScene(input({ easedRefTrue: 77 })).refTrue).toBe(77);
  });
});
