import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import { assembleNavData, NASR_FILES } from './assemble.ts';
import { csvZipUrl } from './cycle.ts';
import { navDataFileName } from './load.ts';
import type { NavDataFile } from './types.ts';

export interface BuildOptions {
  outDir: string;
  cacheDir: string; // downloaded zips, reused by later runs
  log?: (msg: string) => void;
  fetch?: typeof fetch;
}

/** Download one NASR cycle's CSV zips and write `<outDir>/nasr-<cycle>.json.gz` atomically. */
export async function buildCycle(cycle: string, opts: BuildOptions): Promise<{ path: string; data: NavDataFile }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cycle)) throw new Error(`bad cycle "${cycle}", expected YYYY-MM-DD`);
  const log = opts.log ?? (() => {});
  const fetchFn = opts.fetch ?? fetch;
  mkdirSync(opts.cacheDir, { recursive: true });
  mkdirSync(opts.outDir, { recursive: true });

  const download = async (category: string): Promise<Uint8Array> => {
    const file = join(opts.cacheDir, `${category}.zip`);
    if (existsSync(file)) return readFileSync(file);
    const url = csvZipUrl(cycle, category);
    log(`downloading ${url}`);
    const res = await fetchFn(url, { headers: { 'User-Agent': 'webfly-navdata-build' }, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    writeFileSync(file, bytes);
    return bytes;
  };

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
  const path = join(opts.outDir, navDataFileName(cycle));
  // Write then rename, so a reader never sees a half-written file.
  writeFileSync(`${path}.tmp`, gzipSync(JSON.stringify(data)));
  renameSync(`${path}.tmp`, path);
  return { path, data };
}

/** Remove a cycle's downloaded zips once its nav file is built. */
export function dropCache(cacheDir: string): void {
  rmSync(cacheDir, { recursive: true, force: true });
}
