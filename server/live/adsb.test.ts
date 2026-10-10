import { describe, expect, it } from 'vitest';
import { HttpAdsbSource, parseRouteset, UpstreamError } from './adsb.ts';

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: Array<() => Response>) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch');
    return next();
  }) as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });

describe('HttpAdsbSource', () => {
  it('looks up a callsign, sends the User-Agent and normalizes the aircraft', async () => {
    const { fn, calls } = fakeFetch([
      json({
        now: 1_000_000,
        ac: [
          { hex: 'a05c59', flight: 'AAL558  ', lat: 33, lon: -100, alt_baro: 35000, gs: 452, track: 270.5, baro_rate: -64, seen_pos: 2.5, wd: 280, ws: 45 },
          { hex: 'abcdef', flight: 'AAL558  ' }, // no position: dropped
        ],
      }),
    ]);
    const src = new HttpAdsbSource({ userAgent: 'webfly-test (+https://example.test)', fetch: fn });
    const list = await src.byCallsign('AAL558');
    expect(calls[0]?.url).toBe('https://api.adsb.lol/v2/callsign/AAL558');
    expect((calls[0]?.init.headers as Record<string, string>)['User-Agent']).toBe('webfly-test (+https://example.test)');
    expect(list).toEqual([
      { hex: 'a05c59', callsign: 'AAL558', lat: 33, lon: -100, altBaro: 35000, onGround: false, gs: 452, track: 270.5, vs: -64, windDir: 280, windSpd: 45, posTime: 997_500 },
    ]);
  });

  it('marks aircraft on the ground', async () => {
    const { fn } = fakeFetch([json({ now: 5000, ac: [{ hex: 'a1', lat: 1, lon: 2, alt_baro: 'ground', seen_pos: 0 }] })]);
    const [ac] = await new HttpAdsbSource({ userAgent: 'x', fetch: fn }).around(1, 2, 45);
    expect(ac?.onGround).toBe(true);
    expect(ac?.altBaro).toBeUndefined();
  });

  it('backs off after 429 and skips calls until the backoff expires', async () => {
    let now = 0;
    const { fn, calls } = fakeFetch([json({}, 429), json({ now: 0, ac: [] })]);
    const src = new HttpAdsbSource({ userAgent: 'x', fetch: fn, now: () => now });
    await expect(src.byCallsign('X1')).rejects.toBeInstanceOf(UpstreamError);
    now = 1000;
    await expect(src.byCallsign('X1')).rejects.toThrow(/backing off/);
    expect(calls).toHaveLength(1);
    now = 2500;
    await expect(src.byCallsign('X1')).resolves.toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it('returns null for a missing trace and parses an existing one', async () => {
    const { fn, calls } = fakeFetch([
      () => new Response('not found', { status: 404 }),
      json({ icao: 'a05c59', timestamp: 100, trace: [[0, 1, 2, 'ground', 0, 0, 0, null, null]] }),
    ]);
    const src = new HttpAdsbSource({ userAgent: 'x', fetch: fn });
    expect(await src.trace('a05c59')).toBeNull();
    expect((await src.trace('a05c59'))?.timestamp).toBe(100);
    expect(calls[0]?.url).toBe('https://adsb.lol/data/traces/59/trace_full_a05c59.json');
  });

  it('treats an empty routeset reply as unknown', async () => {
    const { fn, calls } = fakeFetch([() => new Response('', { status: 201 })]);
    expect(await new HttpAdsbSource({ userAgent: 'x', fetch: fn }).routeset('AAL558', 33, -100)).toBeNull();
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ planes: [{ callsign: 'AAL558', lat: 33, lng: -100 }] });
  });
});

describe('parseRouteset', () => {
  it('reads airports from _airports or airport_codes, ignoring implausible routes', () => {
    expect(parseRouteset(JSON.stringify([{ callsign: 'AAL558', _airports: [{ icao: 'KDFW' }, { icao: 'KLAX' }] }]), 'AAL558')).toEqual(['KDFW', 'KLAX']);
    expect(parseRouteset(JSON.stringify([{ callsign: 'AAL558', airport_codes: 'KDFW-KLAX-PHNL' }]), 'AAL558')).toEqual(['KDFW', 'KLAX', 'PHNL']);
    expect(parseRouteset(JSON.stringify([{ callsign: 'AAL558', airport_codes: 'KDFW-KLAX', plausible: false }]), 'AAL558')).toBeNull();
    expect(parseRouteset(JSON.stringify([{ callsign: 'OTHER', airport_codes: 'KDFW-KLAX' }]), 'AAL558')).toBeNull();
    expect(parseRouteset('garbage', 'AAL558')).toBeNull();
  });
});
