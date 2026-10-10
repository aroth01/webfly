import { describe, expect, it } from 'vitest';
import { getJson } from './api.ts';
import { addRecent, loadRecent } from './recent.ts';

const res = (body: unknown, status = 200) => (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('getJson', () => {
  it('returns data on success', async () => {
    expect(await getJson('/x', res({ a: 1 }))).toEqual({ ok: true, data: { a: 1 } });
  });
  it('maps the server error shape', async () => {
    expect(await getJson('/x', res({ error: { code: 'not_found', message: 'nope' } }, 404))).toEqual({ ok: false, status: 404, code: 'not_found', message: 'nope' });
  });
  it('flags 429 as rate_limited', async () => {
    expect(await getJson('/x', res({ error: { code: 'rate_limited', message: 'slow' } }, 429))).toMatchObject({ ok: false, status: 429, code: 'rate_limited' });
  });
  it('survives non-JSON error bodies and network failures', async () => {
    expect(await getJson('/x', res('<html>bad gateway</html>', 502))).toMatchObject({ ok: false, status: 502, code: 'http_error' });
    const down = (async () => {
      throw new TypeError('failed');
    }) as unknown as typeof fetch;
    expect(await getJson('/x', down)).toMatchObject({ ok: false, status: 0, code: 'network' });
  });
});

describe('recent searches', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it('keeps the newest first, de-duplicated, capped at 6', () => {
    const s = mem();
    for (const q of ['aa1', 'aa2', 'aa3', 'aa4', 'aa5', 'aa6', 'aa7', 'aa2']) addRecent(q, s);
    expect(loadRecent(s)).toEqual(['AA2', 'AA7', 'AA6', 'AA5', 'AA4', 'AA3']);
  });
  it('works when storage throws or holds junk', () => {
    const bad = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadRecent(bad)).toEqual([]);
    expect(addRecent('aa1', bad)).toEqual(['AA1']);
    expect(loadRecent({ getItem: () => '{"not":"an array"}', setItem: () => {} })).toEqual([]);
    expect(loadRecent(undefined)).toEqual([]);
  });
});
