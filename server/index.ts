import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { AeroApiClient } from './aeroapi/client.ts';
import { createApp } from './api/app.ts';
import { FlightService } from './flight/service.ts';
import { AdsbClient } from './live/adsb.ts';
import { NavManager } from './nav/manager.ts';
import { mountStatic } from './static.ts';
import { FlightStore } from './store/flights.ts';

try {
  process.loadEnvFile('.env'); // optional local secrets, e.g. AEROAPI_KEY
} catch {
  /* no .env file */
}
const dataDir = process.env.DATA_DIR ?? 'data';
const port = Number(process.env.PORT ?? 8787);
const webDir = process.env.WEB_DIR ?? 'dist/web';
const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

mkdirSync(dataDir, { recursive: true });
// A mounted volume hides anything baked into the image at the same path, so the image keeps a copy of the
// build-time cycle in NAV_SEED_DIR and we copy it over on first boot (no network needed to start).
const seedDir = process.env.NAV_SEED_DIR;
if (seedDir && existsSync(seedDir)) {
  for (const name of readdirSync(seedDir).filter((n) => /^nasr-.*\.json\.gz$/.test(n))) {
    if (!existsSync(join(dataDir, name))) copyFileSync(join(seedDir, name), join(dataDir, name));
  }
}
const navManager = await NavManager.create({ dataDir, log });
navManager.start();
void navManager.check(); // pick up a cycle that took effect while we were down

const store = new FlightStore(join(dataDir, 'flights.db'));
const adsb = new AdsbClient({ userAgent: process.env.ADSB_USER_AGENT ?? 'webfly/0.1 (+https://github.com/aroth01/webfly)' });
const aeroKey = process.env.AEROAPI_KEY;
const aero = aeroKey ? new AeroApiClient({ apiKey: aeroKey, log }) : undefined;
if (aero) log('filed routes: FlightAware AeroAPI enabled');
else log('filed routes: no AEROAPI_KEY set, using seeded plans and expected routes only');
const refresh = aero
  ? async (callsign: string) => {
      for (const row of await aero.rows(callsign)) store.upsert(row);
    }
  : undefined;
const service = new FlightService({ store, nav: () => navManager.nav, adsb, log, ...(refresh ? { refresh } : {}) });
const app = createApp({ service, adsb, nav: () => navManager.nav, navStatus: () => navManager.status, log });
if (mountStatic(app, webDir)) log(`serving web app from ${webDir}`);

// Spec section 6.2: purge flight plans not updated in 36 h, hourly.
const purge = () => {
  const n = store.purge(Math.floor(Date.now() / 1000) - 36 * 3600);
  if (n) log(`purged ${n} flight plans`);
};
purge();
setInterval(purge, 3600_000).unref();

const server = serve({ fetch: app.fetch, port }, (info) =>
  log(`webfly on http://localhost:${info.port} (NASR ${navManager.nav.cycle}, AIRAC ${navManager.nav.navCycle}, ${store.count()} plans)`),
);
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    navManager.stop();
    server.close(() => process.exit(0));
  });
}
