import { describe, expect, it } from 'vitest';
import { distanceNm } from '../../../shared/geo.ts';
import { findActiveLeg, toWaypoint } from './toWaypoint.ts';

// West to east along the equator, with a dogleg north at the end.
const route = [
  { lat: 0, lon: 0 },
  { lat: 0, lon: 1 },
  { lat: 0, lon: 2 },
  { lat: 1, lon: 2 },
];

describe('findActiveLeg', () => {
  it('picks the bracketing leg with the least cross-track error', () => {
    expect(findActiveLeg(route, { lat: 0.05, lon: 0.5 })).toBe(0);
    expect(findActiveLeg(route, { lat: 0.05, lon: 1.5 })).toBe(1);
    expect(findActiveLeg(route, { lat: 0.5, lon: 2.02 })).toBe(2);
  });

  it('never goes back to an earlier leg', () => {
    expect(findActiveLeg(route, { lat: 0.01, lon: 0.5 }, 2)).toBe(2);
  });

  it('advances past legs that are already behind when nothing brackets the position', () => {
    expect(findActiveLeg(route, { lat: -0.2, lon: 2.1 }, 0)).toBe(2);
    expect(findActiveLeg(route, { lat: 0, lon: -0.5 }, 0)).toBe(0);
  });
});

describe('toWaypoint', () => {
  it('reports the TO point, distance remaining and ETAs', () => {
    const pos = { lat: 0, lon: 0.5 };
    const to = toWaypoint(route, pos, 0, 300, 0);
    expect(to?.index).toBe(1);
    expect(to?.brgTrue).toBeCloseTo(90, 3);
    expect(to?.distNm).toBeCloseTo(30.02, 1);
    expect(to?.remainingNm).toBeCloseTo(30.02 + 60.04 + distanceNm(route[2]!, route[3]!), 1);
    expect(to?.etaMs).toBeCloseTo((30.02 / 300) * 3_600_000, -3);
    expect(toWaypoint(route, pos, 0, 20, 0)?.etaMs).toBeUndefined();
    expect(toWaypoint([route[0]!], pos, 0, 300, 0)).toBeUndefined();
  });
});
