import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildNavData } from '../../navdata/buildCycle.ts';
import { cycleInEffect } from '../../navdata/cycle.ts';
import { findNavDataUpTo, loadNavDb, navDataFileName } from '../../navdata/load.ts';
import type { NavDb } from '../../navdata/navdb.ts';

export interface NavManagerOptions {
  dataDir: string;
  cacheDir?: string;
  now?: () => Date;
  /** Build the nav file for a cycle into `dataDir`; defaults to the FAA download. */
  build?: (cycle: string) => Promise<void>;
  log?: (msg: string) => void;
}

export interface NavStatus {
  cycle: string;
  lastCheckAt: number | null;
  lastError: string | null;
}

const DAY_MS = 86_400_000;

/**
 * Holds the in-memory nav DB and swaps it when a new NASR cycle takes effect (spec section 6.1). A failed
 * update keeps the current cycle and is retried at the next daily check.
 */
export class NavManager {
  private db: NavDb;
  private lastCheckAt: number | null = null;
  private lastError: string | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private checking: Promise<void> | undefined;
  private readonly now: () => Date;
  private readonly log: (msg: string) => void;

  private constructor(private readonly opts: NavManagerOptions, db: NavDb) {
    this.db = db;
    this.now = opts.now ?? (() => new Date());
    this.log = opts.log ?? (() => {});
  }

  /** Load the newest cycle that is already in effect, building it first if it is missing and nothing older exists. */
  static async create(opts: NavManagerOptions): Promise<NavManager> {
    const now = opts.now ?? (() => new Date());
    const current = cycleInEffect(now());
    let path = findNavDataUpTo(opts.dataDir, current);
    if (!path) {
      await (opts.build ?? defaultBuild(opts))(current);
      path = findNavDataUpTo(opts.dataDir, current);
    }
    if (!path) throw new Error(`no nav data in ${opts.dataDir} and building cycle ${current} produced none`);
    return new NavManager(opts, loadNavDb(path));
  }

  get nav(): NavDb {
    return this.db;
  }

  get status(): NavStatus {
    return { cycle: this.db.navCycle, lastCheckAt: this.lastCheckAt, lastError: this.lastError };
  }

  /** Swap to the cycle now in effect if we are behind it. Never throws; failures are kept in `status`. */
  check(): Promise<void> {
    this.checking ??= this.doCheck().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }

  private async doCheck(): Promise<void> {
    this.lastCheckAt = this.now().getTime();
    const current = cycleInEffect(this.now());
    if (this.db.cycle >= current) {
      this.lastError = null;
      return;
    }
    try {
      if (!existsSync(join(this.opts.dataDir, navDataFileName(current)))) await (this.opts.build ?? defaultBuild(this.opts))(current);
      this.db = loadNavDb(join(this.opts.dataDir, navDataFileName(current)));
      this.lastError = null;
      this.log(`nav data swapped to cycle ${current} (AIRAC ${this.db.navCycle})`);
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      this.log(`nav update to ${current} failed, keeping ${this.db.cycle}: ${this.lastError}`);
    }
  }

  /** Check once a day. */
  start(): void {
    this.timer ??= setInterval(() => void this.check(), DAY_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

const defaultBuild = (opts: NavManagerOptions) => async (cycle: string) => {
  await buildNavData({ cycle, cacheDir: opts.cacheDir ?? join(opts.dataDir, 'cache'), outDir: opts.dataDir, ...(opts.log ? { log: opts.log } : {}) });
};
