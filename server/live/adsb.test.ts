import { describe, expect, it } from 'vitest';
import { AdsbClient, liveState, parseRouteset } from './adsb.ts';
import { trimTrail } from './trail.ts';

const ac = (o: object) => ({ hex: 'abc123', flight: 'AAL558 ', lat: 33, lon: -97, alt_baro: 35000, gs: 450, track: 270, seen_pos: 1.2, ...o });

function harness(handler: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  let t = 1_000_000;
  const fetchFn = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return handler(String(url));
  }) as typeof fetch;
  const client = new AdsbClient({ fetch: fetchFn, now: () => t });
  return { client, calls, advance: (ms: number) => (t += ms), now: () => t };
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

describe('AdsbClient caching', () => {
  it('fetches once within 5 s, again after', async () => {
    const h = harness(() => json({ ac: [ac({})] }));
    await h.client.aircraft('AAL558');
    h.advance(4_000);
    await h.client.aircraft('AAL558');
    expect(h.calls).toHaveLength(1);
    h.advance(2_000);
    await h.client.aircraft('AAL558');
    expect(h.calls).toHaveLength(2);
  });

  it('serves the stale value with its true age when the upstream fails', async () => {
    let fail = false;
    const h = harness(() => (fail ? json({}, 500) : json({ ac: [ac({})] })));
    const first = await liveState(h.client, 'AAL558', h.now);
    expect(first.aircraft?.ageSec).toBe(1);
    fail = true;
    h.advance(20_000);
    const second = await liveState(h.client, 'AAL558', h.now);
    expect(second.aircraft?.lat).toBe(33);
    expect(second.aircraft?.ageSec).toBe(21);
  });

  it('backs off after a 429 instead of hammering the API', async () => {
    const h = harness(() => json({}, 429));
    await h.client.aircraft('A1');
    await h.client.aircraft('A2');
    expect(h.calls).toHaveLength(1);
    h.advance(1_500);
    await h.client.aircraft('A2');
    expect(h.calls).toHaveLength(2);
  });

  it('returns null / empty on network errors rather than throwing', async () => {
    const h = harness(() => {
      throw new Error('offline');
    });
    expect(await h.client.aircraft('X')).toBeNull();
    expect(await h.client.traffic(33, -97)).toEqual([]);
    expect(await h.client.trace('abc123')).toBeNull();
  });

  it('shares one traffic fetch across nearby points in the same cell', async () => {
    const h = harness(() => json({ ac: [] }));
    await h.client.traffic(33.01, -97.02);
    await h.client.traffic(33.04, -97.04);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toContain('/v2/point/33.0/-97.0/40');
  });
});

describe('liveState', () => {
  it('excludes the subject from traffic and maps fields', async () => {
    const h = harness((url) =>
      url.includes('/callsign/')
        ? json({ ac: [ac({ true_heading: 268, wd: 300, ws: 40, baro_rate: -64 })] })
        : json({ ac: [ac({}), ac({ hex: 'ffffff', flight: 'SWA1 ', alt_baro: 'ground' }), { hex: 'nopos' }] }),
    );
    const s = await liveState(h.client, 'AAL558', h.now);
    expect(s.aircraft).toMatchObject({ hex: 'abc123', altBaro: 35000, trueHeading: 268, windDir: 300, windSpd: 40, vs: -64, onGround: false });
    expect(s.traffic).toEqual([{ hex: 'ffffff', callsign: 'SWA1', lat: 33, lon: -97, track: 270 }]);
  });

  it('returns a null aircraft when the callsign is not flying', async () => {
    const h = harness(() => json({ ac: [] }));
    const s = await liveState(h.client, 'AAL1', h.now);
    expect(s).toEqual({ t: h.now(), aircraft: null, traffic: [] });
  });
});

describe('parseRouteset', () => {
  it('accepts arrays and JSON strings, ignores junk', () => {
    expect(parseRouteset([{ airport_codes: 'KDFW-KLAX' }])).toEqual({ origin: 'KDFW', dest: 'KLAX' });
    expect(parseRouteset('[{"airport_codes":"KDFW-KLAX"}]')).toEqual({ origin: 'KDFW', dest: 'KLAX' });
    expect(parseRouteset('')).toEqual({});
    expect(parseRouteset([{ airport_codes: 'unknown' }])).toEqual({});
    expect(parseRouteset(null)).toEqual({});
  });
});

describe('trimTrail', () => {
  const trace = {
    timestamp: 1000,
    trace: [
      [0, 32.9, -97.0, 'ground', 0, 0, 0, 0, { flight: 'AAL100  ' }],
      [60, 32.9, -97.1, 'ground', 10, 0, 0, 0, null],
      [120, 33.0, -97.3, 1500, 200, 0, 0, 0, { flight: 'AAL558  ' }],
      [180, 33.1, -97.5, 8000, 300, 0, 0, 0, null],
      [240, 33.2, -97.7, 'ground', 5, 0, 0, 0, null], // touch-and-go style ground point
      [300, 33.3, -97.9, 12000, 320, 0, 0, 0, null],
    ],
  };
  it('keeps points after the last ground point for the callsign only', () => {
    expect(trimTrail(trace, 'AAL558')).toEqual([[1300, 33.3, -97.9, 12000]]);
  });
  it('drops points flown under another callsign', () => {
    expect(trimTrail(trace, 'AAL100').map((p) => p[0])).toEqual([]);
  });
  it('tolerates malformed input', () => {
    expect(trimTrail(null, 'X')).toEqual([]);
    expect(trimTrail({}, 'X')).toEqual([]);
  });
});
