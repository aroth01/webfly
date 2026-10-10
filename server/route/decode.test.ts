import { describe, expect, it } from 'vitest';
import { destinationPoint } from '../../shared/geo.ts';
import { NavDb } from '../../navdata/navdb.ts';
import type { NavDataFile } from '../../navdata/types.ts';
import { decodeRoute } from './decode.ts';

// A synthetic world laid out west-to-east along 30N so expectations are easy to reason about.
const data: NavDataFile = {
  cycle: '2026-10-01',
  airports: [
    { id: 'AAA', icao: 'KAAA', name: 'ORIGIN', lat: 30.0, lon: -100.0, rwyFt: 10000, pub: true },
    { id: 'BBB', icao: 'KBBB', name: 'DEST', lat: 30.0, lon: -90.0, rwyFt: 10000, pub: true },
    { id: 'CCC', name: 'BESIDE J1', lat: 30.05, lon: -97.0, rwyFt: 6000, pub: true },
    { id: 'AAX', icao: 'KAAX', name: 'NEAR ORIGIN', lat: 30.2, lon: -100.0, rwyFt: 5000, pub: true },
    { id: 'BBX', icao: 'KBBX', name: 'NEAR DEST', lat: 30.2, lon: -90.0, rwyFt: 5000, pub: true },
    { id: 'VRB', name: 'BRAVO MUNI', lat: 30.03, lon: -95.05, rwyFt: 4000, pub: true }, // shares the VORTAC's id, like SGF
  ],
  navaids: [
    { id: 'VRA', type: 'VORTAC', name: 'ALPHA', lat: 30.0, lon: -98.0, varDeg: 5 },
    { id: 'VRA', type: 'VOR', name: 'FAR ALPHA', lat: 45.0, lon: -70.0, varDeg: -15 },
    { id: 'VRB', type: 'VORTAC', name: 'BRAVO', lat: 30.0, lon: -95.0, varDeg: 3 },
    { id: 'VRC', type: 'VOR/DME', name: 'CHARLIE', lat: 31.0, lon: -96.0, varDeg: 4 },
  ],
  fixes: [
    { id: 'SIDFX', lat: 30.0, lon: -99.5 },
    { id: 'TFIX1', lat: 30.0, lon: -98.8 },
    { id: 'WPT1', lat: 30.0, lon: -97.0 },
    { id: 'WPT2', lat: 30.0, lon: -96.0 },
    { id: 'WPT3', lat: 29.5, lon: -95.5 },
    { id: 'STRT1', lat: 30.0, lon: -93.0 },
    { id: 'STRFX', lat: 30.0, lon: -92.0 },
    { id: 'FINAL', lat: 30.0, lon: -91.0 },
    { id: 'FARAWY', lat: 45.0, lon: -96.0 },
    { id: 'FARAWZ', lat: 45.0, lon: -97.0 },
    { id: 'SPIKE', lat: 30.0, lon: -85.0 }, // on the route's line, ~520 nm beyond VRB
  ],
  airways: [
    { id: 'J1', loc: 'C', pts: ['VRA', 'WPT1', 'WPT2', 'VRB'] },
    { id: 'J2', loc: 'C', pts: ['VRC', 'WPT2', 'WPT3'] },
  ],
  procs: [
    { name: 'DEPRT1', kind: 'SID', airports: ['AAA'], body: ['SIDFX'], transitions: { VRA: ['SIDFX', 'TFIX1', 'VRA'] } },
    { name: 'ARRVL2', kind: 'STAR', airports: ['BBB'], body: ['STRFX', 'FINAL'], transitions: { VRB: ['VRB', 'STRT1', 'STRFX'] } },
    // Shares the STAR's base name, like the real MLB8 (SID) and MLB3 (STAR).
    { name: 'ARRVL8', kind: 'SID', airports: ['AAA'], body: ['SIDFX'], transitions: {} },
  ],
  prefRoutes: [],
};
const db = new NavDb(data);
const idents = (text: string, opts = {}) => decodeRoute(text, db, opts).points.map((p) => p.ident);

describe('decodeRoute', () => {
  it('expands SID, airway and STAR in NAS format', () => {
    const r = decodeRoute('KAAA.DEPRT1.VRA.J1.VRB.ARRVL2.KBBB', db);
    expect(r.points.map((p) => p.ident)).toEqual(['KAAA', 'SIDFX', 'TFIX1', 'VRA', 'WPT1', 'WPT2', 'VRB', 'STRT1', 'STRFX', 'FINAL', 'KBBB']);
    expect(r.points.map((p) => p.via ?? '-')).toEqual(['-', 'DEPRT1', 'DEPRT1', 'DEPRT1', 'J1', 'J1', '-', 'ARRVL2', 'ARRVL2', 'ARRVL2', '-']);
    expect(r.points.map((p) => p.kind)).toEqual(['airport', 'fix', 'fix', 'navaid', 'fix', 'fix', 'navaid', 'fix', 'fix', 'fix', 'airport']);
    expect(r.partial).toBe(false);
  });

  it('picks the duplicate navaid nearest the route', () => {
    const vra = decodeRoute('KAAA.DEPRT1.VRA.J1.VRB.ARRVL2.KBBB', db).points.find((p) => p.ident === 'VRA');
    expect(vra?.lat).toBe(30.0);
  });

  it('handles ICAO format with DCT and speed/level groups', () => {
    expect(idents('KAAA DCT VRA/N0450F350 J1 VRB DCT KBBB')).toEqual(['KAAA', 'VRA', 'WPT1', 'WPT2', 'VRB', 'KBBB']);
  });

  it('flies airways in reverse', () => {
    expect(idents('KBBB VRB J1 VRA KAAA')).toEqual(['KBBB', 'VRB', 'WPT2', 'WPT1', 'VRA', 'KAAA']);
  });

  it('joins an airway from an airport beside it', () => {
    expect(idents('CCC J1 VRB KBBB')).toEqual(['CCC', 'WPT1', 'WPT2', 'VRB', 'KBBB']);
  });

  it('leaves one airway for another at their junction', () => {
    expect(idents('KAAA VRA J1 J2 WPT3 KBBB')).toEqual(['KAAA', 'VRA', 'WPT1', 'WPT2', 'WPT3', 'KBBB']);
  });

  it('accepts a procedure filed with an outdated version number', () => {
    const r = decodeRoute('KAAA.DEPRT2.VRA..KBBB', db);
    expect(r.points.map((p) => p.ident)).toEqual(['KAAA', 'SIDFX', 'TFIX1', 'VRA', 'KBBB']);
    expect(r.points[1]?.via).toBe('DEPRT1');
  });

  it('prefers an exact STAR name over another version of a SID with the same base name', () => {
    const r = decodeRoute('KAAA VRA J1 VRB ARRVL2 KBBB', db);
    expect(r.points.map((p) => p.ident)).toEqual(['KAAA', 'VRA', 'WPT1', 'WPT2', 'VRB', 'STRT1', 'STRFX', 'FINAL', 'KBBB']);
    expect(r.partial).toBe(false);
  });

  it('does not expand a SID that does not serve the origin', () => {
    const r = decodeRoute('KAAX DEPRT1 VRA J1 VRB KBBB', db);
    expect(r.points.map((p) => p.ident)).toEqual(['KAAX', 'VRA', 'WPT1', 'WPT2', 'VRB', 'KBBB']);
    expect(r.unresolved).toEqual(['DEPRT1']);
    expect(r.partial).toBe(true);
    expect(decodeRoute('DEPRT1 VRA J1 VRB', db, { origin: 'KAAX', dest: 'KBBB' }).unresolved).toEqual(['DEPRT1']);
    expect(decodeRoute('DEPRT1 VRA J1 VRB', db, { origin: 'AAA', dest: 'KBBB' }).unresolved).toEqual([]);
  });

  it('does not expand a STAR that does not serve the destination', () => {
    const r = decodeRoute('KAAA VRA J1 VRB ARRVL2 KBBX', db);
    expect(r.points.map((p) => p.ident)).toEqual(['KAAA', 'VRA', 'WPT1', 'WPT2', 'VRB', 'KBBX']);
    expect(r.unresolved).toEqual(['ARRVL2']);
    expect(r.partial).toBe(true);
    expect(decodeRoute('VRA J1 VRB ARRVL2', db, { origin: 'KAAA', dest: 'KBBX' }).unresolved).toEqual(['ARRVL2']);
    expect(decodeRoute('VRA J1 VRB ARRVL2', db, { origin: 'KAAA', dest: 'BBB' }).unresolved).toEqual([]);
  });

  it('computes fix-radial-distance points from the magnetic radial', () => {
    const r = decodeRoute('KAAA VRA090060 KBBB', db);
    const frd = r.points[1];
    const expected = destinationPoint({ lat: 30.0, lon: -98.0 }, 95, 60);
    expect(frd?.kind).toBe('frd');
    expect(frd?.lat).toBeCloseTo(expected.lat, 6);
    expect(frd?.lon).toBeCloseTo(expected.lon, 6);
  });

  it('skips radial-only tokens', () => {
    expect(idents('KAAA VRA270 WPT1 KBBB')).toEqual(['KAAA', 'WPT1', 'KBBB']);
  });

  it('decodes lat/lon tokens in NAS, ICAO and whole-degree forms', () => {
    const r = decodeRoute('KAAA 3030N/09700W 3100N09600W 31N094W KBBB', db);
    expect(r.points.slice(1, 4).map((p) => [p.kind, p.lat, p.lon])).toEqual([
      ['latlon', 30.5, -97.0],
      ['latlon', 31.0, -96.0],
      ['latlon', 31.0, -94.0],
    ]);
  });

  it('reports unknown tokens and marks the route partial', () => {
    const r = decodeRoute('KAAA VRA NOSUCH KBBB', db);
    expect(r.points.map((p) => p.ident)).toEqual(['KAAA', 'VRA', 'KBBB']);
    expect(r.unresolved).toEqual(['NOSUCH']);
    expect(r.partial).toBe(true);
  });

  it('drops a point that zig-zags far off the route', () => {
    const r = decodeRoute('KAAA VRA FARAWY VRB KBBB', db);
    expect(r.points.map((p) => p.ident)).toEqual(['KAAA', 'VRA', 'VRB', 'KBBB']);
    expect(r.dropped).toEqual(['FARAWY']);
    expect(r.partial).toBe(true);
  });

  it('drops an out-and-back spike that lies along the line of the route', () => {
    const r = decodeRoute('KAAA VRA SPIKE VRB KBBB', db);
    expect(r.points.map((p) => p.ident)).toEqual(['KAAA', 'VRA', 'VRB', 'KBBB']);
    expect(r.dropped).toEqual(['SPIKE']);
    expect(r.partial).toBe(true);
  });

  it('drops a cluster of far-off points that shield each other', () => {
    const r = decodeRoute('KAAA VRA FARAWZ FARAWY VRB KBBB', db);
    expect(r.points.map((p) => p.ident)).toEqual(['KAAA', 'VRA', 'VRB', 'KBBB']);
    expect(r.dropped).toEqual(['FARAWZ', 'FARAWY']);
    expect(r.partial).toBe(true);
  });

  it('keeps a good point next to a far outlier and drops only the outlier', () => {
    // STRT1 is 364 nm along the route but 355 nm from the line KAAA-FARAWY; FARAWY is the one to drop.
    const r = decodeRoute('KAAA STRT1 FARAWY KBBB', db);
    expect(r.points.map((p) => p.ident)).toEqual(['KAAA', 'STRT1', 'KBBB']);
    expect(r.dropped).toEqual(['FARAWY']);
  });

  it('drops several separate outliers from one route, worst first', () => {
    // WPT2 sits ~500 nm off the line FARAWY-SPIKE until FARAWY is gone; it must survive.
    const r = decodeRoute('KAAA VRA FARAWY WPT2 SPIKE VRB KBBB', db);
    expect(r.points.map((p) => p.ident)).toEqual(['KAAA', 'VRA', 'WPT2', 'VRB', 'KBBB']);
    expect(r.dropped).toEqual(['FARAWY', 'SPIKE']);
  });

  it('keeps the far point of a round trip, which has no segment to measure against', () => {
    const r = decodeRoute('KAAA FARAWY KAAA', db);
    expect(r.points.map((p) => p.ident)).toEqual(['KAAA', 'FARAWY', 'KAAA']);
    expect(r.dropped).toEqual([]);
  });

  it('adds origin and destination when the text omits them, without duplicating them', () => {
    expect(idents('VRA J1 VRB', { origin: 'KAAA', dest: 'KBBB' })).toEqual(['KAAA', 'VRA', 'WPT1', 'WPT2', 'VRB', 'KBBB']);
    expect(idents('AAA VRA BBB', { origin: 'KAAA', dest: 'KBBB' })).toEqual(['AAA', 'VRA', 'BBB']);
  });

  it('decodes an end token that is not the supplied origin or destination as a navaid, not an airport', () => {
    const kinds = (text: string, opts = {}) => decodeRoute(text, db, opts).points.map((p) => `${p.ident}:${p.kind}`);
    expect(kinds('VRB J1 VRA', { origin: 'KBBB', dest: 'KAAA' })).toEqual([
      'KBBB:airport',
      'VRB:navaid',
      'WPT2:fix',
      'WPT1:fix',
      'VRA:navaid',
      'KAAA:airport',
    ]);
    expect(kinds('KAAA VRA J1 VRB', { dest: 'KBBB' }).slice(-2)).toEqual(['VRB:navaid', 'KBBB:airport']);
    // Without options, or when it is the supplied airport, an end token is still taken as the airport.
    expect(kinds('VRB J1 VRA KAAA')[0]).toBe('VRB:airport');
    expect(kinds('VRB J1 VRA', { origin: 'VRB', dest: 'KAAA' })[0]).toBe('VRB:airport');
  });

  it('flies only the SID body when the next fix is not one of its transitions', () => {
    expect(idents('KAAA DEPRT1 WPT1 KBBB')).toEqual(['KAAA', 'SIDFX', 'WPT1', 'KBBB']);
  });

  it('flies only the STAR body when entered from a fix that is not one of its transitions', () => {
    expect(idents('KAAA WPT2 ARRVL2 KBBB')).toEqual(['KAAA', 'WPT2', 'STRFX', 'FINAL', 'KBBB']);
  });

  it('reports an airway whose exit fix is not on it, then continues direct', () => {
    const r = decodeRoute('KAAA VRA J1 STRT1 KBBB', db);
    expect(r.points.map((p) => p.ident)).toEqual(['KAAA', 'VRA', 'STRT1', 'KBBB']);
    expect(r.unresolved).toEqual(['J1']);
  });

  it('treats an airway token at the very end as unresolved instead of crashing', () => {
    expect(decodeRoute('KAAA VRA J1', db).unresolved).toEqual(['J1']);
  });

  it('returns an empty route for empty text', () => {
    expect(decodeRoute('', db)).toEqual({ points: [], partial: false, unresolved: [], dropped: [] });
  });
});

describe('unknown endpoints', () => {
  it('reports an origin or destination that is not in the nav data', () => {
    const r = decodeRoute('WPT1', db, { origin: 'ZZZZ', dest: 'QQQQ' });
    expect(r.unresolved).toEqual(expect.arrayContaining(['ZZZZ', 'QQQQ']));
    expect(r.partial).toBe(true);
  });
});
