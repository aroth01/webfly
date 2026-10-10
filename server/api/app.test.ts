import { describe, expect, it } from 'vitest';
import { NavDb } from '../../navdata/navdb.ts';
import type { NavDataFile } from '../../navdata/types.ts';
import { FlightService } from '../flight/service.ts';
import { AdsbClient } from '../live/adsb.ts';
import { FlightStore } from '../store/flights.ts';
import { createApp } from './app.ts';
import { RateLimiter } from './ratelimit.ts';

const NOW_MS = 1_800_000_000_000;
const data: NavDataFile = {
  cycle: '2026-10-01',
  airports: [
    { id: 'AAA', icao: 'KAAA', name: 'ORIGIN', lat: 30, lon: -100, rwyFt: 10000, pub: true },
    { id: 'BBB', icao: 'KBBB', name: 'DEST', lat: 30, lon: -90, rwyFt: 10000, pub: true },
  ],
  navaids: [{ id: 'VRA', type: 'VORTAC', name: 'A', lat: 30.5, lon: -99.5, varDeg: 3 }],
  fixes: [{ id: 'WPT1', lat: 30, lon: -97 }],
  airways: [],
  procs: [],
  prefRoutes: [],
};

function setup(opts: { upstreamDown?: boolean; limiter?: RateLimiter; trustFly?: boolean } = {}) {
  const nav = new NavDb(data);
  const store = new FlightStore();
  store.upsert({
    gufi: 'g1',
    callsign: 'AAL558',
    origin: 'KAAA',
    dest: 'KBBB',
    routeText: 'KAAA..WPT1..KBBB',
    status: 'active',
    atd: NOW_MS / 1000 - 600,
    updatedAt: NOW_MS / 1000,
  });
  const fetchFn = (async (url: string | URL | Request) => {
    if (opts.upstreamDown) throw new Error('offline');
    const u = String(url);
    if (u.includes('/v2/callsign/AAL558')) return new Response(JSON.stringify({ ac: [{ hex: 'abc123', flight: 'AAL558 ', lat: 30, lon: -96, alt_baro: 30000, gs: 440, track: 90, seen_pos: 0.5 }] }));
    if (u.includes('/trace_full_abc123')) return new Response(JSON.stringify({ timestamp: 1000, trace: [[0, 30, -97, 'ground', 0, 0, 0, 0, { flight: 'AAL558 ' }], [60, 30, -96.9, 1500, 0, 0, 0, 0, null]] }));
    return new Response(JSON.stringify({ ac: [] }));
  }) as typeof fetch;
  const adsb = new AdsbClient({ fetch: fetchFn, now: () => NOW_MS });
  const service = new FlightService({ store, nav: () => nav, adsb, now: () => NOW_MS });
  const app = createApp({ service, adsb, nav: () => nav, now: () => NOW_MS, trustFlyClientIp: opts.trustFly ?? true, ...(opts.limiter ? { limiter: opts.limiter } : {}) });
  return { app, store };
}
const j = async (res: Response) => (await res.json()) as any;
const get = (app: ReturnType<typeof setup>['app'], path: string, ip = '1.1.1.1') => app.request(path, { headers: { 'fly-client-ip': ip } });

describe('GET /api/flight/:query', () => {
  it('returns the FlightView', async () => {
    const res = await get(setup().app, '/api/flight/aa558');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ callsign: 'AAL558', hex: 'abc123', navCycle: '2610', route: { source: 'filed' } });
  });
  it('uses the error shape for 404 and 400', async () => {
    const { app } = setup();
    const nf = await get(app, '/api/flight/DL1');
    expect(nf.status).toBe(404);
    expect(await nf.json()).toMatchObject({ error: { code: 'not_found', message: expect.any(String) } });
    const bad = await get(app, '/api/flight/zz1');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: 'unknown_airline' } });
  });
  it('returns choices as { choices }', async () => {
    const { app, store } = setup();
    store.upsert({ gufi: 'g2', callsign: 'SKW558', origin: 'KBBB', dest: 'KAAA', status: 'active', updatedAt: NOW_MS / 1000 });
    const body = await j(await get(app, '/api/flight/AA558'));
    expect(body.choices).toHaveLength(2);
  });
});

describe('GET /api/live/:callsign', () => {
  it('returns LiveState with a short cache header', async () => {
    const res = await get(setup().app, '/api/live/aal558');
    expect(res.headers.get('cache-control')).toBe('public, max-age=5');
    expect(await res.json()).toMatchObject({ aircraft: { hex: 'abc123', lat: 30, onGround: false }, traffic: [] });
  });
  it('still answers 200 with a null aircraft when adsb.lol is down', async () => {
    const res = await get(setup({ upstreamDown: true }).app, '/api/live/AAL558');
    expect(res.status).toBe(200);
    expect((await j(res)).aircraft).toBeNull();
  });
  it('rejects junk callsigns', async () => {
    expect((await get(setup().app, '/api/live/a%20b')).status).toBe(400);
  });
});

describe('GET /api/trail/:hex', () => {
  it('returns the trimmed trail', async () => {
    const res = await get(setup().app, '/api/trail/abc123?callsign=AAL558');
    expect(await res.json()).toEqual([[1060, 30, -96.9, 1500]]);
  });
  it('validates the hex', async () => {
    expect((await get(setup().app, '/api/trail/zzz')).status).toBe(400);
  });
  it('returns an empty trail when the trace is unavailable', async () => {
    const res = await get(setup({ upstreamDown: true }).app, '/api/trail/abc123');
    expect(await res.json()).toEqual([]);
  });
});

describe('GET /api/nav/:cycle/:lat/:lon', () => {
  it('serves an immutable tile', async () => {
    const res = await get(setup().app, '/api/nav/2610/30/-100');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const t = await j(res);
    expect(t.cycle).toBe('2610');
    expect(t.airports.map((a: { icao: string }) => a.icao)).toEqual(['KAAA']);
    expect(t.navaids).toHaveLength(1);
  });
  it('rejects odd, non-numeric and out-of-range cells without an immutable header', async () => {
    const { app } = setup();
    for (const p of ['31/-100', '30/-101', 'x/-100', '30.5/-100', '90/0', '30/180', '30/-182']) {
      const res = await get(app, `/api/nav/2610/${p}`);
      expect(res.status, p).toBe(400);
      expect(res.headers.get('cache-control')).toBeNull();
    }
  });
  it('404s for another cycle', async () => {
    const res = await get(setup().app, '/api/nav/2611/30/-100');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'cycle_mismatch' } });
  });
});

describe('GET /api/health', () => {
  it('reports cycle, uptime and swim status', async () => {
    const body = await j(await get(setup().app, '/api/health'));
    expect(body).toMatchObject({ navCycle: '2610', uptimeSec: 0, swim: { enabled: false, connected: false, lastMessageAt: null, keptPerMin: 0, droppedPerMin: 0 } });
  });
});

describe('rate limiting and fallbacks', () => {
  it('returns 429 after the burst, per IP, but never for health', async () => {
    const { app } = setup({ limiter: new RateLimiter({ capacity: 3, perMinute: 60, now: () => NOW_MS }) });
    for (let i = 0; i < 3; i++) expect((await get(app, '/api/live/AAL558', '9.9.9.9')).status).toBe(200);
    const limited = await get(app, '/api/live/AAL558', '9.9.9.9');
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: { code: 'rate_limited' } });
    expect((await get(app, '/api/live/AAL558', '8.8.8.8')).status).toBe(200);
    expect((await get(app, '/api/health', '9.9.9.9')).status).toBe(200);
  });
  it('ignores a spoofed Fly-Client-IP header unless trusted', async () => {
    const { app } = setup({ trustFly: false, limiter: new RateLimiter({ capacity: 2, perMinute: 60, now: () => NOW_MS }) });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await get(app, '/api/live/AAL558', `10.0.0.${i}`)).status);
    expect(statuses).toEqual([200, 200, 429, 429]); // every spoofed IP shares the socket's bucket
  });
  it('refills tokens over time', () => {
    let t = 0;
    const l = new RateLimiter({ capacity: 2, perMinute: 60, now: () => t });
    expect([l.take('a'), l.take('a'), l.take('a')]).toEqual([true, true, false]);
    t += 1000;
    expect(l.take('a')).toBe(true);
  });
  it('returns a JSON 404 for unknown API paths', async () => {
    const res = await get(setup().app, '/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'not_found' } });
  });
});
