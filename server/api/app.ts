import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { NavDb } from '../../navdata/navdb.ts';
import { TILE_DEG } from '../../navdata/navdb.ts';
import type { ApiErrorBody, Health, NavTile } from '../../shared/types.ts';
import { LiveUnavailableError, type LiveService } from '../live/live.ts';
import type { FlightResolver } from '../resolve/resolve.ts';
import type { FlightStore } from '../store/flights.ts';
import type { SwimStatus } from '../swim/status.ts';
import { RateLimiter } from './ratelimit.ts';

export interface NavUpdateStatus {
  lastCheckAt: number | null;
  lastError: string | null;
}

export interface AppDeps {
  resolver: FlightResolver;
  live: LiveService;
  nav: () => NavDb;
  flights: FlightStore;
  swim: () => SwimStatus;
  clientIp: (c: Context) => string;
  navUpdate?: () => NavUpdateStatus;
  now?: () => number;
  startedAt?: number;
  /** ~60/min per IP for the API (spec §8); tiles get their own, larger bucket. */
  limits?: { api: RateLimiter; nav: RateLimiter };
}

const CALLSIGN_RE = /^[A-Z0-9]{2,8}$/;
const HEX_RE = /^[0-9a-f]{6}$/;
const INT_RE = /^-?\d{1,3}$/;

function fail(c: Context, status: ContentfulStatusCode, code: string, message: string) {
  const body: ApiErrorBody = { error: { code, message } };
  return c.json(body, status);
}

export function createApp(deps: AppDeps): Hono {
  const now = deps.now ?? Date.now;
  const startedAt = deps.startedAt ?? now();
  const limits = deps.limits ?? { api: new RateLimiter(60), nav: new RateLimiter(600) };
  const app = new Hono();
  const api = new Hono();

  api.use('*', async (c, next) => {
    const path = c.req.path;
    if (!path.startsWith('/api/health')) {
      const limiter = path.startsWith('/api/nav/') ? limits.nav : limits.api;
      const ip = deps.clientIp(c);
      if (!limiter.take(ip)) {
        c.header('Retry-After', String(limiter.retryAfterSec(ip)));
        c.header('Cache-Control', 'no-store');
        return fail(c, 429, 'rate_limited', 'Too many requests. Slow down and try again shortly.');
      }
    }
    await next();
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
  });

  api.get('/flight/:query', async (c) => {
    const query = c.req.param('query');
    if (query.length > 16) return fail(c, 400, 'malformed_query', 'Enter an airline code and flight number, like AA558.');
    const r = await deps.resolver.resolve(query);
    if (r.kind === 'flight') return c.json(r.view);
    if (r.kind === 'choices') return c.json({ choices: r.choices });
    return fail(c, r.status, r.code, r.message);
  });

  api.get('/live/:callsign', async (c) => {
    const callsign = c.req.param('callsign').toUpperCase();
    if (!CALLSIGN_RE.test(callsign)) return fail(c, 400, 'bad_callsign', 'Callsigns are 2-8 letters and digits.');
    try {
      return c.json(await deps.live.liveState(callsign));
    } catch (err) {
      if (err instanceof LiveUnavailableError) return fail(c, 503, 'live_unavailable', 'Live position data is unavailable right now.');
      throw err;
    }
  });

  api.get('/trail/:hex', async (c) => {
    const hex = c.req.param('hex').toLowerCase();
    if (!HEX_RE.test(hex)) return fail(c, 400, 'bad_hex', 'A transponder address is 6 hex digits.');
    const callsign = c.req.query('callsign')?.toUpperCase();
    if (callsign !== undefined && !CALLSIGN_RE.test(callsign)) return fail(c, 400, 'bad_callsign', 'Callsigns are 2-8 letters and digits.');
    return c.json(await deps.live.trail(hex, callsign));
  });

  api.get('/nav/:cycle/:lat/:lon', (c) => {
    const { cycle, lat, lon } = c.req.param();
    const db = deps.nav();
    const la = Number(lat);
    const lo = Number(lon);
    if (!INT_RE.test(lat) || !INT_RE.test(lon) || la % TILE_DEG !== 0 || lo % TILE_DEG !== 0 || la < -90 || la > 88 || lo < -180 || lo > 178) {
      return fail(c, 400, 'bad_tile', 'Tile corners are even whole degrees.');
    }
    // Never serve another cycle's data under an immutable URL.
    if (cycle !== db.airac) return fail(c, 404, 'stale_cycle', `Nav cycle ${cycle} is not loaded; the current cycle is ${db.airac}.`);
    const tile: NavTile = { cycle: db.airac, ...db.tile(la, lo) };
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    return c.json(tile);
  });

  api.get('/health', (c) => {
    const db = deps.nav();
    const swim = deps.swim();
    const health: Health = {
      swim: {
        enabled: swim.enabled,
        connected: swim.connected,
        lastMessageAt: swim.lastMessageAt,
        keptPerMin: swim.keptPerMin,
        droppedPerMin: swim.droppedPerMin,
        reconnects: swim.reconnects,
      },
      navCycle: db.airac,
      navEffective: db.cycle,
      flights: deps.flights.count(),
      uptimeSec: Math.floor((now() - startedAt) / 1000),
    };
    if (deps.navUpdate) health.navUpdate = deps.navUpdate();
    return c.json(health);
  });

  api.all('*', (c) => fail(c, 404, 'not_found', 'No such endpoint.'));

  app.route('/api', api);
  app.onError((err, c) => {
    console.error(err);
    return fail(c, 500, 'internal', 'Something went wrong.');
  });
  return app;
}
