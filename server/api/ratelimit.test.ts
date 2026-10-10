import { describe, expect, it } from 'vitest';
import { RateLimiter } from './ratelimit.ts';

describe('RateLimiter', () => {
  it('allows a burst of `capacity`, then refills one token per 60/perMinute seconds', () => {
    let now = 0;
    const rl = new RateLimiter(60, 3, () => now);
    expect([rl.take('a'), rl.take('a'), rl.take('a'), rl.take('a')]).toEqual([true, true, true, false]);
    expect(rl.retryAfterSec('a')).toBe(1);
    expect(rl.take('b')).toBe(true);
    now = 1000;
    expect([rl.take('a'), rl.take('a')]).toEqual([true, false]);
  });
});
