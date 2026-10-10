import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import { assembleNavData, NASR_FILES } from './assemble.ts';
import { csvZipUrl } from './cycle.ts';
import { navDataFileName } from './load.ts';
import type { NavDataFile } from './types.ts';

export interface BuildOptions {
  cycle: string; // YYYY-MM-DD
  cacheDir: string; // downloaded zips live under <cacheDir>/<cycle>/
  outDir: string;
  fetch?: typeof fetch;
  log?: (msg: string) => void;
}

/** Write via a temp file and rename, so a crash never leaves a truncated file behind. */
export function writeAtomic(path: string, bytes: Uint8Array | string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, path);
}

/** Download (or reuse cached) NASR zips for a cycle and write `nasr-<cycle>.json.gz`. Returns the path and data. */
export async function buildNavData(opts: BuildOptions): Promise<{ path: string; data: NavDataFile }> {
  const { cycle, cacheDir, outDir } = opts;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cycle)) throw new Error(`bad cycle "${cycle}", expected YYYY-MM-DD`);
  const fetchFn = opts.fetch ?? fetch;
  const log = opts.log ?? (() => {});
  const dir = join(cacheDir, cycle);
  mkdirSync(dir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const download = async (category: string): Promise<Uint8Array> => {
    const file = join(dir, `${category}.zip`);
    if (existsSync(file)) {
      const cached = readFileSync(file);
      try {
        unzipSync(cached, { filter: () => false }); // a truncated or corrupt cached zip must not stick forever
        return cached;
      } catch {
        log(`cached ${category}.zip is invalid, re-downloading`);
      }
    }
    const url = csvZipUrl(cycle, category);
    log(`downloading ${url}`);
    const res = await fetchFn(url, { headers: { 'User-Agent': 'webfly-navdata-build' }, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    unzipSync(bytes, { filter: () => false }); // validate before caching
    writeAtomic(file, bytes);
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
  const path = join(outDir, navDataFileName(cycle));
  writeAtomic(path, gzipSync(JSON.stringify(data)));
  return { path, data };
}
