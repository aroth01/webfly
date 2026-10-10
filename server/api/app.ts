import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { NavDb } from '../../navdata/navdb.ts';
import type { FlightService, SwimStatus } from '../flight/service.ts';
import { liveState, type AdsbClient } from '../live/adsb.ts';
import { trimTrail } from '../live/trail.ts';
import { isSameOrigin, SESSION_COOKIE, type SessionAuth } from './auth.ts';
import { RateLimiter } from './ratelimit.ts';

export interface SwimHealth extends SwimStatus {
  connected: boolean;
  keptPerMin: number;
  droppedPerMin: number;
}

export interface AppDeps {
  service: FlightService;
  adsb: AdsbClient;
  nav: () => NavDb;
  swim?: () => SwimHealth;
  navStatus?: () => { lastCheckAt: number | null; lastError: string | null };
  limiter?: RateLimiter;
  /** When set, every API route except health and auth needs a valid session cookie. */
  auth?: SessionAuth;
  /** Attempts at the access code, per IP. */
  loginLimiter?: RateLimiter;
  /** Attempts at the access code across all clients combined, so spreading guesses over many IPs does not help. */
  globalLoginLimiter?: RateLimiter;
  /** Trust the `Fly-Client-IP` header. Only safe behind Fly's proxy, which overwrites it; defaults to on when FLY_APP_NAME is set. */
  trustFlyClientIp?: boolean;
  now?: () => number; // epoch ms
  log?: (msg: string) => void;
}

const HEX_RE = /^[0-9a-f]{6}$/i;
const CALLSIGN_RE = /^[A-Z0-9]{2,8}$/i;
const INT_RE = /^-?\d{1,3}$/;

const fail = (c: Context, status: 400 | 401 | 403 | 404 | 429 | 500, code: string, message: string) => c.json({ error: { code, message } }, status);

/** The client's address: Fly's header when trusted, else the socket (not available under `app.request`). */
function clientIp(c: Context, trustFly: boolean): string {
  const fly = trustFly ? c.req.header('fly-client-ip') : undefined;
  if (fly) return fly;
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function createApp(deps: AppDeps): Hono {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const trustFly = deps.trustFlyClientIp ?? Boolean(process.env.FLY_APP_NAME);
  const limiter = deps.limiter ?? new RateLimiter({ now });
  const app = new Hono();

  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/health') return next(); // platform health checks must never be throttled
    if (!limiter.take(clientIp(c, trustFly))) {
      c.header('Retry-After', '10');
      return fail(c, 429, 'rate_limited', 'Too many requests. Slow down.');
    }
    return next();
  });

  const loginLimiter = deps.loginLimiter ?? new RateLimiter({ capacity: 5, perMinute: 5, now });
  const globalLoginLimiter = deps.globalLoginLimiter ?? new RateLimiter({ capacity: 20, perMinute: 20, now });
  const isOpen = (path: string) => path === '/api/health' || path === '/api/auth';

  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/health') return next();
    const sameOrigin = isSameOrigin({
      ...(c.req.header('sec-fetch-site') !== undefined ? { secFetchSite: c.req.header('sec-fetch-site') } : {}),
      ...(c.req.header('origin') !== undefined ? { origin: c.req.header('origin') } : {}),
      ...(c.req.header('host') !== undefined ? { host: c.req.header('host') } : {}),
    });
    if (!sameOrigin) return fail(c, 403, 'forbidden_origin', 'Cross-site requests are not allowed.');
    if (deps.auth && !isOpen(c.req.path) && !deps.auth.verify(getCookie(c, SESSION_COOKIE))) {
      return fail(c, 401, 'unauthorized', 'Access code required.');
    }
    return next();
  });

  app.get('/api/auth', (c) => c.json({ required: Boolean(deps.auth), authenticated: !deps.auth || deps.auth.verify(getCookie(c, SESSION_COOKIE)) }));

  app.post('/api/auth', async (c) => {
    const auth = deps.auth;
    if (!auth) return c.json({ required: false, authenticated: true });
    if (!loginLimiter.take(clientIp(c, trustFly)) || !globalLoginLimiter.take('all')) {
      return fail(c, 429, 'rate_limited', 'Too many attempts. Wait a minute.');
    }
    const body = (await c.req.json().catch(() => null)) as { code?: unknown } | null;
    if (!auth.checkCode(body?.code)) return fail(c, 401, 'bad_code', 'Wrong access code.');
    const https = c.req.header('x-forwarded-proto') === 'https' || c.req.url.startsWith('https:');
    setCookie(c, SESSION_COOKIE, auth.issue(), { httpOnly: true, sameSite: 'Strict', secure: https, path: '/', maxAge: Math.floor(auth.ttlMs / 1000) });
    return c.json({ required: true, authenticated: true });
  });

  app.delete('/api/auth', (c) => {
    deps.auth?.revoke(getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ required: Boolean(deps.auth), authenticated: !deps.auth });
  });

  app.get('/api/flight/:query', async (c) => {
    const result = await deps.service.lookup(c.req.param('query'));
    if (result.kind === 'error') return fail(c, result.status, result.code, result.message);
    if (result.kind === 'choices') return c.json({ choices: result.choices });
    return c.json(result.view);
  });

  app.get('/api/live/:callsign', async (c) => {
    const callsign = c.req.param('callsign').toUpperCase();
    if (!CALLSIGN_RE.test(callsign)) return fail(c, 400, 'bad_callsign', 'Invalid callsign.');
    c.header('Cache-Control', 'private, max-age=5');
    return c.json(await liveState(deps.adsb, callsign, now));
  });

  app.get('/api/trail/:hex', async (c) => {
    const hex = c.req.param('hex');
    if (!HEX_RE.test(hex)) return fail(c, 400, 'bad_hex', 'Invalid transponder address.');
    const callsign = c.req.query('callsign');
    c.header('Cache-Control', 'private, max-age=30');
    return c.json(trimTrail(await deps.adsb.trace(hex), callsign));
  });

  app.get('/api/nav/:cycle/:lat/:lon', (c) => {
    const { cycle, lat, lon } = c.req.param();
    if (!INT_RE.test(lat) || !INT_RE.test(lon)) return fail(c, 400, 'bad_tile', 'lat and lon must be integers.');
    const la = Number(lat);
    const lo = Number(lon);
    if (la % 2 !== 0 || lo % 2 !== 0 || la < -90 || la > 88 || lo < -180 || lo > 178) {
      return fail(c, 400, 'bad_tile', 'lat and lon must be even integers inside the world grid.');
    }
    const nav = deps.nav();
    if (cycle !== nav.navCycle) return fail(c, 404, 'cycle_mismatch', `Current nav cycle is ${nav.navCycle}.`);
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    return c.json(nav.tile(la, lo));
  });

  app.get('/api/health', (c) => {
    const swim = deps.swim?.() ?? { enabled: false, connected: false, keptPerMin: 0, droppedPerMin: 0 };
    return c.json({
      swim: { enabled: swim.enabled, connected: swim.connected, lastMessageAt: swim.lastMessageAt ?? null, keptPerMin: swim.keptPerMin, droppedPerMin: swim.droppedPerMin },
      navCycle: deps.nav().navCycle,
      nav: deps.navStatus?.() ?? { lastCheckAt: null, lastError: null },
      uptimeSec: Math.round((now() - startedAt) / 1000),
    });
  });

  app.all('/api/*', (c) => fail(c, 404, 'not_found', 'No such endpoint.'));

  app.onError((err, c) => {
    deps.log?.(`500 ${c.req.method} ${c.req.path}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    return fail(c, 500, 'internal', 'Something went wrong.');
  });

  return app;
}
