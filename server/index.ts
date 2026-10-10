import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { findLatestNavData, loadNavDb } from '../navdata/load.ts';
import { createApp } from './api/app.ts';
import { FlightService } from './flight/service.ts';
import { AdsbClient } from './live/adsb.ts';
import { FlightStore } from './store/flights.ts';

const dataDir = process.env.DATA_DIR ?? 'data';
const port = Number(process.env.PORT ?? 8787);
const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

const navPath = findLatestNavData(dataDir);
if (!navPath) {
  console.error(`No nav data in ${dataDir}/. Run: npm run navdata:build`);
  process.exit(1);
}
const nav = loadNavDb(navPath);
mkdirSync(dataDir, { recursive: true });
const store = new FlightStore(join(dataDir, 'flights.db'));
const adsb = new AdsbClient({ userAgent: process.env.ADSB_USER_AGENT ?? 'webfly/0.1 (+https://github.com/aroth01/webfly)' });
const service = new FlightService({ store, nav: () => nav, adsb, log });
const app = createApp({ service, adsb, nav: () => nav, log });

// Spec section 6.2: purge flight plans not updated in 36 h, hourly.
const purge = () => {
  const n = store.purge(Math.floor(Date.now() / 1000) - 36 * 3600);
  if (n) log(`purged ${n} flight plans`);
};
purge();
setInterval(purge, 3600_000).unref();

serve({ fetch: app.fetch, port }, (info) => log(`webfly API on http://localhost:${info.port} (NASR ${nav.cycle}, AIRAC ${nav.navCycle}, ${store.count()} plans)`));
