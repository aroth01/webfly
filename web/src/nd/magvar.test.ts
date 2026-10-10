import { describe, expect, it } from 'vitest';
import { declination, MagVar } from './magvar.ts';

// Official WMM2025 test values (NOAA/BGS), as shipped with the geomagnetism package.
describe('declination (WMM2025)', () => {
  it.each([
    [Date.UTC(2025, 0, 1), 48, 80, -96, -29.91],
    [Date.UTC(2025, 0, 1), 65, 43, 93, 0.5],
    [Date.UTC(2025, 0, 1), 3, -50, -103, 27.96],
    [Date.UTC(2025, 6, 2, 12), 44, 33, -118, 11.1],
  ])('at %s, %s km, %s/%s', (t, altKm, lat, lon, decl) => {
    expect(declination({ lat, lon }, new Date(t), altKm)).toBeCloseTo(decl, 1);
  });
});

describe('MagVar', () => {
  it('reuses the value until the aircraft has moved more than 10 nm', () => {
    const mv = new MagVar(new Date(Date.UTC(2026, 9, 10)));
    const dfw = mv.get({ lat: 32.9, lon: -97.0 });
    expect(dfw).toBeGreaterThan(2);
    expect(dfw).toBeLessThan(5);
    expect(mv.get({ lat: 32.9, lon: -97.1 })).toBe(dfw);
    expect(mv.get({ lat: 33.9, lon: -118.4 })).toBeGreaterThan(10);
  });
});
