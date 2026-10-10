import { describe, expect, it } from 'vitest';
import { compassLabel, fmtAltitude, fmtBearing, fmtDist, fmtInt, fmtRelAlt, fmtUtc, fmtWind } from './format.ts';

describe('format', () => {
  it('shows --- for missing values', () => {
    expect(fmtInt(undefined)).toBe('---');
    expect(fmtInt(451.6)).toBe('452');
    expect(fmtWind(undefined, 30)).toBe('---/---');
    expect(fmtUtc(undefined)).toBe('---');
  });

  it('formats bearings, distances and wind', () => {
    expect(fmtBearing(0.2)).toBe('360');
    expect(fmtBearing(5)).toBe('005');
    expect(fmtBearing(-119)).toBe('241');
    expect(fmtDist(8.64)).toBe('8.6');
    expect(fmtDist(87.4)).toBe('87');
    expect(fmtWind(270, 45.4)).toBe('270/45');
  });

  it('formats altitude as a flight level above 18,000 ft', () => {
    expect(fmtAltitude(35_000)).toBe('FL350');
    expect(fmtAltitude(12_480)).toBe('12,500 FT');
    expect(fmtAltitude(undefined)).toBe('---');
    expect(fmtAltitude(0, true)).toBe('GND');
  });

  it('formats UTC times, relative altitudes and compass labels', () => {
    expect(fmtUtc(Date.UTC(2026, 9, 10, 14, 52, 31))).toBe('14:52');
    expect(fmtRelAlt(35_000, 36_200)).toBe('+12');
    expect(fmtRelAlt(35_000, 34_500)).toBe('-05');
    expect(fmtRelAlt(35_000, 35_020)).toBe('00');
    expect(fmtRelAlt(undefined, 1)).toBeUndefined();
    expect(compassLabel(270)).toBe('27');
    expect(compassLabel(30)).toBe('3');
    expect(compassLabel(0)).toBe('0');
  });
});
