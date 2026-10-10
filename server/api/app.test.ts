import { describe, expect, it } from 'vitest';
import { NavDb } from '../../navdata/navdb.ts';
import type { NavDataFile } from '../../navdata/types.ts';
import { FlightService } from '../flight/service.ts';
import { AdsbClient } from '../live/adsb.ts';
import { FlightStore } from '../store/flights.ts';
import { createApp } from './app.ts';
import { SessionAuth } from './auth.ts';
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
    expect(res.headers.get('cache-control')).toBe('private, max-age=5');
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
    expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
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

describe('access control', () => {
  const code = 'let-me-in';
  const locked = (o: { now?: () => number } = {}) => {
    const auth = new SessionAuth({ code, secret: 's', now: o.now ?? (() => NOW_MS) });
    return { app: createApp({ ...fakeDeps(), auth, now: () => NOW_MS, trustFlyClientIp: true }), auth };
  };
  function fakeDeps() {
    const nav = new NavDb(data);
    const store = new FlightStore();
    const adsb = new AdsbClient({ fetch: (async () => new Response(JSON.stringify({ ac: [] }))) as typeof fetch, now: () => NOW_MS });
    return { service: new FlightService({ store, nav: () => nav, adsb, now: () => NOW_MS }), adsb, nav: () => nav };
  }
  const post = (app: ReturnType<typeof createApp>, body: unknown, ip = '2.2.2.2', headers: Record<string, string> = {}) =>
    app.request('/api/auth', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'fly-client-ip': ip, ...headers } });
  const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0];

  it('rejects API calls without a session, but leaves health and auth status open', async () => {
    const { app } = locked();
    const res = await get(app, '/api/flight/AA558');
    expect(res.status).toBe(401);
    expect(await j(res)).toMatchObject({ error: { code: 'unauthorized' } });
    expect((await get(app, '/api/live/AAL558')).status).toBe(401);
    expect((await get(app, '/api/nav/2610/30/-100')).status).toBe(401);
    expect((await get(app, '/api/health')).status).toBe(200);
    expect(await j(await get(app, '/api/auth'))).toEqual({ required: true, authenticated: false });
  });

  it('logs in with the right code and sets an HttpOnly SameSite=Strict cookie that unlocks the API', async () => {
    const { app } = locked();
    const res = await post(app, { code });
    expect(res.status).toBe(200);
    const raw = res.headers.get('set-cookie') ?? '';
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Strict/i);
    const cookie = cookieOf(res);
    const ok = await app.request('/api/live/AAL558', { headers: { cookie, 'fly-client-ip': '2.2.2.2' } });
    expect(ok.status).toBe(200);
    expect(await j(await app.request('/api/auth', { headers: { cookie, 'fly-client-ip': '2.2.2.2' } }))).toEqual({ required: true, authenticated: true });
  });

  it('rejects wrong, missing and non-string codes, and throttles guessing', async () => {
    const { app } = locked();
    for (const body of [{ code: 'nope' }, {}, { code: 5 }, null]) expect((await post(app, body, '3.3.3.3')).status).toBe(401);
    expect((await post(app, { code: 'again' }, '3.3.3.3')).status).toBe(401); // 5th attempt
    const blocked = await post(app, { code }, '3.3.3.3'); // 6th, even with the right code
    expect(blocked.status).toBe(429);
    expect((await post(app, { code }, '4.4.4.4')).status).toBe(200); // other IPs unaffected
  });

  it('caps failed logins across all IPs combined, and honest logins never use that cap up', async () => {
    const globalLoginLimiter = new RateLimiter({ capacity: 5, perMinute: 5, now: () => NOW_MS });
    const auth = new SessionAuth({ code, secret: 's', now: () => NOW_MS });
    const app = createApp({ ...fakeDeps(), auth, globalLoginLimiter, now: () => NOW_MS, trustFlyClientIp: true });
    for (let i = 0; i < 20; i++) expect((await post(app, { code }, `10.2.0.${i}`)).status).toBe(200); // successes are free
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await post(app, { code: 'guess' }, `10.1.0.${i}`)).status); // one failure per IP
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429, 429, 429]);
    expect((await post(app, { code }, '10.1.1.1')).status).toBe(429); // locked out of logging in while the cap is hit
    expect((await app.request('/api/live/AAL558', { headers: { cookie: `webfly_session=${auth.issue()}`, 'fly-client-ip': '10.3.0.1' } })).status).toBe(200); // sessions unaffected
  });

  it('logout revokes the session server-side', async () => {
    const { app, auth } = locked();
    const token = auth.issue();
    const headers = { cookie: `webfly_session=${token}`, 'fly-client-ip': '9.9.9.1' };
    expect((await app.request('/api/live/AAL558', { headers })).status).toBe(200);
    const out = await app.request('/api/auth', { method: 'DELETE', headers });
    expect(out.status).toBe(200);
    expect(out.headers.get('set-cookie') ?? '').toMatch(/webfly_session=;/);
    expect((await app.request('/api/live/AAL558', { headers })).status).toBe(401); // the copied token is dead too
  });

  it('a different access code invalidates sessions even with the same secret', () => {
    const a = new SessionAuth({ code: 'one', secret: 'same', now: () => NOW_MS });
    const b = new SessionAuth({ code: 'two', secret: 'same', now: () => NOW_MS });
    expect(b.verify(a.issue())).toBe(false);
    expect(a.verify(a.issue())).toBe(true);
  });

  it('rejects tampered and expired sessions', async () => {
    let t = NOW_MS;
    const { app, auth } = locked({ now: () => t });
    const token = auth.issue();
    const [exp, sig] = token.split('.');
    const forged = `${Number(exp) + 999999}.${sig}`;
    for (const bad of [forged, 'garbage', `${exp}.`, '.x']) {
      expect((await app.request('/api/live/AAL558', { headers: { cookie: `webfly_session=${bad}`, 'fly-client-ip': '5.5.5.5' } })).status).toBe(401);
    }
    t += auth.ttlMs + 1;
    expect((await app.request('/api/live/AAL558', { headers: { cookie: `webfly_session=${token}`, 'fly-client-ip': '5.5.5.5' } })).status).toBe(401);
  });

  it('blocks cross-site browser requests even with a valid session, and with no auth configured', async () => {
    const { app, auth } = locked();
    const cookie = `webfly_session=${auth.issue()}`;
    const cross = await app.request('/api/live/AAL558', { headers: { cookie, 'sec-fetch-site': 'cross-site', 'fly-client-ip': '6.6.6.6' } });
    expect(cross.status).toBe(403);
    const evil = await app.request('/api/live/AAL558', { headers: { cookie, origin: 'https://evil.example', host: 'webfly.example', 'fly-client-ip': '6.6.6.6' } });
    expect(evil.status).toBe(403);
    const same = await app.request('/api/live/AAL558', { headers: { cookie, origin: 'https://webfly.example', host: 'webfly.example', 'fly-client-ip': '6.6.6.6' } });
    expect(same.status).toBe(200);
    const open = setup().app;
    const x = await open.request('/api/live/AAL558', { headers: { 'sec-fetch-site': 'cross-site', 'fly-client-ip': '7.7.7.7' } });
    expect(x.status).toBe(403);
    expect((await post(app, { code }, '8.8.8.8', { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });

  it('reports auth as not required when no code is configured', async () => {
    const res = await get(setup().app, '/api/auth');
    expect(await j(res)).toEqual({ required: false, authenticated: true });
  });
});
