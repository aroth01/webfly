import { describe, expect, it } from 'vitest';
import type { TraceFull, TracePoint } from './adsb.ts';
import { trimTrace } from './trail.ts';

const pt = (dt: number, alt: number | 'ground' | null, flags = 0, flight?: string): TracePoint =>
  [dt, 30 + dt / 1000, -100, alt, 300, 90, flags, 0, flight ? { flight: `${flight}  ` } : null];

describe('trimTrace', () => {
  it('keeps the points after the last ground point', () => {
    const raw: TraceFull = {
      icao: 'abc123',
      timestamp: 1000,
      trace: [pt(0, 5000, 0, 'AAL1'), pt(10, 'ground'), pt(20, 'ground'), pt(30, 1200, 0, 'AAL558'), pt(40, 3400)],
    };
    expect(trimTrace(raw, 'AAL558')).toEqual([
      [1030, 30.03, -100, 1200],
      [1040, 30.04, -100, 3400],
    ]);
  });

  it('starts at a new-leg marker and drops points flown under another callsign', () => {
    const raw: TraceFull = {
      icao: 'abc123',
      timestamp: 0,
      trace: [pt(0, 30000, 0, 'AAL1'), pt(10, 31000, 2, 'AAL558'), pt(20, 32000), pt(30, null, 0, 'AAL9')],
    };
    expect(trimTrace(raw, 'AAL558').map((p) => p[0])).toEqual([10, 20]);
    expect(trimTrace(raw).map((p) => p[0])).toEqual([10, 20, 30]);
  });

  it('is empty while the aircraft is on the ground', () => {
    expect(trimTrace({ icao: 'x', timestamp: 0, trace: [pt(0, 3000), pt(10, 'ground')] })).toEqual([]);
  });
});
