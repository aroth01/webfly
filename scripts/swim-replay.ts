// Feed recorded SFDPS payloads through the SWIM ingest pipeline (spec §11).
// Usage: npm run swim:replay -- <dir> [--db <path>]   (default db: $FLIGHTS_DB or data/flights.db)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../server/config.ts';
import { FlightStore } from '../server/store/flights.ts';
import { SwimIngest } from '../server/swim/ingest.ts';

const args = process.argv.slice(2);
const dbAt = args.indexOf('--db');
const db = dbAt >= 0 ? args[dbAt + 1] : loadConfig().flightsDb;
const dir = args.find((a, i) => !a.startsWith('--') && i !== dbAt + 1);
if (!dir || !db) {
  console.error('Usage: npm run swim:replay -- <dir> [--db <path>]');
  process.exit(1);
}

const files = readdirSync(dir)
  .filter((f) => f.endsWith('.xml'))
  .sort();
const store = new FlightStore(db);
const ingest = new SwimIngest(store);
let kept = 0;
let dropped = 0;
for (const f of files) {
  const r = ingest.handle(readFileSync(join(dir, f), 'utf8'));
  if (r.kept) kept++;
  else dropped++;
  if (r.error) console.warn(`${f}: ${r.error}`);
}
console.log(
  `replayed ${files.length} payloads from ${dir} into ${db}: ${kept} kept, ${dropped} dropped, ` +
    `${ingest.upserts} flight updates, ${ingest.parseErrors} unparsable; the store holds ${store.count()} flights`,
);
