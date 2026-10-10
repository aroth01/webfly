import { describe, expect, it } from 'vitest';
import { distanceNm } from '../../../shared/geo.ts';
import { activeLeg, etaMs } from './activeLeg.ts';
import { easeAngle, PositionTracker } from './interpolate.ts';
import { MagVar, wmmDeclination } from './magvar.ts';
import { project, trueToMagnetic, magneticToTrue } from './projection.ts';
import { defaultRange, RANGES, stepRange } from './ranges.ts';
import { Lru, tileKey, tilesFor } from './tiles.ts';

const geom = { cx: 200, cy: 600, radius: 500 };

describe('ranges', () => {
  it('defaults by altitude and steps within the ring', () => {
    expect(defaultRange()).toBe(80);
    expect(defaultRange(35000)).toBe(80);
    expect(defaultRange(9999)).toBe(40);
    expect(stepRange(80, 1)).toBe(160);
    expect(stepRange(80, -1)).toBe(40);
    expect(stepRange(320, 1)).toBe(320);
    expect(stepRange(10, -1)).toBe(10);
    expect(stepRange(100, 1)).toBe(160); // off-ring values snap first (100 -> 80 -> 160)
    expect(RANGES).toEqual([10, 20, 40, 80, 160, 320]);
  });
});

describe('project', () => {
  const own = { lat: 30, lon: -90 };
  it('puts a feature dead ahead straight up, scaled by range', () => {
    const p = project(own, 0, 80, geom, { lat: 30 + 40 / 60, lon: -90 });
    expect(p?.x).toBeCloseTo(200, 3);
    expect(p?.y).toBeCloseTo(600 - 250, 0);
  });
  it('puts a feature to the east on the right when heading north, and straight up when heading east', () => {
    const east = { lat: 30, lon: -90 + 40 / (60 * Math.cos((30 * Math.PI) / 180)) };
    expect(project(own, 0, 80, geom, east)!.x).toBeGreaterThan(200);
    const p = project(own, 90, 80, geom, east)!;
    expect(Math.abs(p.x - 200)).toBeLessThan(3); // a parallel is not quite a great circle
    expect(p.y).toBeLessThan(600);
  });
  it('culls beyond 1.1 x range and handles a feature at the aircraft position', () => {
    expect(project(own, 0, 10, geom, { lat: 30.5, lon: -90 })).toBeNull();
    const here = project(own, 45, 10, geom, own)!;
    expect(here.x).toBe(200);
    expect(here.y).toBe(600);
  });
  it('works across the antimeridian and in the southern hemisphere', () => {
    const a = { lat: -20, lon: 179.9 };
    const b = { lat: -20, lon: -179.9 };
    const p = project(a, 90, 40, geom, b)!;
    expect(p).not.toBeNull();
    expect(p.x).toBeCloseTo(200, 0); // east of us, we face east: straight ahead
    expect(p.y).toBeLessThan(600);
    expect(Number.isFinite(p.distNm)).toBe(true);
  });
  it('converts between true and magnetic', () => {
    expect(trueToMagnetic(10, 15)).toBe(355);
    expect(magneticToTrue(355, 15)).toBe(10);
    expect(trueToMagnetic(100, -5)).toBe(105);
  });
});

describe('activeLeg', () => {
  const route = [
    { lat: 30, lon: -100 },
    { lat: 30, lon: -98 },
    { lat: 30, lon: -96 },
    { lat: 31, lon: -94 },
  ];
  it('finds the leg the aircraft is on and sums the remaining distance', () => {
    const pos = { lat: 30.01, lon: -97 };
    const leg = activeLeg(route, pos)!;
    expect(leg.idx).toBe(1);
    expect(leg.toIdx).toBe(2);
    const expected = distanceNm(pos, route[2]) + distanceNm(route[2], route[3]);
    expect(leg.remainingNm).toBeCloseTo(expected, 3);
  });
  it('searches forward from the previous leg only', () => {
    expect(activeLeg(route, { lat: 30, lon: -99 }, 1)!.idx).toBe(1); // behind leg 1's start: falls back to nearest from 1
  });
  it('falls back to the nearest leg when not abeam any (before start, past end)', () => {
    expect(activeLeg(route, { lat: 30, lon: -102 })!.idx).toBe(0);
    expect(activeLeg(route, { lat: 32, lon: -92 })!.idx).toBe(2);
  });
  it('survives zero-length legs and tiny routes without NaN', () => {
    const dup = [route[0], route[0], route[1]];
    const leg = activeLeg(dup, { lat: 30, lon: -99 })!;
    expect(Number.isFinite(leg.remainingNm)).toBe(true);
    expect(leg.idx).toBe(1);
    expect(activeLeg([route[0]], { lat: 30, lon: -99 })).toMatchObject({ idx: 0, toIdx: 0 });
    expect(activeLeg([], { lat: 0, lon: 0 })).toBeNull();
    const same = [route[0], route[0]];
    const l = activeLeg(same, { lat: 30, lon: -99 })!;
    expect(Number.isFinite(l.remainingNm)).toBe(true);
  });
  it('computes ETA, or null without ground speed', () => {
    expect(etaMs(100, 400, 0)).toBe(900_000);
    expect(etaMs(100, undefined, 0)).toBeNull();
    expect(etaMs(100, 0, 0)).toBeNull();
  });
});

describe('PositionTracker', () => {
  it('dead-reckons along the track', () => {
    const t = new PositionTracker();
    t.push({ lat: 0, lon: 0, track: 90, gs: 360 }, 0);
    const p = t.at(10_000); // 360 kt for 10 s = 1 nm
    expect(distanceNm({ lat: 0, lon: 0 }, p)).toBeCloseTo(1, 2);
    expect(p.ageSec).toBeCloseTo(10, 5);
    expect(p.frozen).toBe(false);
  });
  it('treats ageSec as time already elapsed at receipt', () => {
    const t = new PositionTracker();
    t.push({ lat: 0, lon: 0, track: 90, gs: 360, ageSec: 10 }, 0);
    expect(distanceNm({ lat: 0, lon: 0 }, t.at(0))).toBeCloseTo(1, 2);
    expect(t.at(0).ageSec).toBeCloseTo(10, 5);
  });
  it('freezes after 60 s of coasting', () => {
    const t = new PositionTracker();
    t.push({ lat: 0, lon: 0, track: 90, gs: 360 }, 0);
    const a = t.at(60_000);
    const b = t.at(120_000);
    expect(a.frozen).toBe(false);
    expect(b.frozen).toBe(true);
    expect(b.lon).toBeCloseTo(a.lon, 8);
    expect(b.ageSec).toBeCloseTo(120, 5);
  });
  it('stays put without gs or track', () => {
    const t = new PositionTracker();
    t.push({ lat: 10, lon: 20 }, 0);
    expect(t.at(30_000)).toMatchObject({ lat: 10, lon: 20 });
  });
  it('blends a correction over 1 s instead of jumping', () => {
    const t = new PositionTracker();
    t.push({ lat: 0, lon: 0, track: 90, gs: 360 }, 0);
    const before = t.at(5_000);
    t.push({ lat: 0.01, lon: 0.1, track: 90, gs: 360 }, 5_000); // the real fix disagrees
    const justAfter = t.at(5_000);
    expect(justAfter.lat).toBeCloseTo(before.lat, 6);
    expect(justAfter.lon).toBeCloseTo(before.lon, 6);
    const mid = t.at(5_500);
    const end = t.at(6_000);
    expect(end.lat).toBeGreaterThan(mid.lat);
    expect(end.lat).toBeCloseTo(0.01, 3);
  });
  it('throws a clear error if asked before any fix', () => {
    expect(() => new PositionTracker().at(0)).toThrow(/before push/);
  });
});

describe('easeAngle', () => {
  it('takes the shortest path across north and converges', () => {
    const a = easeAngle(350, 10, 500, 500);
    expect(a > 350 || a < 10).toBe(true); // moved up through north, not the long way round
    expect(a > 180 ? a - 360 : a).toBeGreaterThan(-10);
    const down = easeAngle(10, 350, 500, 500);
    expect(down > 350 || down < 10).toBe(true); // 10 -> 357, down through north
    expect(easeAngle(0, 90, 60_000, 500)).toBeCloseTo(90, 3);
    expect(easeAngle(123, 123, 100, 500)).toBeCloseTo(123, 6);
  });
});

describe('MagVar', () => {
  it('gives sane WMM declinations (east positive)', () => {
    const d = new Date('2026-10-10T00:00:00Z');
    expect(wmmDeclination({ lat: 32.9, lon: -97 }, d)).toBeGreaterThan(1.5);
    expect(wmmDeclination({ lat: 32.9, lon: -97 }, d)).toBeLessThan(4);
    expect(wmmDeclination({ lat: 47.6, lon: -122.3 }, d)).toBeGreaterThan(13);
    expect(wmmDeclination({ lat: 42.4, lon: -71 }, d)).toBeLessThan(-10); // Boston: west
    expect(wmmDeclination({ lat: -33.9, lon: 151.2 }, d)).toBeGreaterThan(11);
  });
  it('only recomputes after moving more than 10 nm', () => {
    let calls = 0;
    const mv = new MagVar(() => ++calls);
    expect(mv.get({ lat: 30, lon: -90 })).toBe(1);
    expect(mv.get({ lat: 30.05, lon: -90 })).toBe(1); // 3 nm
    expect(mv.get({ lat: 30.3, lon: -90 })).toBe(2); // 18 nm from the last computation
    expect(calls).toBe(2);
  });
});

describe('tiles', () => {
  it('covers a circle around a mid-latitude point with even-cornered cells', () => {
    const ts = tilesFor(32.9, -97, 80);
    const keys = ts.map(tileKey);
    expect(keys).toContain('32,-98');
    expect(ts.every((t) => t.lat0 % 2 === 0 && t.lon0 % 2 === 0)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
    expect(ts.length).toBeLessThanOrEqual(12);
  });
  it('wraps across the antimeridian', () => {
    const lons = tilesFor(10, 179.5, 80).map((t) => t.lon0);
    expect(lons).toContain(178);
    expect(lons).toContain(-180);
    expect(lons.every((l) => l >= -180 && l <= 178)).toBe(true);
  });
  it('handles the southern hemisphere and the poles', () => {
    const s = tilesFor(-33.9, 151.2, 40).map(tileKey);
    expect(s).toContain('-34,150');
    const pole = tilesFor(89.5, 0, 80);
    expect(pole.every((t) => t.lat0 <= 88 && t.lat0 >= -90)).toBe(true);
    expect(pole.length).toBeGreaterThan(0);
  });
  it('is an LRU', () => {
    const c = new Lru<string, number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a'); // a is now most recent
    c.set('c', 3);
    expect(c.has('b')).toBe(false);
    expect(c.has('a')).toBe(true);
    expect(c.size).toBe(2);
  });
});
