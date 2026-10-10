// Usage: npm run seed   (inserts sample flight plans into data/flights.db for development)
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { findLatestNavData, loadNavDb } from '../navdata/load.ts';
import { FlightStore, type FlightRow } from '../server/store/flights.ts';

const dataDir = process.env.DATA_DIR ?? 'data';
const navPath = findLatestNavData(dataDir);
if (!navPath) {
  console.error(`No nav data in ${dataDir}/. Run: npm run navdata:build`);
  process.exit(1);
}
const nav = loadNavDb(navPath);
mkdirSync(dataDir, { recursive: true });
const store = new FlightStore(join(dataDir, 'flights.db'));

const now = Math.floor(Date.now() / 1000);
const samples: Array<[callsign: string, origin: string, dest: string, status: FlightRow['status'], acType: string]> = [
  ['AAL558', 'KDFW', 'KLAX', 'active', 'A321'],
  ['UAL100', 'KORD', 'KSFO', 'filed', 'B789'],
  ['DAL1', 'KATL', 'KJFK', 'filed', 'B739'],
];
for (const [callsign, origin, dest, status, acType] of samples) {
  // Use the FAA preferred route for the pair when there is one, so the sample decodes like a real filing.
  const faa = (icao: string) => nav.airport(icao)?.id ?? icao;
  const routeText = nav.bestPrefRoute(faa(origin), faa(dest))?.route ?? `${origin}..${dest}`;
  const offset = status === 'active' ? -1800 : 3600;
  store.upsert({
    gufi: `seed-${callsign}`,
    callsign,
    origin,
    dest,
    routeText,
    acType,
    status,
    etd: now + offset,
    ...(status === 'active' ? { atd: now + offset } : {}),
    amendedAt: now - 600,
    updatedAt: now,
  });
  console.log(`${callsign} ${origin}->${dest} ${status}: ${routeText}`);
}
console.log(`${store.count()} plans in ${join(dataDir, 'flights.db')}`);
