// WebFly server. Usage: tsx server/main.ts [--seed] [--sim]
//   --seed  write development flight plans
//   --sim   fly stored active flights along their routes instead of asking adsb.lol (development only)
import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import { basename, join } from 'node:path';
import { findLatestNavData, loadNavDb } from '../navdata/load.ts';
import { NavUpdater } from '../navdata/update.ts';
import { createApp } from './api/app.ts';
import { mountSpa } from './api/static.ts';
import { loadConfig } from './config.ts';
import { HttpAdsbSource } from './live/adsb.ts';
import { LiveService } from './live/live.ts';
import { SimAdsbSource } from './live/sim.ts';
import { loadAirlines } from './resolve/airlines.ts';
import { FlightResolver } from './resolve/resolve.ts';
import { FlightStore } from './store/flights.ts';
import { seedFlights } from './store/seed.ts';
import { fileRecorder, SwimConsumer } from './swim/consumer.ts';
import { SwimIngest } from './swim/ingest.ts';
import { solaceTransportFactory } from './swim/solace.ts';
import { SWIM_DISABLED, type SwimStatus } from './swim/status.ts';

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
// Swapped in place when a new NASR cycle is built; everything reads it through `() => nav`.
let nav = loadNavDb(navPath);
console.log(`nav data ${navPath} (AIRAC ${nav.airac})`);
const navUpdater = new NavUpdater({ dir: join(config.dataDir, 'nasr'), current: () => nav, swap: (db) => (nav = db) });
if (config.navAutoUpdate) navUpdater.start();

const flights = new FlightStore(config.flightsDb);
if (args.has('--seed')) console.log(`seeded ${seedFlights(flights, Date.now())} development flight plans`);

const adsb = new HttpAdsbSource({ userAgent: config.userAgent });
const live = new LiveService(args.has('--sim') ? new SimAdsbSource({ flights, nav: () => nav, fallback: adsb }) : adsb);
if (args.has('--sim')) console.log('simulating live positions for stored active flights');
const airlines = loadAirlines();
let swim: () => SwimStatus = () => SWIM_DISABLED;
if (config.swimEnabled) {
  if (!config.scds) {
    console.error(`SWIM_ENABLED=true but ${config.missingScds.join(', ')} not set`);
    process.exit(1);
  }
  const consumer = new SwimConsumer({
    createTransport: await solaceTransportFactory(config.scds),
    ingest: new SwimIngest(flights),
    ...(config.swimRecordDir ? { record: fileRecorder(config.swimRecordDir) } : {}),
  });
  consumer.start();
  swim = () => consumer.status();
  console.log(`SWIM consumer started (queue ${config.scds.queue})`);
}
const resolver = new FlightResolver({ nav: () => nav, flights, live, airlines, swim });

const clientIp = (c: Context): string =>
  (config.onFly ? c.req.header('fly-client-ip') : undefined) ?? getConnInfo(c).remote.address ?? 'unknown';

const app = createApp({ resolver, live, nav: () => nav, flights, swim, clientIp, navUpdate: () => navUpdater.status });
if (mountSpa(app, config.webDist)) console.log(`serving the web app from ${config.webDist}`);

const purge = () => {
  const n = flights.purge(Math.floor(Date.now() / 1000) - RETENTION_S);
  if (n) console.log(`purged ${n} flight plans older than 36 h`);
};
purge();
setInterval(purge, 3600_000).unref();

serve({ fetch: app.fetch, port: config.port }, (info) => console.log(`WebFly listening on http://localhost:${info.port}`));
