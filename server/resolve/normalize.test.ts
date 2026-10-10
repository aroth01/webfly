import { describe, expect, it } from 'vitest';
import { AirlineDb, loadAirlines } from './airlines.ts';
import { candidateCallsigns, normalizeQuery } from './normalize.ts';

describe('normalizeQuery', () => {
  it.each([
    ['AA558', { code: 'AA', number: '558' }],
    ['aa 0558', { code: 'AA', number: '558' }],
    ['AAL558', { code: 'AAL', number: '558' }],
    ['B61', { code: 'B6', number: '1' }],
    ['9E3456', { code: '9E', number: '3456' }],
    ['DL0', { code: 'DL', number: '0' }],
  ])('parses %s', (input, expected) => {
    expect(normalizeQuery(input)).toEqual(expected);
  });

  it.each(['', 'AA', 'AA12345', 'AAAA1', 'A1', 'AA-558', 'A.A558'])('rejects %j', (input) => {
    expect(normalizeQuery(input)).toBeUndefined();
  });

  it('leaves digit-only or tail-number-like codes to the airline lookup', () => {
    expect(normalizeQuery('558')).toEqual({ code: '55', number: '8' });
    expect(normalizeQuery('N12345')).toEqual({ code: 'N1', number: '2345' });
  });
});

describe('candidateCallsigns', () => {
  const airlines = new AirlineDb([
    { iata: 'AA', icao: 'AAL', name: 'American Airlines', regionals: ['ENY', 'SKW'] },
    { iata: 'MQ', icao: 'ENY', name: 'Envoy Air' },
  ]);

  it('maps IATA to ICAO and adds the brand regionals', () => {
    expect(candidateCallsigns({ code: 'AA', number: '558' }, airlines)).toEqual(['AAL558', 'ENY558', 'SKW558']);
  });

  it('uses a 3-letter code as given, with regionals when it is a brand', () => {
    expect(candidateCallsigns({ code: 'AAL', number: '558' }, airlines)).toEqual(['AAL558', 'ENY558', 'SKW558']);
    expect(candidateCallsigns({ code: 'ENY', number: '3456' }, airlines)).toEqual(['ENY3456']);
    expect(candidateCallsigns({ code: 'XYZ', number: '1' }, airlines)).toEqual(['XYZ1']);
  });

  it('rejects an unknown 2-character code', () => {
    expect(candidateCallsigns({ code: 'ZZ', number: '1' }, airlines)).toBeUndefined();
  });

  it('ships a curated table with the spec examples', () => {
    const db = loadAirlines();
    expect(candidateCallsigns({ code: 'UA', number: '1' }, db)).toEqual(['UAL1', 'SKW1', 'RPA1', 'ASH1', 'GJS1']);
    expect(candidateCallsigns({ code: 'DL', number: '1' }, db)).toEqual(['DAL1', 'EDV1', 'SKW1', 'RPA1']);
    expect(db.operatorOf('JIA5123')).toBe('PSA Airlines');
  });
});
