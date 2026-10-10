// Usage: npm run navdata:build -- [YYYY-MM-DD]   (defaults to the cycle in force today)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import { assembleNavData, NASR_FILES } from './assemble.ts';
import { csvZipUrl, cycleFor } from './cycle.ts';
import { navDataFileName } from './load.ts';

const cycle = process.argv[2] ?? cycleFor(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(cycle)) throw new Error(`bad cycle "${cycle}", expected YYYY-MM-DD`);

const cacheDir = join('.cache', 'nasr', cycle);
const outDir = 'data';
mkdirSync(cacheDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

async function download(category: string): Promise<Uint8Array> {
  const file = join(cacheDir, `${category}.zip`);
  if (existsSync(file)) return readFileSync(file);
  const url = csvZipUrl(cycle, category);
  console.log(`downloading ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': 'webfly-navdata-build' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  writeFileSync(file, bytes);
  return bytes;
}

const csv: Record<string, string> = {};
for (const [category, wanted] of Object.entries(NASR_FILES)) {
  const entries = unzipSync(await download(category), { filter: (f) => (wanted as readonly string[]).includes(f.name) });
  for (const name of wanted) {
    const bytes = entries[name];
    if (!bytes) throw new Error(`${category}.zip has no ${name}`);
    csv[name] = Buffer.from(bytes).toString('utf8');
  }
}

const data = assembleNavData(cycle, csv);
const out = join(outDir, navDataFileName(cycle));
writeFileSync(out, gzipSync(JSON.stringify(data)));
console.log(
  `wrote ${out}: ${data.airports.length} airports, ${data.navaids.length} navaids, ${data.fixes.length} fixes, ` +
    `${data.airways.length} airways, ${data.procs.length} procedures, ${data.prefRoutes.length} preferred routes`,
);
