import { describe, expect, it } from 'vitest';
import { alongTrackNm, bearingDeg, crossTrackNm, destinationPoint, distanceNm, distanceToSegmentNm, normalizeDeg } from './geo.ts';

const DFW = { lat: 32.89723305, lon: -97.03769472 };
const LAX = { lat: 33.94249638, lon: -118.40804861 };

describe('geo', () => {
  it('normalizes angles into [0, 360)', () => {
    expect(normalizeDeg(-90)).toBe(270);
    expect(normalizeDeg(450)).toBe(90);
    expect(normalizeDeg(360)).toBe(0);
  });

  it('measures one degree of longitude at the equator as ~60.04 nm', () => {
    expect(distanceNm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(60.0405, 3);
  });

  it('measures DFW to LAX', () => {
    expect(distanceNm(DFW, LAX)).toBeCloseTo(1070.84, 1);
    expect(bearingDeg(DFW, LAX)).toBeCloseTo(279.25, 1);
  });

  it('gives cardinal bearings', () => {
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0, 6);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 6);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: -1, lon: 0 })).toBeCloseTo(180, 6);
  });

  it('round-trips destinationPoint with bearing and distance', () => {
    const p = destinationPoint(DFW, bearingDeg(DFW, LAX), distanceNm(DFW, LAX));
    expect(p.lat).toBeCloseTo(LAX.lat, 6);
    expect(p.lon).toBeCloseTo(LAX.lon, 6);
  });

  it('wraps longitude across the antimeridian', () => {
    const p = destinationPoint({ lat: 0, lon: 179.9 }, 90, 60.0405);
    expect(p.lon).toBeCloseTo(-179.1, 3);
  });

  it('measures cross-track distance from a great circle', () => {
    expect(crossTrackNm({ lat: 1, lon: 0.5 }, { lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(60.04, 1);
    expect(crossTrackNm({ lat: 0, lon: 0.5 }, { lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(0, 6);
  });

  it('measures distance from a segment: cross-track abeam it, else to the nearer end', () => {
    const a = { lat: 0, lon: 0 };
    const b = { lat: 0, lon: 1 };
    expect(distanceToSegmentNm({ lat: 1, lon: 0.5 }, a, b)).toBeCloseTo(60.04, 1);
    expect(distanceToSegmentNm({ lat: 0, lon: 3 }, a, b)).toBeCloseTo(120.08, 1); // on the great circle, beyond b
    expect(distanceToSegmentNm({ lat: 0, lon: -2 }, a, b)).toBeCloseTo(120.08, 1); // behind a
    expect(distanceToSegmentNm({ lat: 1, lon: 2 }, a, b)).toBeCloseTo(distanceNm({ lat: 1, lon: 2 }, b), 6);
  });

  it('measures distance from a zero-length segment as distance from its point', () => {
    const a = { lat: 10, lon: 10 };
    expect(distanceToSegmentNm({ lat: 11, lon: 10 }, a, a)).toBeCloseTo(60.04, 1);
    expect(distanceToSegmentNm(a, a, a)).toBe(0);
  });
});

describe('geo edge cases', () => {
  it('handles the antimeridian', () => {
    const a = { lat: 10, lon: 179.5 };
    const b = { lat: 10, lon: -179.5 };
    expect(distanceNm(a, b)).toBeCloseTo(59.1, 0);
    expect(bearingDeg(a, b)).toBeCloseTo(90, 0);
    const p = destinationPoint(a, 90, 60);
    expect(p.lon).toBeLessThan(-178);
    expect(p.lon).toBeGreaterThan(-180);
    expect(crossTrackNm({ lat: 10.1, lon: 180 }, a, b)).toBeLessThan(7);
  });

  it('handles the southern hemisphere', () => {
    const syd = { lat: -33.9461, lon: 151.1772 };
    const akl = { lat: -37.0082, lon: 174.785 };
    expect(distanceNm(syd, akl)).toBeGreaterThan(1150);
    expect(distanceNm(syd, akl)).toBeLessThan(1180);
    expect(bearingDeg(syd, akl)).toBeGreaterThan(90);
    expect(bearingDeg(syd, akl)).toBeLessThan(120);
    const p = destinationPoint(syd, 180, 60);
    expect(p.lat).toBeCloseTo(-34.9461, 1);
  });

  it('does not produce NaN for a zero-length leg', () => {
    const a = { lat: 30, lon: -90 };
    const p = { lat: 30, lon: -89 };
    expect(crossTrackNm(p, a, a)).toBeCloseTo(distanceNm(a, p), 6);
    expect(alongTrackNm(p, a, a)).toBe(0);
  });

  it('measures along-track progress, negative behind the start', () => {
    const a = { lat: 0, lon: 0 };
    const b = { lat: 0, lon: 2 };
    expect(alongTrackNm({ lat: 0.5, lon: 1 }, a, b)).toBeCloseTo(60.04, 1);
    expect(alongTrackNm({ lat: 0, lon: -1 }, a, b)).toBeCloseTo(-60.04, 1);
    expect(alongTrackNm({ lat: 0, lon: 3 }, a, b)).toBeCloseTo(180.12, 1);
  });
});
