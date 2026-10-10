import { describe, expect, it } from 'vitest';
import type { FlightView, LiveAircraft, NavTile } from '../../../shared/types.ts';
import { buildScene, densifyRoute, type SceneInput } from './scene.ts';

const flight: FlightView = {
  query: 'AA558',
  callsign: 'AAL558',
  status: 'active',
  origin: { icao: 'KAAA', name: 'ORIGIN', lat: 30, lon: -100 },
  dest: { icao: 'KBBB', name: 'DEST', lat: 30, lon: -90 },
  route: {
    source: 'filed',
    partial: false,
    points: [
      { ident: 'KAAA', lat: 30, lon: -100, kind: 'airport' },
      { ident: 'VRA', lat: 30, lon: -98, kind: 'navaid' },
      { ident: 'WPT1', lat: 30, lon: -96, kind: 'fix', via: 'J1' },
      { ident: 'VRB', lat: 30, lon: -94, kind: 'navaid' },
      { ident: 'KBBB', lat: 30, lon: -90, kind: 'airport' },
    ],
  },
  navCycle: '2610',
};
const live: LiveAircraft = { hex: 'abc123', lat: 30, lon: -97, altBaro: 35_000, gs: 450, track: 90, onGround: false, ageSec: 1 };
const tiles: NavTile[] = [
  {
    cycle: '2610',
    navaids: [
      { ident: 'VRA', type: 'VORTAC', lat: 30, lon: -98 },
      { ident: 'XYZ', type: 'VOR', lat: 31, lon: -97 },
      { ident: 'NN', type: 'NDB', lat: 31, lon: -97.5 },
    ],
    airports: [
      { icao: 'KAAA', lat: 30, lon: -100, rwyFt: 12000 },
      { icao: 'KCCC', lat: 29.5, lon: -97, rwyFt: 8000 },
      { icao: '2E5', lat: 29.6, lon: -97.2, rwyFt: 5000 },
    ],
  },
];

const input = (over: Partial<SceneInput> = {}): SceneInput => ({
  now: 0,
  flight,
  live,
  traffic: [],
  trail: [],
  tiles,
  range: 80,
  route: densifyRoute(flight.route.points),
  ownPos: { lat: 30, lon: -97 },
  upTrue: 90,
  magVar: 4,
  activeLeg: 1,
  ...over,
});

describe('buildScene', () => {
  it('hides sequenced waypoints, marks the TO waypoint and keeps both airports', () => {
    const s = buildScene(input());
    expect(s.routePoints.map((p) => `${p.ident}:${p.role}`)).toEqual(['KAAA:airport', 'VRA:wpt', 'WPT1:to', 'VRB:wpt', 'KBBB:airport']);
    expect(s.routeLine).toHaveLength(3);
    expect(buildScene(input({ activeLeg: 2, ownPos: { lat: 30, lon: -95 } })).routePoints.map((p) => p.ident)).toEqual(['KAAA', 'WPT1', 'VRB', 'KBBB']);
  });

  it('lets route points win over database symbols and applies the declutter table', () => {
    const s = buildScene(input());
    expect(s.navaids.map((n) => n.ident)).toEqual(['XYZ']);
    expect(s.airports.map((a) => a.icao)).toEqual(['KCCC']);
    expect(buildScene(input({ range: 40 })).navaids.map((n) => n.ident)).toEqual(['XYZ', 'NN']);
    expect(buildScene(input({ range: 40 })).airports.map((a) => a.icao)).toEqual(['KCCC', '2E5']);
    expect(buildScene(input({ range: 320 })).airports).toEqual([]);
  });

  it('computes the TO block, TRK reference and magnetic wind', () => {
    const s = buildScene(input({ live: { ...live, windDir: 270, windSpd: 45 } }));
    expect(s.mode).toBe('TRK');
    expect(s.refMag).toBe(86);
    expect(s.data.to?.ident).toBe('WPT1');
    expect(s.data.to?.brgMag).toBeCloseTo(86, 0);
    expect(s.data.to?.distNm).toBeCloseTo(52, 0);
    expect(s.data.windDirMag).toBe(266);
    expect(s.data.windArrow).toBe(0); // a west wind blows toward the east, which is up on a 090 track
  });

  it('uses HDG mode with a track diamond when the true heading is known', () => {
    const s = buildScene(input({ live: { ...live, trueHeading: 95 }, upTrue: 95 }));
    expect(s.mode).toBe('HDG');
    expect(s.trackDiamond).toBe(355);
  });

  it('marks proximate traffic, relative altitude and trend', () => {
    const s = buildScene(
      input({
        traffic: [
          { hex: 'p1', lat: 30.05, lon: -97, alt: 35_800, vs: -1200 },
          { hex: 'f1', lat: 30.5, lon: -97, alt: 31_000 },
        ],
      }),
    );
    expect(s.traffic).toEqual([
      { lat: 30.05, lon: -97, proximate: true, relAlt: '+08', above: true, trend: 'down' },
      { lat: 30.5, lon: -97, proximate: false, relAlt: '-40', above: false },
    ]);
  });

  it('centres on the origin, north up, with no position', () => {
    const s = buildScene(input({ ownPos: undefined, live: null, upTrue: 123 }));
    expect(s.noPosition).toBe(true);
    expect(s.center).toEqual(flight.origin);
    expect(s.mode).toBe('NORTH');
    expect(s.upTrue).toBe(0);
    expect(s.routePoints.some((p) => p.role === 'to')).toBe(false);
    expect(s.routeLine).toHaveLength(4);
  });

  it('flags a position older than 30 s', () => {
    expect(buildScene(input({ posAgeSec: 29 })).data.posOldSec).toBeUndefined();
    expect(buildScene(input({ posAgeSec: 44.6 })).data.posOldSec).toBe(45);
  });
});

describe('densifyRoute', () => {
  it('splits long legs into short great-circle steps', () => {
    const legs = densifyRoute([
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.9 }, // 54 nm: three 18 nm steps
      { lat: 0, lon: 1 },
    ]);
    expect(legs[0]).toHaveLength(4);
    expect(legs[1]).toHaveLength(2);
  });
});
