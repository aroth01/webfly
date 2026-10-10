import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NavDb } from './navdb.ts';
import type { NavDataFile } from './types.ts';
import { NavUpdater } from './update.ts';

const db = (cycle: string) => new NavDb({ cycle, airports: [], navaids: [], fixes: [], airways: [], procs: [], prefRoutes: [] } satisfies NavDataFile);

function setup(nowIso: string, build: (cycle: string, dir: string) => Promise<string>) {
  const dir = mkdtempSync(join(tmpdir(), 'webfly-upd-'));
  let current = db('2026-10-01');
  const built: string[] = [];
  const updater = new NavUpdater({
    dir,
    current: () => current,
    swap: (d) => (current = d),
    now: () => Date.parse(nowIso),
    build: async (cycle, d) => {
      built.push(cycle);
      return build(cycle, d);
    },
    load: (path) => db(/nasr-(\d{4}-\d{2}-\d{2})/.exec(path)?.[1] as string),
    log: () => {},
  });
  return { dir, updater, built, current: () => current };
}

describe('NavUpdater', () => {
  it('does nothing while the loaded cycle is current', async () => {
    const { updater, built } = setup('2026-10-28T23:00:00Z', async () => '');
    expect(await updater.check()).toBe(false);
    expect(built).toEqual([]);
    expect(updater.status).toEqual({ lastCheckAt: Date.parse('2026-10-28T23:00:00Z'), lastError: null });
  });

  it('builds and swaps in the new cycle once its effective date has passed, keeping two files', async () => {
    const { dir, updater, built, current } = setup('2026-10-29T06:00:00Z', async (cycle, d) => {
      const path = join(d, `nasr-${cycle}.json.gz`);
      writeFileSync(path, '');
      return path;
    });
    for (const old of ['2026-09-03', '2026-10-01']) writeFileSync(join(dir, `nasr-${old}.json.gz`), '');
    expect(await updater.check()).toBe(true);
    expect(built).toEqual(['2026-10-29']);
    expect(current().cycle).toBe('2026-10-29');
    expect(current().airac).toBe('2611');
    expect(existsSync(join(dir, 'nasr-2026-09-03.json.gz'))).toBe(false);
    expect(existsSync(join(dir, 'nasr-2026-10-01.json.gz'))).toBe(true);
  });

  it('keeps the current cycle and reports the error when the build fails', async () => {
    const { updater, current } = setup('2026-10-30T00:00:00Z', async () => {
      throw new Error('https://nfdc.faa.gov/... -> HTTP 503\nstack');
    });
    expect(await updater.check()).toBe(false);
    expect(current().cycle).toBe('2026-10-01');
    expect(updater.status.lastError).toBe('https://nfdc.faa.gov/... -> HTTP 503');
  });
});
