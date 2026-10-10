import { describe, expect, it } from 'vitest';
import { ARC_HALF_SPAN_DEG, ndLayout } from './layout.ts';
import { makeProjector, polar } from './projection.ts';

describe('ndLayout', () => {
  it('fits a ~100° arc across a portrait phone and puts the aircraft near 80% of the ND height', () => {
    const l = ndLayout(390, 560);
    const arcEnd = polar(l, ARC_HALF_SPAN_DEG, l.radius);
    expect(arcEnd.x).toBeLessThanOrEqual(390);
    expect(arcEnd.x).toBeGreaterThan(380);
    const ndHeight = l.cy - l.top + l.radius * 0.27;
    expect((l.cy - l.top) / ndHeight).toBeGreaterThan(0.75);
    expect((l.cy - l.top) / ndHeight).toBeLessThan(0.85);
  });

  it('is height-bound in landscape', () => {
    const l = ndLayout(844, 360);
    expect(l.cy + l.radius * 0.27).toBeLessThanOrEqual(360.001);
    expect(l.cx).toBe(422);
  });
});

describe('makeProjector', () => {
  const l = ndLayout(400, 600);
  const own = { lat: 30, lon: -100 };

  it('puts a point dead ahead at full range on the top of the arc', () => {
    const p = makeProjector(own, 0, 60, l)({ lat: 31, lon: -100 });
    expect(p?.x).toBeCloseTo(l.cx, 6);
    expect(p?.y).toBeCloseTo(l.cy - l.radius, 0);
  });

  it('rotates with the display reference', () => {
    const east = { lat: 30, lon: -99 };
    expect(makeProjector(own, 0, 80, l)(east)?.x).toBeGreaterThan(l.cx + l.radius / 2);
    const trackEast = makeProjector(own, 90, 80, l)(east);
    expect(Math.abs((trackEast?.x ?? 0) - l.cx)).toBeLessThan(1); // the great-circle bearing is ~89.75°
    expect(trackEast?.y).toBeLessThan(l.cy);
  });

  it('culls features beyond 1.1 × range unless asked for more', () => {
    const project = makeProjector(own, 0, 20, l);
    expect(project({ lat: 30.4, lon: -100 })).toBeNull();
    expect(project({ lat: 30.4, lon: -100 }, 3)).not.toBeNull();
  });
});
