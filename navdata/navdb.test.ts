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
  procs: [
    { name: 'AKUNA9', kind: 'SID', airports: ['DFW'], body: ['AKUNA'], transitions: {} },
    // Real cycle quirks: SIDs named like airways/one-letter bases, and SID/STAR pairs sharing a base or a name.
    { name: 'O431', kind: 'SID', airports: ['O43'], body: ['FABLO'], transitions: {} },
    { name: 'DPK3', kind: 'SID', airports: ['FRG'], body: ['DPK'], transitions: {} },
    { name: 'MLB8', kind: 'SID', airports: ['MLB'], body: ['CAPEN'], transitions: {} },
    { name: 'MLB3', kind: 'STAR', airports: ['BCT'], body: ['MLB', 'RASAE', 'PBI'], transitions: {} },
    { name: 'NUTIY1', kind: 'SID', airports: ['ORF'], body: ['NUTIY'], transitions: {} },
    { name: 'NUTIY1', kind: 'STAR', airports: [], body: ['NUTIY'], transitions: {} },
  ],
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

  const procs = (token: string) => db.procedures(token).map((p) => `${p.kind}:${p.name}`);

  it('finds procedures by exact name, else by an outdated version digit', () => {
    expect(procs('AKUNA9')).toEqual(['SID:AKUNA9']);
    expect(procs('AKUNA8')).toEqual(['SID:AKUNA9']);
    expect(procs('AKUNA')).toEqual([]);
    expect(procs('AKUNA10')).toEqual([]);
    expect(procs('O431')).toEqual(['SID:O431']);
  });

  it('falls back only for 3-5 letter names plus one digit', () => {
    expect(procs('O12')).toEqual([]); // not SID O431 via a one-letter base "O"
    expect(procs('O4')).toEqual([]);
    expect(procs('DPK282')).toEqual([]); // a radial token, not SID DPK3
    expect(procs('DPK2')).toEqual(['SID:DPK3']);
  });

  it('lists exact SID and STAR matches before any other-version match', () => {
    expect(procs('MLB3')).toEqual(['STAR:MLB3']); // not SID MLB8
    expect(procs('MLB5')).toEqual(['SID:MLB8', 'STAR:MLB3']);
    expect(procs('NUTIY1')).toEqual(['SID:NUTIY1', 'STAR:NUTIY1']);
  });

  it('looks up preferred routes by airport pair', () => {
    expect(db.prefRoutes('DFW', 'ORD')).toHaveLength(1);
    expect(db.prefRoutes('ORD', 'DFW')).toHaveLength(0);
    expect(db.allPrefRoutes()).toHaveLength(1);
  });
});

describe('NavDb additions', () => {
  const big: NavDataFile = {
    ...data,
    airports: [
      ...data.airports,
      { id: 'SML', icao: 'KSML', name: 'SMALL', lat: 32.5, lon: -97.5, rwyFt: 3000, pub: true },
      { id: 'PRV', name: 'PRIVATE', lat: 32.6, lon: -97.6, rwyFt: 9000, pub: false },
    ],
    navaids: [...data.navaids, { id: 'DFW', type: 'VORTAC', name: 'DALLAS', lat: 32.87, lon: -97.03, varDeg: 3 }],
  };
  const d = new NavDb(big);

  it('exposes the AIRAC ident', () => {
    expect(d.navCycle).toBe('2610');
  });

  it('returns the 2x2 degree tile with big public airports only', () => {
    const t = d.tile(32, -98);
    expect(t.cycle).toBe('2610');
    expect(t.airports).toEqual([{ icao: 'KDFW', lat: 32.897, lon: -97.038 }]);
    expect(t.navaids).toEqual([{ ident: 'DFW', type: 'VORTAC', lat: 32.87, lon: -97.03 }]);
    expect(d.tile(34, -98).airports).toEqual([]);
  });

  it('hands out copies of preferred routes', () => {
    d.prefRoutes('DFW', 'ORD').pop();
    expect(d.prefRoutes('DFW', 'ORD')).toHaveLength(1);
  });

  it('prefers H, then NAR, then the first preferred route', () => {
    const mk = (types: string[]) =>
      new NavDb({ ...data, prefRoutes: types.map((type, i) => ({ orig: 'A', dest: 'B', type, route: `R${i}` })) }).bestPrefRoute('A', 'B')?.route;
    expect(mk(['L', 'H', 'NAR'])).toBe('R1');
    expect(mk(['L', 'NAR'])).toBe('R1');
    expect(mk(['TEC', 'L'])).toBe('R0');
    expect(new NavDb(data).bestPrefRoute('X', 'Y')).toBeUndefined();
  });
});
