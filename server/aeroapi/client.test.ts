import { describe, expect, it } from 'vitest';
import { FlightStore } from '../store/flights.ts';
import { resolve } from '../resolve/resolve.ts';
import { AeroApiClient, toFlightRow, type AeroFlight } from './client.ts';

const NOW = Date.parse('2026-10-10T20:00:00Z');
const flight = (o: Partial<AeroFlight> = {}): AeroFlight => ({
  ident: 'AAL558',
  ident_icao: 'AAL558',
  fa_flight_id: 'AAL558-1791-schedule-0001',
  origin: { code_icao: 'KDFW' },
  destination: { code_icao: 'KLAX' },
  route: 'KDFW.AKUNA9.MLC..KLAX',
  aircraft_type: 'A321',
  scheduled_off: '2026-10-10T20:30:00Z',
  ...o,
});

describe('toFlightRow', () => {
  it('derives status from the actual times and cancellation', () => {
    expect(toFlightRow(flight(), 0)?.status).toBe('filed');
    expect(toFlightRow(flight({ actual_off: '2026-10-10T20:40:00Z' }), 0)?.status).toBe('active');
    expect(toFlightRow(flight({ actual_off: '2026-10-10T20:40:00Z', actual_on: '2026-10-10T23:00:00Z' }), 0)?.status).toBe('arrived');
    expect(toFlightRow(flight({ cancelled: true }), 0)?.status).toBe('cancelled');
  });
  it('maps fields and epoch seconds, preferring the estimated departure', () => {
    const r = toFlightRow(flight({ estimated_off: '2026-10-10T20:45:00Z', estimated_on: '2026-10-10T23:30:00Z' }), 5)!;
    expect(r).toMatchObject({ gufi: 'AAL558-1791-schedule-0001', callsign: 'AAL558', origin: 'KDFW', dest: 'KLAX', routeText: 'KDFW.AKUNA9.MLC..KLAX', acType: 'A321', updatedAt: 5 });
    expect(r.etd).toBe(Date.parse('2026-10-10T20:45:00Z') / 1000);
    expect(r.eta).toBe(Date.parse('2026-10-10T23:30:00Z') / 1000);
  });
  it('skips flights without an identity and tolerates missing fields', () => {
    expect(toFlightRow({ route: 'x' }, 0)).toBeNull();
    expect(toFlightRow({ ident: 'AAL1', fa_flight_id: 'x', origin: null, destination: null, scheduled_off: 'garbage' }, 0)).toEqual({ gufi: 'x', callsign: 'AAL1', status: 'filed', updatedAt: 0 });
  });
});

describe('AeroApiClient', () => {
  function make(handler: (url: string, init?: RequestInit) => Response | Promise<Response>, o: { perMinute?: number } = {}) {
    const calls: Array<{ url: string; key: string | undefined }> = [];
    let t = NOW;
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), key: (init?.headers as Record<string, string>)['x-apikey'] });
      return handler(String(url), init);
    }) as typeof fetch;
    const client = new AeroApiClient({ apiKey: 'k', fetch: fetchFn, now: () => t, ...o });
    return { client, calls, advance: (ms: number) => (t += ms) };
  }
  const ok = (flights: AeroFlight[]) => new Response(JSON.stringify({ flights }));

  it('sends the API key and caches per ident', async () => {
    const h = make(() => ok([flight()]));
    expect(await h.client.flights('aal558')).toHaveLength(1);
    await h.client.flights('AAL558');
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toEqual({ url: 'https://aeroapi.flightaware.com/aeroapi/flights/AAL558', key: 'k' });
    h.advance(121_000);
    await h.client.flights('AAL558');
    expect(h.calls).toHaveLength(2);
  });
  it('pauses after a 429 and serves the stale answer', async () => {
    let n = 0;
    const h = make(() => (n++ === 0 ? ok([flight()]) : new Response('{}', { status: 429 })));
    await h.client.flights('AAL558');
    h.advance(130_000);
    expect(await h.client.flights('AAL558')).toHaveLength(1); // 429, stale returned
    h.advance(130_000 - 120_000 + 1_000);
    await h.client.flights('AAL558');
    await h.client.flights('SWA1');
    expect(h.calls).toHaveLength(2); // paused: no further calls for 60 s
  });
  it('caps outbound calls per minute', async () => {
    const h = make(() => ok([]), { perMinute: 2 });
    for (const id of ['A1', 'A2', 'A3', 'A4']) await h.client.flights(id);
    expect(h.calls.length).toBe(2);
  });
  it('never throws: errors, bad bodies and network failures give an empty list', async () => {
    expect(await make(() => new Response('nope', { status: 500 })).client.flights('X1')).toEqual([]);
    expect(await make(() => new Response('not json')).client.flights('X2')).toEqual([]);
    expect(await make(() => ok(undefined as unknown as AeroFlight[])).client.flights('X3')).toEqual([]);
    expect(
      await make(() => {
        throw new Error('offline');
      }).client.flights('X4'),
    ).toEqual([]);
  });
  it('feeds the resolver through the store', async () => {
    const h = make(() => ok([flight(), flight({ fa_flight_id: 'old', scheduled_off: '2026-10-09T20:30:00Z', actual_on: '2026-10-09T23:00:00Z', actual_off: '2026-10-09T20:40:00Z' })]));
    const store = new FlightStore();
    for (const r of await h.client.rows('AAL558')) store.upsert(r);
    const r = resolve('AA558', store, NOW / 1000);
    expect(r.kind).toBe('one');
    if (r.kind === 'one') expect(r.row.routeText).toBe('KDFW.AKUNA9.MLC..KLAX');
  });
});
