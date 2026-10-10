import { describe, expect, it } from 'vitest';
import { TtlCache } from './cache.ts';

describe('TtlCache', () => {
  it('serves fresh values until the TTL expires, then reloads', async () => {
    let now = 0;
    let loads = 0;
    const cache = new TtlCache<string, number>(5000, 10, () => now);
    const load = async () => ++loads;
    expect((await cache.get('k', load)).value).toBe(1);
    now = 4999;
    expect((await cache.get('k', load)).value).toBe(1);
    now = 5000;
    expect(await cache.get('k', load)).toEqual({ value: 2, fetchedAt: 5000, stale: false });
  });

  it('serves the last good value, marked stale, when a reload fails', async () => {
    let now = 0;
    const cache = new TtlCache<string, string>(1000, 10, () => now);
    await cache.get('k', async () => 'good');
    now = 3000;
    expect(await cache.get('k', async () => Promise.reject(new Error('down')))).toEqual({ value: 'good', fetchedAt: 0, stale: true });
    await expect(cache.get('other', async () => Promise.reject(new Error('down')))).rejects.toThrow('down');
  });

  it('shares one load between concurrent misses', async () => {
    let loads = 0;
    const cache = new TtlCache<string, number>(1000, 10);
    const load = () => new Promise<number>((resolve) => setTimeout(() => resolve(++loads), 5));
    const [a, b] = await Promise.all([cache.get('k', load), cache.get('k', load)]);
    expect([a.value, b.value, loads]).toEqual([1, 1, 1]);
  });

  it('evicts the least recently stored entry beyond the size bound', async () => {
    let loads = 0;
    const cache = new TtlCache<string, number>(60_000, 2);
    const load = async () => ++loads;
    await cache.get('a', load);
    await cache.get('b', load);
    await cache.get('c', load);
    expect((await cache.get('a', load)).value).toBe(4);
  });
});
