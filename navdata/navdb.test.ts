import { describe, expect, it } from 'vitest';
import { NavDb } from './navdb.ts';
import type { NavDataFile } from './types.ts';

const data: NavDataFile = {
  cycle: '2026-10-01',
  airports: [{ id: 'DFW', icao: 'KDFW', name: 'DALLAS-FORT WORTH INTL', lat: 32.897, lon: -97.038, rwyFt: 13401, pub: true }],
  navaids: [
    { id: 'AA', type: 'NDB', name: 'KENIE', lat: 47.0, lon: -96.8, varDeg: 4 },
    { id: 'AA', type: 'NDB', name: 'CEDAR', lat: 33.5, lon: -82.6, varDeg: -4 },
  ],
  fixes: [{ id: 'ZEMMA', lat: 33.0, lon: -110.0 }],
  airways: [
    { id: 'J1', loc: 'A', pts: ['X', 'Y'] },
    { id: 'J1', loc: 'C', pts: ['P', 'Q'] },
  ],
  procs: [{ name: 'AKUNA9', kind: 'SID', airports: ['DFW'], body: ['AKUNA'], transitions: {} }],
  prefRoutes: [{ orig: 'DFW', dest: 'ORD', type: 'H', route: 'DFW AKUNA9 MLC ORD' }],
};
const db = new NavDb(data);

describe('NavDb', () => {
  it('finds airports by FAA or ICAO id', () => {
    expect(db.airport('DFW')?.name).toBe('DALLAS-FORT WORTH INTL');
    expect(db.airport('KDFW')?.id).toBe('DFW');
    expect(db.airport('XXXX')).toBeUndefined();
  });

  it('resolves duplicate navaid idents to the one nearest the reference', () => {
    expect(db.point('AA', { lat: 34, lon: -83 })?.lat).toBe(33.5);
    expect(db.point('AA', { lat: 46, lon: -97 })?.lat).toBe(47.0);
    expect(db.navaid('AA', { lat: 34, lon: -83 })?.varDeg).toBe(-4);
  });

  it('returns fixes with their kind and falls back to airports', () => {
    expect(db.point('ZEMMA')).toEqual({ id: 'ZEMMA', lat: 33.0, lon: -110.0, kind: 'fix' });
    expect(db.point('DFW')?.kind).toBe('airport');
    expect(db.point('NOPE')).toBeUndefined();
  });

  it('prefers contiguous-US airways', () => {
    expect(db.airway('J1')?.pts).toEqual(['P', 'Q']);
  });

  it('finds procedures by exact name or by base name with another version', () => {
    expect(db.procedure('AKUNA9', 'SID')?.name).toBe('AKUNA9');
    expect(db.procedure('AKUNA8', 'SID')?.name).toBe('AKUNA9');
    expect(db.procedure('AKUNA', 'SID')).toBeUndefined();
    expect(db.procedure('AKUNA9', 'STAR')).toBeUndefined();
  });

  it('lists navaids and long-runway airports in a 2-degree tile', () => {
    const tileDb = new NavDb({
      ...data,
      airports: [
        ...data.airports,
        { id: 'SHT', name: 'SHORT FIELD', lat: 32.5, lon: -97.5, rwyFt: 3200, pub: true },
        { id: 'FTW', icao: 'KFTW', name: 'FORT WORTH MEACHAM', lat: 32.82, lon: -97.36, rwyFt: 7502, pub: true },
      ],
      navaids: [...data.navaids, { id: 'TTT', type: 'VOR/DME', name: 'MAVERICK', lat: 32.86, lon: -97.04, varDeg: 6 }],
    });
    expect(tileDb.airac).toBe('2610');
    const tile = tileDb.tile(32, -98);
    expect(tile.airports.map((a) => a.icao).sort()).toEqual(['KDFW', 'KFTW']);
    expect(tile.navaids).toEqual([{ ident: 'TTT', type: 'VOR/DME', lat: 32.86, lon: -97.04 }]);
    expect(tileDb.tile(46, -98).navaids.map((n) => n.ident)).toEqual(['AA']);
    expect(tileDb.tile(10, 10)).toEqual({ navaids: [], airports: [] });
  });

  it('looks up preferred routes by airport pair', () => {
    expect(db.prefRoutes('DFW', 'ORD')).toHaveLength(1);
    expect(db.prefRoutes('ORD', 'DFW')).toHaveLength(0);
    expect(db.allPrefRoutes()).toHaveLength(1);
  });
});
