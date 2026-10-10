import { describe, expect, it } from 'vitest';
import { defaultRange, stepRange } from './range.ts';

describe('range', () => {
  it('steps through 10-320 nm and stops at the ends', () => {
    expect(stepRange(80, 1)).toBe(160);
    expect(stepRange(80, -1)).toBe(40);
    expect(stepRange(320, 1)).toBe(320);
    expect(stepRange(10, -1)).toBe(10);
  });

  it('defaults to 80 nm, or 40 nm below 10,000 ft', () => {
    expect(defaultRange(35_000)).toBe(80);
    expect(defaultRange(9_000)).toBe(40);
    expect(defaultRange(undefined)).toBe(80);
  });
});
