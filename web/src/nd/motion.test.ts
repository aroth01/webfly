import { describe, expect, it } from 'vitest';
import { distanceNm } from '../../../shared/geo.ts';
import { angleDiff, deadReckon, EasedAngle, Motion } from './motion.ts';

describe('deadReckon', () => {
  it('moves along the track at ground speed', () => {
    const p = deadReckon({ lat: 0, lon: 0, gs: 360, track: 90, t: 0 }, 60_000);
    expect(p.lat).toBeCloseTo(0, 6);
    expect(distanceNm({ lat: 0, lon: 0 }, p)).toBeCloseTo(6, 6);
  });

  it('stops after 60 s and holds still without speed or track', () => {
    const fix = { lat: 0, lon: 0, gs: 360, track: 0, t: 0 };
    expect(deadReckon(fix, 120_000)).toEqual(deadReckon(fix, 60_000));
    expect(deadReckon({ lat: 1, lon: 2, t: 0 }, 30_000)).toEqual({ lat: 1, lon: 2 });
  });
});

describe('Motion', () => {
  it('blends a correction to zero over one second', () => {
    const m = new Motion();
    m.update({ lat: 0, lon: 0, gs: 0, track: 0, t: 0 }, 0);
    m.update({ lat: 0.01, lon: 0, gs: 0, track: 0, t: 5_000 }, 5_000);
    expect(m.position(5_000)?.lat).toBeCloseTo(0, 9);
    expect(m.position(5_500)?.lat).toBeCloseTo(0.005, 9);
    expect(m.position(6_000)?.lat).toBeCloseTo(0.01, 9);
    expect(m.position(9_000)?.lat).toBeCloseTo(0.01, 9);
  });

  it('ignores repeated or older fixes and reports the fix age', () => {
    const m = new Motion();
    expect(m.position(0)).toBeUndefined();
    m.update({ lat: 0, lon: 0, t: 1_000 }, 1_000);
    m.update({ lat: 5, lon: 5, t: 1_000 }, 2_000);
    expect(m.position(2_000)).toEqual({ lat: 0, lon: 0 });
    expect(m.ageMs(31_000)).toBe(30_000);
  });
});

describe('EasedAngle', () => {
  it('eases with a 0.5 s time constant along the shortest path', () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
    const a = new EasedAngle();
    expect(a.update(350, 16)).toBe(350);
    const v = a.update(10, 500);
    expect(angleDiff(350, v)).toBeCloseTo(20 * (1 - Math.exp(-1)), 6);
  });
});
