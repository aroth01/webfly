import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SwimIngest } from './ingest.ts';
import type { SwimStatus } from './status.ts';

export interface TransportHandlers {
  onUp(): void; // bound to the queue and receiving
  onDown(reason: string): void; // the connection is gone; the transport will not be used again
  onMessage(payload: string | null, ack: () => void): void;
}

/** One connection attempt to the SCDS queue (solclientjs in production, a fake in tests). */
export interface SwimTransport {
  connect(handlers: TransportHandlers): void;
  dispose(): void;
}

export interface ConsumerOptions {
  createTransport: () => SwimTransport;
  ingest: SwimIngest;
  now?: () => number;
  /** Run `fn` after `ms`; returns a cancel function. */
  schedule?: (fn: () => void, ms: number) => () => void;
  /** Called with every payload that updated a flight (see SWIM_RECORD_DIR). */
  record?: (payload: string) => void;
  log?: (msg: string) => void;
}

/** Reconnect backoff (spec §6.2): 1 s doubling to a 60 s cap. */
export const MIN_BACKOFF_MS = 1_000;
export const MAX_BACKOFF_MS = 60_000;
/** A connection that lasted this long counts as good, and resets the backoff. */
const STABLE_MS = 60_000;

const defaultSchedule = (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

/** Keeps one SCDS connection alive, feeds every message through the ingest pipeline and acknowledges it. */
export class SwimConsumer {
  private readonly opts: ConsumerOptions;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => () => void;
  private readonly log: (msg: string) => void;
  private transport: SwimTransport | undefined;
  private generation = 0;
  private stopped = true;
  private connected = false;
  private upAt = 0;
  private delay = MIN_BACKOFF_MS;
  private reconnects = 0;
  private startedAt: number | null = null;
  private cancelRetry: (() => void) | undefined;

  constructor(opts: ConsumerOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.schedule = opts.schedule ?? defaultSchedule;
    this.log = opts.log ?? ((m) => console.log(`swim: ${m}`));
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.startedAt = this.now();
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.generation++;
    this.cancelRetry?.();
    this.transport?.dispose();
    this.connected = false;
  }

  private open(): void {
    const gen = ++this.generation;
    const transport = this.opts.createTransport();
    this.transport = transport;
    transport.connect({
      onUp: () => {
        if (gen !== this.generation) return;
        this.connected = true;
        this.upAt = this.now();
        this.log('connected');
      },
      onDown: (reason) => {
        if (gen !== this.generation) return;
        this.generation++;
        const wasStable = this.connected && this.now() - this.upAt >= STABLE_MS;
        this.connected = false;
        transport.dispose();
        if (this.stopped) return;
        if (wasStable) this.delay = MIN_BACKOFF_MS;
        const wait = this.delay;
        this.delay = Math.min(this.delay * 2, MAX_BACKOFF_MS);
        this.reconnects++;
        this.log(`${reason}; reconnecting in ${wait / 1000} s`);
        this.cancelRetry = this.schedule(() => this.open(), wait);
      },
      onMessage: (payload, ack) => {
        try {
          if (!payload) return;
          const r = this.opts.ingest.handle(payload);
          if (r.error) this.log(`unparsable message (${r.error}): ${payload.slice(0, 200)}`);
          if (r.kept) this.opts.record?.(payload);
        } catch (err) {
          this.log(`ingest failed: ${(err as Error).message}`);
        } finally {
          // Always acknowledge: a message that can't be handled must not stall the queue.
          ack();
        }
      },
    });
  }

  status(): SwimStatus {
    const now = this.now();
    return {
      enabled: true,
      startedAt: this.startedAt,
      connected: this.connected,
      lastMessageAt: this.opts.ingest.lastKeptAt,
      keptPerMin: this.opts.ingest.kept.perMin(now),
      droppedPerMin: this.opts.ingest.dropped.perMin(now),
      reconnects: this.reconnects,
    };
  }
}

/** Writes each payload to `dir` as `<epoch ms>-<seq>.xml`, in replay order. */
export function fileRecorder(dir: string): (payload: string) => void {
  mkdirSync(dir, { recursive: true });
  let seq = 0;
  return (payload) => writeFileSync(join(dir, `${Date.now()}-${String(seq++).padStart(6, '0')}.xml`), payload);
}
