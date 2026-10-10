import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { NavDb } from './navdb.ts';
import type { NavDataFile } from './types.ts';

export const navDataFileName = (cycle: string) => `nasr-${cycle}.json.gz`;

/** Path of the newest nasr-YYYY-MM-DD.json.gz in `dir`, or undefined. */
export function findLatestNavData(dir: string): string | undefined {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return undefined;
  }
  const latest = names.filter((n) => /^nasr-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(n)).sort().at(-1);
  return latest ? join(dir, latest) : undefined;
}

export function loadNavDb(path: string): NavDb {
  const data = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as NavDataFile;
  return new NavDb(data);
}

/**
 * Path of the newest nasr-*.json.gz in `dir` whose cycle is not after `maxCycle` (so a future cycle built
 * early is never loaded before it takes effect), or undefined.
 */
export function findNavDataUpTo(dir: string, maxCycle: string): string | undefined {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return undefined;
  }
  const ok = names
    .map((n) => /^nasr-(\d{4}-\d{2}-\d{2})\.json\.gz$/.exec(n))
    .filter((m): m is RegExpExecArray => m !== null && m[1] <= maxCycle)
    .map((m) => m[0])
    .sort();
  const latest = ok.at(-1);
  return latest ? join(dir, latest) : undefined;
}
