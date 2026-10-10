import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { cycleInEffect } from '../../navdata/cycle.ts';
import { findNavDataUpTo } from '../../navdata/load.ts';
import type { NavDataFile } from '../../navdata/types.ts';
import { NavManager } from './manager.ts';

const file = (cycle: string): NavDataFile => ({ cycle, airports: [], navaids: [], fixes: [], airways: [], procs: [], prefRoutes: [] });
const put = (dir: string, cycle: string) => writeFileSync(join(dir, `nasr-${cycle}.json.gz`), gzipSync(JSON.stringify(file(cycle))));
const tmp = () => mkdtempSync(join(tmpdir(), 'webfly-nav-'));

describe('cycleInEffect', () => {
  it('switches at 0901Z, not midnight', () => {
    expect(cycleInEffect(new Date('2026-10-29T08:59:00Z'))).toBe('2026-10-01');
    expect(cycleInEffect(new Date('2026-10-29T09:01:00Z'))).toBe('2026-10-29');
    expect(cycleInEffect(new Date('2026-10-10T12:00:00Z'))).toBe('2026-10-01');
  });
});

describe('findNavDataUpTo', () => {
  it('ignores cycles that are not yet in effect', () => {
    const dir = tmp();
    put(dir, '2026-10-01');
    put(dir, '2026-10-29');
    expect(findNavDataUpTo(dir, '2026-10-10')).toMatch(/nasr-2026-10-01/);
    expect(findNavDataUpTo(dir, '2026-10-29')).toMatch(/nasr-2026-10-29/);
    expect(findNavDataUpTo(dir, '2026-09-01')).toBeUndefined();
    expect(findNavDataUpTo(join(dir, 'missing'), '2026-10-29')).toBeUndefined();
  });
});

describe('NavManager', () => {
  it('loads the cycle in effect, never an early-built future one', async () => {
    const dir = tmp();
    put(dir, '2026-10-01');
    put(dir, '2026-10-29');
    const m = await NavManager.create({ dataDir: dir, now: () => new Date('2026-10-10T00:00:00Z') });
    expect(m.nav.cycle).toBe('2026-10-01');
    expect(m.status.cycle).toBe('2610');
  });

  it('builds the current cycle when the data dir is empty', async () => {
    const dir = tmp();
    const built: string[] = [];
    const m = await NavManager.create({
      dataDir: dir,
      now: () => new Date('2026-10-10T00:00:00Z'),
      build: async (c) => {
        built.push(c);
        put(dir, c);
      },
    });
    expect(built).toEqual(['2026-10-01']);
    expect(m.nav.cycle).toBe('2026-10-01');
  });

  it('swaps when a new cycle takes effect, and builds it if needed', async () => {
    const dir = tmp();
    put(dir, '2026-10-01');
    let now = new Date('2026-10-10T00:00:00Z');
    const built: string[] = [];
    const m = await NavManager.create({
      dataDir: dir,
      now: () => now,
      build: async (c) => {
        built.push(c);
        put(dir, c);
      },
    });
    await m.check();
    expect(m.nav.cycle).toBe('2026-10-01');
    expect(built).toEqual([]);
    now = new Date('2026-10-29T10:00:00Z');
    await m.check();
    expect(built).toEqual(['2026-10-29']);
    expect(m.nav.cycle).toBe('2026-10-29');
    expect(m.status.cycle).toBe('2611');
  });

  it('keeps the current cycle and reports the error when the update fails, then recovers', async () => {
    const dir = tmp();
    put(dir, '2026-10-01');
    let now = new Date('2026-10-30T00:00:00Z');
    let fail = true;
    const m = await NavManager.create({
      dataDir: dir,
      now: () => new Date('2026-10-10T00:00:00Z'),
      build: async (c) => {
        if (fail) throw new Error('FAA down');
        put(dir, c);
      },
    });
    (m as unknown as { now: () => Date }).now = () => now;
    (m as unknown as { opts: { now: () => Date } }).opts.now = () => now;
    await m.check();
    expect(m.nav.cycle).toBe('2026-10-01');
    expect(m.status.lastError).toBe('FAA down');
    fail = false;
    await m.check();
    expect(m.nav.cycle).toBe('2026-10-29');
    expect(m.status.lastError).toBeNull();
  });
});
