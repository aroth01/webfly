// WebFly server. Usage: tsx server/main.ts [--seed]
import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import { basename } from 'node:path';
import { findLatestNavData, loadNavDb } from '../navdata/load.ts';
import { createApp } from './api/app.ts';
import { loadConfig } from './config.ts';
import { HttpAdsbSource } from './live/adsb.ts';
import { LiveService } from './live/live.ts';
import { loadAirlines } from './resolve/airlines.ts';
import { FlightResolver } from './resolve/resolve.ts';
import { FlightStore } from './store/flights.ts';
import { seedFlights } from './store/seed.ts';
import { SWIM_DISABLED } from './swim/status.ts';

const RETENTION_S = 36 * 3600; // spec §6.2
const args = new Set(process.argv.slice(2));
const config = loadConfig();

const navPath = config.navDirs
  .map((dir) => findLatestNavData(dir))
  .filter((p): p is string => p !== undefined)
  .sort((a, b) => basename(a).localeCompare(basename(b)))
  .at(-1);
if (!navPath) {
  console.error(`No nav data in ${config.navDirs.join(', ')}. Run: npm run navdata:build`);
  process.exit(1);
}
const nav = loadNavDb(navPath);
console.log(`nav data ${navPath} (AIRAC ${nav.airac})`);

const flights = new FlightStore(config.flightsDb);
if (args.has('--seed')) console.log(`seeded ${seedFlights(flights, Date.now())} development flight plans`);

const live = new LiveService(new HttpAdsbSource({ userAgent: config.userAgent }));
const airlines = loadAirlines();
const swim = () => SWIM_DISABLED;
const resolver = new FlightResolver({ nav: () => nav, flights, live, airlines, swim });

const clientIp = (c: Context): string =>
  (config.onFly ? c.req.header('fly-client-ip') : undefined) ?? getConnInfo(c).remote.address ?? 'unknown';

const app = createApp({ resolver, live, nav: () => nav, flights, swim, clientIp });

const purge = () => {
  const n = flights.purge(Math.floor(Date.now() / 1000) - RETENTION_S);
  if (n) console.log(`purged ${n} flight plans older than 36 h`);
};
purge();
setInterval(purge, 3600_000).unref();

serve({ fetch: app.fetch, port: config.port }, (info) => console.log(`WebFly listening on http://localhost:${info.port}`));
