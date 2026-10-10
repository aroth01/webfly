import { describe, expect, it } from 'vitest';
import type { FlightRecord } from '../store/flights.ts';
import { rankFlights } from './rank.ts';

const NOW = 1_000_000;
const H = 3600;
const rec = (gufi: string, over: Partial<FlightRecord>): FlightRecord => ({ gufi, callsign: 'AAL558', status: 'filed', updatedAt: NOW, ...over });

describe('rankFlights', () => {
  it('prefers active over filed over recently arrived', () => {
    const rows = [
      rec('arr', { status: 'arrived', ata: NOW - H }),
      rec('fil', { status: 'filed', etd: NOW + H }),
      rec('act', { status: 'active', atd: NOW - H }),
    ];
    expect(rankFlights(rows, NOW)).toEqual({ kind: 'winner', flight: rows[2] });
    expect(rankFlights(rows.slice(0, 2), NOW)).toEqual({ kind: 'winner', flight: rows[1] });
    expect(rankFlights(rows.slice(0, 1), NOW)).toEqual({ kind: 'winner', flight: rows[0] });
  });

  it('picks the filed flight with the ETD nearest now, counting late departures', () => {
    const rows = [rec('later', { etd: NOW + 6 * H }), rec('late', { etd: NOW - H }), rec('far', { etd: NOW + 13 * H })];
    expect(rankFlights(rows, NOW)).toEqual({ kind: 'winner', flight: rows[1] });
    expect(rankFlights([rows[2] as FlightRecord], NOW)).toEqual({ kind: 'none' });
  });

  it('ignores cancelled flights and old arrivals', () => {
    expect(rankFlights([rec('c', { status: 'cancelled', etd: NOW }), rec('a', { status: 'arrived', ata: NOW - 3 * H })], NOW)).toEqual({ kind: 'none' });
  });

  it('returns a pick list when the best tier holds several callsigns', () => {
    const rows = [rec('a', { status: 'active', atd: NOW - 2 * H }), rec('b', { callsign: 'SKW558', status: 'active', atd: NOW - H }), rec('c', { callsign: 'ENY558', etd: NOW })];
    expect(rankFlights(rows, NOW)).toEqual({ kind: 'choices', flights: [rows[1], rows[0]] });
  });
});
