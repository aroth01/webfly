/** Per-key token buckets: `capacity` requests at once, refilled at `perMinute` / 60 per second. */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly now: () => number;

  constructor(perMinute: number, capacity = perMinute, now: () => number = Date.now) {
    this.capacity = capacity;
    this.refillPerMs = perMinute / 60_000;
    this.now = now;
  }

  /** Spend one token for `key`; false when the bucket is empty. */
  take(key: string): boolean {
    const now = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= 10_000) this.prune(now);
      b = { tokens: this.capacity, at: now };
      this.buckets.set(key, b);
    }
    b.tokens = Math.min(this.capacity, b.tokens + (now - b.at) * this.refillPerMs);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /** Seconds until `key` has a token again. */
  retryAfterSec(key: string): number {
    const b = this.buckets.get(key);
    return b ? Math.max(1, Math.ceil((1 - b.tokens) / this.refillPerMs / 1000)) : 0;
  }

  /** Forget buckets that have refilled completely; they behave exactly like new ones. */
  private prune(now: number): void {
    for (const [k, b] of this.buckets) {
      if (b.tokens + (now - b.at) * this.refillPerMs >= this.capacity) this.buckets.delete(k);
    }
  }
}
