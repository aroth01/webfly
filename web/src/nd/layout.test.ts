import { describe, expect, it } from 'vitest';
import { ARC_HALF_SPAN_DEG, ndLayout } from './layout.ts';
import { makeProjector, polar } from './projection.ts';

describe('ndLayout', () => {
  it('fits a ~100° arc across a short portrait canvas, aircraft near 80% of the ND height', () => {
    const l = ndLayout(390, 390);
    expect(polar(l, ARC_HALF_SPAN_DEG, l.radius).x).toBeLessThanOrEqual(390);
    expect(polar(l, ARC_HALF_SPAN_DEG, l.radius).x).toBeGreaterThan(380);
    expect(l.cy / 390).toBeGreaterThan(0.75);
    expect(l.cy / 390).toBeLessThan(0.85);
  });

  it('grows on a tall canvas until 80° of arc remain visible, anchored at the top', () => {
    const l = ndLayout(390, 700);
    expect(l.top).toBe(0);
    expect(polar(l, 40, l.radius).x).toBeCloseTo(384, 0);
    expect(l.cy + l.radius * 0.27).toBeLessThanOrEqual(700);
  });

  it('is height-bound in landscape', () => {
    const l = ndLayout(844, 360);
    expect(l.cy + l.radius * 0.27).toBeCloseTo(360, 6);
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
