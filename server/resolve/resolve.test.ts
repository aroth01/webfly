import { describe, expect, it } from 'vitest';
import { FlightStore, type FlightRow } from '../store/flights.ts';
import { candidateCallsigns, normalizeQuery } from './normalize.ts';
import { resolve, scoreRows } from './resolve.ts';

const NOW = 1_000_000;
const row = (o: Partial<FlightRow>): FlightRow => ({ gufi: 'g', callsign: 'AAL558', status: 'filed', updatedAt: NOW, ...o });

describe('normalizeQuery', () => {
  it('maps IATA to ICAO and strips zeros, case and spaces', () => {
    expect(normalizeQuery('AA558')).toEqual({ ok: true, airline: 'AAL', number: '558' });
    expect(normalizeQuery(' aa 0558 ')).toEqual({ ok: true, airline: 'AAL', number: '558' });
    expect(normalizeQuery('9E3500')).toEqual({ ok: true, airline: 'EDV', number: '3500' });
  });
  it('takes 3-letter codes as given, even if not curated', () => {
    expect(normalizeQuery('AAL558')).toEqual({ ok: true, airline: 'AAL', number: '558' });
    expect(normalizeQuery('XYZ12')).toEqual({ ok: true, airline: 'XYZ', number: '12' });
  });
  it('rejects malformed and unknown input', () => {
    for (const bad of ['', 'AA', '558', 'AA0', 'AA12345', 'A-A558', 'N123AB']) {
      expect(normalizeQuery(bad)).toEqual({ ok: false, code: 'bad_query' });
    }
    expect(normalizeQuery('ZZ12')).toEqual({ ok: false, code: 'unknown_airline' });
  });
});

describe('candidateCallsigns', () => {
  it('lists mainline first, then regionals', () => {
    expect(candidateCallsigns('AAL', '558')).toEqual(['AAL558', 'ENY558', 'PDT558', 'PSA558', 'SKW558', 'RPA558', 'CHQ558']);
    expect(candidateCallsigns('SWA', '1')).toEqual(['SWA1']);
    expect(candidateCallsigns('XYZ', '1')).toEqual(['XYZ1']);
  });
});

describe('scoreRows', () => {
  it('prefers active over filed over arrived', () => {
    const rows = [
      row({ gufi: 'a', status: 'arrived', ata: NOW - 600 }),
      row({ gufi: 'f', status: 'filed', etd: NOW + 3600 }),
      row({ gufi: 'x', status: 'active', atd: NOW - 600 }),
    ];
    expect(scoreRows(rows, NOW).map((r) => r.gufi)).toEqual(['x']);
    expect(scoreRows(rows.slice(0, 2), NOW).map((r) => r.gufi)).toEqual(['f']);
  });
  it('picks the filed flight with the ETD nearest now and ignores far or cancelled ones', () => {
    const rows = [
      row({ gufi: 'far', etd: NOW + 13 * 3600 }),
      row({ gufi: 'soon', etd: NOW + 3600 }),
      row({ gufi: 'later', etd: NOW + 5 * 3600 }),
      row({ gufi: 'gone', status: 'cancelled', etd: NOW }),
    ];
    expect(scoreRows(rows, NOW).map((r) => r.gufi)).toEqual(['soon']);
  });
  it('ignores yesterday’s arrived flight', () => {
    expect(scoreRows([row({ status: 'arrived', ata: NOW - 3 * 3600 })], NOW)).toEqual([]);
  });
  it('collapses a refiled plan to the freshest row', () => {
    const rows = [row({ gufi: 'old', etd: NOW + 60, updatedAt: 1 }), row({ gufi: 'new', etd: NOW + 60, updatedAt: 2 })];
    expect(scoreRows(rows, NOW).map((r) => r.gufi)).toEqual(['new']);
  });
});

describe('resolve', () => {
  it('returns one, choices, none or an error', () => {
    const s = new FlightStore();
    s.upsert(row({ gufi: '1', callsign: 'AAL558', origin: 'KDFW', dest: 'KLAX', status: 'active' }));
    expect(resolve('AA558', s, NOW)).toMatchObject({ kind: 'one', row: { gufi: '1' } });

    s.upsert(row({ gufi: '2', callsign: 'SKW558', origin: 'KORD', dest: 'KMSN', status: 'active' }));
    const r = resolve('AA558', s, NOW);
    expect(r.kind).toBe('choices');

    expect(resolve('AA999', s, NOW)).toMatchObject({ kind: 'none', candidates: expect.arrayContaining(['AAL999']) });
    expect(resolve('??', s, NOW)).toEqual({ kind: 'error', code: 'bad_query' });
    expect(resolve('ZZ1', s, NOW)).toEqual({ kind: 'error', code: 'unknown_airline' });
  });
});
