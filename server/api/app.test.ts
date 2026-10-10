import { describe, expect, it } from 'vitest';
import { LiveService } from '../live/live.ts';
import { AirlineDb } from '../resolve/airlines.ts';
import { FlightResolver } from '../resolve/resolve.ts';
import { FlightStore } from '../store/flights.ts';
import { SWIM_DISABLED } from '../swim/status.ts';
import { aircraft, FakeAdsb, worldDb } from '../testing/world.ts';
import { createApp } from './app.ts';
import { RateLimiter } from './ratelimit.ts';

const NOW_MS = 1_800_000_000_000;
const NOW = NOW_MS / 1000;

function setup(limits?: { api: RateLimiter; nav: RateLimiter }) {
  const db = worldDb();
  const flights = new FlightStore(':memory:');
  const adsb = new FakeAdsb();
  const now = () => NOW_MS;
  const live = new LiveService(adsb, now);
  const airlines = new AirlineDb([{ iata: 'AA', icao: 'AAL', name: 'American Airlines' }]);
  const resolver = new FlightResolver({ nav: () => db, flights, live, airlines, swim: () => SWIM_DISABLED, now });
  const app = createApp({
    resolver,
    live,
    nav: () => db,
    flights,
    swim: () => SWIM_DISABLED,
    clientIp: (c) => c.req.header('x-test-ip') ?? '203.0.113.1',
    now,
    startedAt: NOW_MS - 90_000,
    ...(limits ? { limits } : {}),
  });
  return { app, flights, adsb };
}

describe('API', () => {
  it('GET /api/flight/:query returns a FlightView', async () => {
    const { app, flights } = setup();
    flights.upsert({ gufi: 'G1', callsign: 'AAL558', origin: 'KAAA', dest: 'KBBB', routeText: 'KAAA..VRA.J1.VRB..KBBB', status: 'filed', etd: NOW + 600, updatedAt: NOW });
    const res = await app.request('/api/flight/AA558');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toMatchObject({ query: 'AA558', callsign: 'AAL558', status: 'filed', navCycle: '2610', route: { source: 'filed', partial: false } });
  });

  it('GET /api/flight/:query reports errors in the standard shape', async () => {
    const { app } = setup();
    const cases: Array<[string, number, string]> = [
      ['/api/flight/hello', 400, 'malformed_query'],
      ['/api/flight/ZZ12', 400, 'unknown_airline'],
      ['/api/flight/AA558', 404, 'not_found'],
      ['/api/flight/AAAAAAAAAAAAAAAAAAAA1', 400, 'malformed_query'],
    ];
    for (const [url, status, code] of cases) {
      const res = await app.request(url);
      expect(res.status, url).toBe(status);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code, url).toBe(code);
      expect(typeof body.error.message).toBe('string');
    }
  });

  it('GET /api/live/:callsign returns LiveState, or 503 when adsb.lol is down with nothing cached', async () => {
    const { app, adsb } = setup();
    adsb.byCs.set('AAL558', [aircraft()]);
    const res = await app.request('/api/live/aal558');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ t: NOW_MS, aircraft: { hex: 'a05c59', gs: 450 }, traffic: [] });
    adsb.down = true;
    const down = await app.request('/api/live/AAL559');
    expect(down.status).toBe(503);
    expect(((await down.json()) as { error: { code: string } }).error.code).toBe('live_unavailable');
    expect((await app.request('/api/live/A')).status).toBe(400);
  });

  it('GET /api/trail/:hex returns the trail and validates its inputs', async () => {
    const { app, adsb } = setup();
    adsb.traces.set('a05c59', { icao: 'a05c59', timestamp: 100, trace: [[0, 30, -99, 3000, 250, 90, 0, 0, { flight: 'AAL558' }]] });
    const res = await app.request('/api/trail/A05C59?callsign=AAL558');
    expect(await res.json()).toEqual([[100, 30, -99, 3000]]);
    expect((await app.request('/api/trail/xyz')).status).toBe(400);
    expect((await app.request('/api/trail/a05c59?callsign=-')).status).toBe(400);
    expect(await (await app.request('/api/trail/ffffff')).json()).toEqual([]);
  });

  it('GET /api/nav/:cycle/:lat/:lon serves immutable tiles for the loaded cycle only', async () => {
    const { app } = setup();
    const res = await app.request('/api/nav/2610/30/-100');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await res.json()).toEqual({ cycle: '2610', navaids: [], airports: [{ icao: 'KAAA', lat: 30, lon: -100 }] });
    expect(await (await app.request('/api/nav/2610/30/-98')).json()).toEqual({
      cycle: '2610',
      navaids: [{ ident: 'VRA', type: 'VORTAC', lat: 30, lon: -98 }],
      airports: [],
    });
    const stale = await app.request('/api/nav/2609/30/-100');
    expect(stale.status).toBe(404);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe('stale_cycle');
    for (const bad of ['/api/nav/2610/31/-100', '/api/nav/2610/30/x', '/api/nav/2610/90/0', '/api/nav/2610/0/180']) {
      expect((await app.request(bad)).status, bad).toBe(400);
    }
  });

  it('GET /api/health reports SWIM, nav cycle, store size and uptime', async () => {
    const { app, flights } = setup();
    flights.upsert({ gufi: 'G1', callsign: 'AAL558', status: 'filed', updatedAt: NOW });
    expect(await (await app.request('/api/health')).json()).toEqual({
      swim: { enabled: false, connected: false, lastMessageAt: null, keptPerMin: 0, droppedPerMin: 0, reconnects: 0 },
      navCycle: '2610',
      navEffective: '2026-10-01',
      flights: 1,
      uptimeSec: 90,
    });
  });

  it('rate-limits each IP and answers 429 with Retry-After', async () => {
    const { app } = setup({ api: new RateLimiter(60, 2, () => NOW_MS), nav: new RateLimiter(600, 1, () => NOW_MS) });
    expect((await app.request('/api/flight/AA1')).status).toBe(404);
    expect((await app.request('/api/flight/AA1')).status).toBe(404);
    const limited = await app.request('/api/flight/AA1');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('1');
    expect(((await limited.json()) as { error: { code: string } }).error.code).toBe('rate_limited');
    expect((await app.request('/api/flight/AA1', { headers: { 'x-test-ip': '198.51.100.7' } })).status).toBe(404);
    expect((await app.request('/api/nav/2610/30/-100')).status).toBe(200);
    expect((await app.request('/api/health')).status).toBe(200);
  });

  it('answers unknown API paths with a JSON 404', async () => {
    const { app } = setup();
    const res = await app.request('/api/nope');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_found');
  });
});
