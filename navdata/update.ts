import { execFile } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { cycleFor } from './cycle.ts';
import { loadNavDb, navDataFileName } from './load.ts';
import type { NavDb } from './navdb.ts';

const DAY_MS = 86_400_000;
/** Nav files kept in the update directory (the current cycle and the one before it). */
const KEEP_FILES = 2;

export interface NavUpdateStatus {
  lastCheckAt: number | null; // epoch ms
  lastError: string | null;
}

export interface NavUpdaterOptions {
  dir: string; // where new cycles are written (DATA_DIR/nasr on the volume)
  current: () => NavDb;
  swap: (db: NavDb) => void;
  now?: () => number;
  /** Build `cycle` into `dir` and return the file path. Defaults to a child process running navdata/build.ts. */
  build?: (cycle: string, dir: string) => Promise<string>;
  load?: (path: string) => NavDb;
  log?: (msg: string) => void;
}

/**
 * Builds the NASR cycle in a separate Node process: parsing the CSVs peaks near 300 MB, which is
 * handed back to the OS when the child exits instead of lingering in the server's heap.
 */
export async function buildInChildProcess(cycle: string, dir: string): Promise<string> {
  const script = fileURLToPath(new URL('./build.ts', import.meta.url));
  const cache = join(dir, '.cache', cycle);
  await promisify(execFile)(process.execPath, ['--disable-warning=ExperimentalWarning', script, cycle, '--out', dir, '--cache', cache, '--drop-cache'], {
    timeout: 10 * 60_000,
    maxBuffer: 1 << 20,
  });
  return join(dir, navDataFileName(cycle));
}

/**
 * Daily check (spec §6.1): once a newer cycle's effective date has passed, build it and swap it in.
 * On failure the current cycle stays loaded; the error shows in /api/health and the next check retries.
 */
export class NavUpdater {
  readonly status: NavUpdateStatus = { lastCheckAt: null, lastError: null };
  private readonly opts: NavUpdaterOptions;
  private readonly now: () => number;
  private running = false;
  private timers: Array<ReturnType<typeof setTimeout>> = [];

  constructor(opts: NavUpdaterOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
  }

  /** Returns true when a new cycle was swapped in. */
  async check(): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    const log = this.opts.log ?? ((m: string) => console.log(`navdata: ${m}`));
    try {
      const want = cycleFor(new Date(this.now()));
      if (want <= this.opts.current().cycle) {
        this.status.lastError = null;
        return false;
      }
      log(`building NASR cycle ${want}`);
      const path = await (this.opts.build ?? buildInChildProcess)(want, this.opts.dir);
      const db = (this.opts.load ?? loadNavDb)(path);
      if (db.cycle !== want) throw new Error(`built file holds cycle ${db.cycle}, expected ${want}`);
      this.opts.swap(db);
      this.status.lastError = null;
      this.prune();
      log(`now serving NASR cycle ${want} (AIRAC ${db.airac})`);
      return true;
    } catch (err) {
      this.status.lastError = (err as Error).message.split('\n')[0] ?? 'unknown error';
      log(`update failed, keeping cycle ${this.opts.current().cycle}: ${this.status.lastError}`);
      return false;
    } finally {
      this.status.lastCheckAt = this.now();
      this.running = false;
    }
  }

  /** First check shortly after boot (the baked-in cycle may be old), then daily. */
  start(firstDelayMs = 60_000): void {
    const first = setTimeout(() => void this.check(), firstDelayMs);
    const daily = setInterval(() => void this.check(), DAY_MS);
    first.unref();
    daily.unref();
    this.timers = [first, daily];
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
  }

  private prune(): void {
    const files = readdirSync(this.opts.dir)
      .filter((n) => /^nasr-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(n))
      .sort();
    for (const old of files.slice(0, -KEEP_FILES)) rmSync(join(this.opts.dir, old), { force: true });
  }
}
