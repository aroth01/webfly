import { describe, expect, it } from 'vitest';
import { NavDb } from '../../navdata/navdb.ts';
import type { NavDataFile } from '../../navdata/types.ts';
import { AdsbClient } from '../live/adsb.ts';
import { FlightStore, type FlightRow } from '../store/flights.ts';
import { FlightService, type SwimStatus } from './service.ts';

const NOW_MS = 1_800_000_000_000;
const NOW = NOW_MS / 1000;

const data: NavDataFile = {
  cycle: '2026-10-01',
  airports: [
    { id: 'AAA', icao: 'KAAA', name: 'ORIGIN INTL', lat: 30, lon: -100, rwyFt: 10000, pub: true },
    { id: 'BBB', icao: 'KBBB', name: 'DEST INTL', lat: 30, lon: -90, rwyFt: 10000, pub: true },
    { id: 'CCC', icao: 'KCCC', name: 'NO PREF', lat: 31, lon: -95, rwyFt: 10000, pub: true },
  ],
  navaids: [],
  fixes: [
    { id: 'WPT1', lat: 30, lon: -97 },
    { id: 'WPT2', lat: 30, lon: -94 },
  ],
  airways: [],
  procs: [],
  prefRoutes: [
    { orig: 'AAA', dest: 'BBB', type: 'L', route: 'AAA WPT1 BBB' },
    { orig: 'AAA', dest: 'BBB', type: 'H', route: 'AAA WPT1 WPT2 BBB' },
  ],
};
const nav = new NavDb(data);

const row = (o: Partial<FlightRow> = {}): FlightRow => ({
  gufi: 'g1',
  callsign: 'AAL558',
  origin: 'KAAA',
  dest: 'KBBB',
  routeText: 'KAAA..WPT1..WPT2..KBBB',
  acType: 'A321',
  status: 'active',
  atd: NOW - 1800,
  etd: NOW - 2000,
  amendedAt: NOW - 3000,
  updatedAt: NOW - 10,
  ...o,
});

interface Setup {
  store?: FlightStore;
  aircraft?: Record<string, object>;
  routeset?: unknown;
  swim?: SwimStatus;
}
function make(s: Setup = {}) {
  const store = s.store ?? new FlightStore();
  const log: string[] = [];
  const fetchFn = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes('/v2/callsign/')) {
      const cs = decodeURIComponent(u.split('/').pop() as string);
      const ac = s.aircraft?.[cs];
      return new Response(JSON.stringify({ ac: ac ? [ac] : [] }));
    }
    if (u.includes('routeset')) return new Response(JSON.stringify(s.routeset ?? ''));
    return new Response(JSON.stringify({ ac: [] }));
  }) as typeof fetch;
  const adsb = new AdsbClient({ fetch: fetchFn, now: () => NOW_MS });
  const svc = new FlightService({ store, nav: () => nav, adsb, now: () => NOW_MS, log: (m) => log.push(m), ...(s.swim ? { swim: () => s.swim as SwimStatus } : {}) });
  return { svc, store, log };
}

describe('FlightService', () => {
  it('builds a filed view from a SWIM row', async () => {
    const store = new FlightStore();
    store.upsert(row());
    const { svc } = make({ store, aircraft: { AAL558: { hex: 'abc123', lat: 30, lon: -96, alt_baro: 30000 } } });
    const r = await svc.lookup(' aa558 ');
    expect(r.kind).toBe('view');
    if (r.kind !== 'view') return;
    expect(r.view).toMatchObject({
      query: 'aa558',
      callsign: 'AAL558',
      operator: 'American Airlines',
      acType: 'A321',
      status: 'active',
      hex: 'abc123',
      navCycle: '2610',
      origin: { icao: 'KAAA' },
      dest: { icao: 'KBBB' },
      route: { source: 'filed', partial: false, text: 'KAAA..WPT1..WPT2..KBBB' },
    });
    expect(r.view.route.points.map((p) => p.ident)).toEqual(['KAAA', 'WPT1', 'WPT2', 'KBBB']);
    expect(r.view.degraded).toBeUndefined();
  });

  it('marks partial routes and logs unresolved tokens', async () => {
    const store = new FlightStore();
    store.upsert(row({ routeText: 'KAAA..NOPE1..WPT1..KBBB' }));
    const { svc, log } = make({ store });
    const r = await svc.lookup('AAL558');
    expect(r.kind === 'view' && r.view.route.partial).toBe(true);
    expect(log.join('\n')).toContain('NOPE1');
  });

  it('survives an origin that is not in the nav data', async () => {
    const store = new FlightStore();
    store.upsert(row({ origin: 'CYYZ', routeText: 'WPT1..KBBB' }));
    const { svc } = make({ store });
    const r = await svc.lookup('AAL558');
    expect(r.kind).toBe('view');
    if (r.kind === 'view') {
      expect(r.view.origin).toBeUndefined();
      expect(r.view.route.partial).toBe(true);
    }
  });

  it('returns a choices list for tied flights', async () => {
    const store = new FlightStore();
    store.upsert(row({ gufi: '1' }));
    store.upsert(row({ gufi: '2', callsign: 'SKW558', origin: 'KBBB', dest: 'KAAA' }));
    const { svc } = make({ store });
    const r = await svc.lookup('AA558');
    expect(r).toMatchObject({ kind: 'choices', choices: expect.arrayContaining([expect.objectContaining({ query: 'SKW558', origin: 'KBBB' })]) });
  });

  it('falls back to the preferred route (H first) for an airborne flight with a routeset', async () => {
    const { svc } = make({
      aircraft: { AAL9: { hex: 'def456', lat: 30, lon: -98, alt_baro: 20000 } },
      routeset: [{ airport_codes: 'KAAA-KBBB' }],
    });
    const r = await svc.lookup('AAL9');
    expect(r.kind).toBe('view');
    if (r.kind !== 'view') return;
    expect(r.view.route.source).toBe('expected');
    expect(r.view.route.text).toBe('AAA WPT1 WPT2 BBB');
    expect(r.view.route.points.map((p) => p.ident)).toEqual(['AAA', 'WPT1', 'WPT2', 'BBB']);
    expect(r.view.hex).toBe('def456');
  });

  it('uses a great circle when the pair has no preferred route, and none without a pair', async () => {
    const gc = make({ aircraft: { AAL9: { hex: 'a', lat: 30, lon: -98, alt_baro: 1 } }, routeset: [{ airport_codes: 'KAAA-KCCC' }] });
    const g = await gc.svc.lookup('AAL9');
    expect(g.kind === 'view' && g.view.route).toMatchObject({ source: 'expected', partial: false });
    expect(g.kind === 'view' && g.view.route.points).toHaveLength(2);

    const none = make({ aircraft: { AAL9: { hex: 'a', lat: 30, lon: -98, alt_baro: 1 } } });
    const n = await none.svc.lookup('AAL9');
    expect(n.kind === 'view' && n.view.route).toEqual({ source: 'none', points: [], partial: false });
  });

  it('returns not_found when nothing is stored or airborne, and 400s for bad input', async () => {
    const { svc } = make();
    expect(await svc.lookup('AA1')).toMatchObject({ kind: 'error', status: 404, code: 'not_found' });
    expect(await svc.lookup('???')).toMatchObject({ kind: 'error', status: 400, code: 'bad_query' });
    expect(await svc.lookup('ZZ1')).toMatchObject({ kind: 'error', status: 400, code: 'unknown_airline' });
  });

  it('does not treat an aircraft on the ground as an airborne fallback', async () => {
    const { svc } = make({ aircraft: { AAL9: { hex: 'a', lat: 30, lon: -98, alt_baro: 'ground' } } });
    expect(await svc.lookup('AAL9')).toMatchObject({ kind: 'error', status: 404 });
  });

  it('flags swim_delayed only when SWIM is enabled and quiet for over 3 minutes', async () => {
    const store = new FlightStore();
    store.upsert(row());
    const stale = await make({ store, swim: { enabled: true, lastMessageAt: NOW_MS - 4 * 60_000 } }).svc.lookup('AAL558');
    expect(stale.kind === 'view' && stale.view.degraded).toBe('swim_delayed');
    const fresh = await make({ store, swim: { enabled: true, lastMessageAt: NOW_MS - 60_000 } }).svc.lookup('AAL558');
    expect(fresh.kind === 'view' && fresh.view.degraded).toBeUndefined();
    const off = await make({ store, swim: { enabled: false } }).svc.lookup('AAL558');
    expect(off.kind === 'view' && off.view.degraded).toBeUndefined();
  });

  it('caches the result for 60 s per normalized query', async () => {
    const store = new FlightStore();
    store.upsert(row());
    const { svc } = make({ store });
    const a = await svc.lookup('AAL558');
    const b = await svc.lookup(' aal 558');
    expect(b).toBe(a);
  });

  it('refreshes plans from a live source before resolving, and tries regionals only if needed', async () => {
    const store = new FlightStore();
    const asked: string[] = [];
    const adsb = new AdsbClient({ fetch: (async () => new Response('{"ac":[]}')) as typeof fetch, now: () => NOW_MS });
    const svc = new FlightService({
      store,
      nav: () => nav,
      adsb,
      now: () => NOW_MS,
      refresh: async (cs) => {
        asked.push(cs);
        if (cs === 'ENY558') store.upsert(row({ gufi: 'r1', callsign: 'ENY558', routeText: 'KAAA..WPT1..KBBB' }));
      },
    });
    const r = await svc.lookup('AA558');
    expect(asked).toEqual(['AAL558', 'ENY558']); // stopped at the first candidate that matched
    expect(r.kind === 'view' && r.view.callsign).toBe('ENY558');
  });

  it('re-decodes when the filed route text changes without a new amendment time', async () => {
    const store = new FlightStore();
    store.upsert(row({ amendedAt: undefined }));
    const { svc } = make({ store });
    const a = await svc.lookup('AAL558');
    expect(a.kind === 'view' && a.view.route.points.map((p) => p.ident)).toEqual(['KAAA', 'WPT1', 'WPT2', 'KBBB']);
    store.upsert(row({ amendedAt: undefined, routeText: 'KAAA..WPT2..KBBB' }));
    const fresh = make({ store }).svc; // new service: no 60 s view cache, shared route key logic
    const b = await fresh.lookup('AAL558');
    expect(b.kind === 'view' && b.view.route.points.map((p) => p.ident)).toEqual(['KAAA', 'WPT2', 'KBBB']);
  });
});
