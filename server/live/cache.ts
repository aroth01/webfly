export interface Cached<V> {
  value: V;
  fetchedAt: number; // epoch ms
  stale: boolean; // true when a refresh failed and the last good value is served instead
}

/**
 * Shared in-memory cache: values stay fresh for `ttlMs`; concurrent misses share one load;
 * when a refresh fails the last good value is served (stale) rather than an error.
 */
export class TtlCache<K, V> {
  private readonly entries = new Map<K, { value: V; fetchedAt: number }>();
  private readonly inflight = new Map<K, Promise<void>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(ttlMs: number, maxEntries: number, now: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
  }

  async get(key: K, load: () => Promise<V>): Promise<Cached<V>> {
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.fetchedAt < this.ttlMs) return { ...hit, stale: false };
    let pending = this.inflight.get(key);
    if (!pending) {
      pending = load()
        .then((value) => this.set(key, value))
        .finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    try {
      await pending;
    } catch (err) {
      if (hit) return { ...hit, stale: true };
      throw err;
    }
    const fresh = this.entries.get(key) as { value: V; fetchedAt: number };
    return { ...fresh, stale: false };
  }

  private set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, fetchedAt: this.now() });
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
  }
}
