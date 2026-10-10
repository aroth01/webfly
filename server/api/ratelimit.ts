export interface RateLimiterOptions {
  capacity?: number; // burst size
  perMinute?: number; // sustained rate
  now?: () => number; // epoch ms
}

/** Token bucket per key (spec section 8: ~60 requests/min per IP). */
export class RateLimiter {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly now: () => number;
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private lastSweep = 0;

  constructor(opts: RateLimiterOptions = {}) {
    this.capacity = opts.capacity ?? 60;
    this.refillPerMs = (opts.perMinute ?? 60) / 60_000;
    this.now = opts.now ?? Date.now;
  }

  /** Whether `key` has a token left, without taking it. */
  has(key: string): boolean {
    const b = this.buckets.get(key);
    if (!b) return true;
    return Math.min(this.capacity, b.tokens + (this.now() - b.at) * this.refillPerMs) >= 1;
  }

  /** Take one token for `key`; false means the caller is over the limit. */
  take(key: string): boolean {
    const t = this.now();
    this.sweep(t);
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: t };
    b.tokens = Math.min(this.capacity, b.tokens + (t - b.at) * this.refillPerMs);
    b.at = t;
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    this.buckets.set(key, b);
    return ok;
  }

  /** Forget buckets that have been idle long enough to be full again, at most once a minute. */
  private sweep(t: number): void {
    if (t - this.lastSweep < 60_000) return;
    this.lastSweep = t;
    const idleMs = this.capacity / this.refillPerMs;
    for (const [k, b] of this.buckets) if (t - b.at > idleMs) this.buckets.delete(k);
  }
}
