import { describe, expect, it } from 'vitest';
import { liveDelay } from './hooks/useLive.ts';
import { cleanQuery } from './query.ts';
import { parseRoute } from './router.ts';

describe('client helpers', () => {
  it('validates queries like the server', () => {
    expect(cleanQuery(' aa 558 ')).toBe('AA558');
    expect(cleanQuery('AAL558')).toBe('AAL558');
    expect(cleanQuery('hello')).toBeUndefined();
    expect(cleanQuery('AA12345')).toBeUndefined();
  });

  it('parses routes', () => {
    expect(parseRoute('/')).toEqual({ name: 'input' });
    expect(parseRoute('/f/AA558')).toEqual({ name: 'flight', query: 'AA558' });
    expect(parseRoute('/f/AA%20558/')).toEqual({ name: 'flight', query: 'AA 558' });
    expect(parseRoute('/elsewhere')).toEqual({ name: 'input' });
  });

  it('backs live polling off to 15 s for a minute after a 429', () => {
    expect(liveDelay(10_000, -Infinity)).toBe(5_000);
    expect(liveDelay(10_000, 0)).toBe(15_000);
    expect(liveDelay(60_001, 0)).toBe(5_000);
  });
});
