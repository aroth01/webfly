// Regenerates web/e2e/fixtures/ from the built NASR cycle and the --sim flight model.
// Usage: npx tsx scripts/make-e2e-fixtures.ts   (needs data/nasr-*.json.gz; see npm run navdata:build)
import { mkdirSync, writeFileSync } from 'node:fs';
import { findLatestNavData, loadNavDb } from '../navdata/load.ts';
import type { NavTile } from '../shared/types.ts';
import { LiveService } from '../server/live/live.ts';
import { SimAdsbSource } from '../server/live/sim.ts';
import { loadAirlines } from '../server/resolve/airlines.ts';
import { FlightResolver } from '../server/resolve/resolve.ts';
import { FlightStore } from '../server/store/flights.ts';
import { seedFlights } from '../server/store/seed.ts';
import { SWIM_DISABLED } from '../server/swim/status.ts';
import { tilesForCircle } from '../web/src/nd/tiles.ts';

/** The frozen clock of the visual tests. */
export const FIXTURE_TIME = Date.UTC(2026, 9, 10, 18, 0, 0);
const SEEDED_AT = FIXTURE_TIME - 23 * 60_000; // AAL558 is 98 minutes out of DFW at FIXTURE_TIME

const path = findLatestNavData('data');
if (!path) throw new Error('No nav data in data/. Run: npm run navdata:build');
const nav = loadNavDb(path);
const flights = new FlightStore(':memory:');
seedFlights(flights, SEEDED_AT);
const now = () => FIXTURE_TIME;
const sim = new SimAdsbSource({ flights, nav: () => nav, now });
const live = new LiveService(sim, now);
const resolver = new FlightResolver({ nav: () => nav, flights, live, airlines: loadAirlines(), swim: () => SWIM_DISABLED, now });

const out = 'web/e2e/fixtures';
mkdirSync(out, { recursive: true });
const write = (name: string, data: unknown) => writeFileSync(`${out}/${name}`, `${JSON.stringify(data)}\n`);
const view = async (q: string) => {
  const r = await resolver.resolve(q);
  if (r.kind === 'error') throw new Error(`${q}: ${r.message}`);
  return r.kind === 'flight' ? r.view : { choices: r.choices };
};

const aa = await view('AA558');
const aaLive = await live.liveState('AAL558');
if (!aaLive.aircraft) throw new Error('AAL558 is not airborne in the sim');
write('flight-AA558.json', aa);
write('live-AAL558.json', aaLive);
write('trail-AAL558.json', await live.trail(aaLive.aircraft.hex, 'AAL558'));
const dl = await view('DL1234');
write('flight-DL1234.json', dl);
write('choices-UA5000.json', await view('UA5000'));

const tiles: Record<string, NavTile> = {};
const addTiles = (c: { lat: number; lon: number }) => {
  for (const [lat, lon] of tilesForCircle(c, 160)) tiles[`${lat}/${lon}`] = { cycle: nav.airac, ...nav.tile(lat, lon) };
};
addTiles(aaLive.aircraft);
if ('origin' in dl && dl.origin) addTiles(dl.origin);
write('tiles.json', { cycle: nav.airac, tiles });
console.log(`wrote ${out} for ${new Date(FIXTURE_TIME).toISOString()}: ${Object.keys(tiles).length} tiles`);
