// Usage: npm run navdata:build -- [YYYY-MM-DD]   (defaults to the cycle in force today; DATA_DIR overrides data/)
import { buildNavData } from './buildCycle.ts';
import { cycleFor } from './cycle.ts';

const cycle = process.argv[2] ?? cycleFor(new Date());
const { path, data } = await buildNavData({ cycle, cacheDir: '.cache/nasr', outDir: process.env.DATA_DIR ?? 'data', log: console.log });
console.log(
  `wrote ${path}: ${data.airports.length} airports, ${data.navaids.length} navaids, ${data.fixes.length} fixes, ` +
    `${data.airways.length} airways, ${data.procs.length} procedures, ${data.prefRoutes.length} preferred routes`,
);
