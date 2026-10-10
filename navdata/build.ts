// Usage: npm run navdata:build -- [YYYY-MM-DD] [--out <dir>] [--cache <dir>] [--drop-cache]
//   Defaults: the cycle in force today, --out data, --cache .cache/nasr/<cycle>
import { join } from 'node:path';
import { cycleFor } from './cycle.ts';
import { buildCycle, dropCache } from './fetch.ts';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const cycle = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? cycleFor(new Date());
const cacheDir = flag('--cache') ?? join('.cache', 'nasr', cycle);

const { path, data } = await buildCycle(cycle, { outDir: flag('--out') ?? 'data', cacheDir, log: console.log });
if (args.includes('--drop-cache')) dropCache(cacheDir);
console.log(
  `wrote ${path}: ${data.airports.length} airports, ${data.navaids.length} navaids, ${data.fixes.length} fixes, ` +
    `${data.airways.length} airways, ${data.procs.length} procedures, ${data.prefRoutes.length} preferred routes`,
);
