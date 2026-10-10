import { describe, expect, it } from 'vitest';
import { LiveService } from '../live/live.ts';
import { FlightStore } from '../store/flights.ts';
import { SWIM_DISABLED, type SwimStatus } from '../swim/status.ts';
import { aircraft, FakeAdsb, worldDb } from '../testing/world.ts';
import { AirlineDb } from './airlines.ts';
import { FlightResolver } from './resolve.ts';

const NOW_MS = 1_800_000_000_000;
const NOW = NOW_MS / 1000;
const airlines = new AirlineDb([
  { iata: 'AA', icao: 'AAL', name: 'American Airlines', regionals: ['ENY', 'SKW'] },
  { iata: 'MQ', icao: 'ENY', name: 'Envoy Air' },
  { iata: 'OO', icao: 'SKW', name: 'SkyWest Airlines' },
]);

function setup(swim: SwimStatus = SWIM_DISABLED) {
  const flights = new FlightStore(':memory:');
  const adsb = new FakeAdsb();
  let now = NOW_MS;
  const db = worldDb();
  const resolver = new FlightResolver({ nav: () => db, flights, live: new LiveService(adsb, () => now), airlines, swim: () => swim, now: () => now });
  return { flights, adsb, resolver, advance: (ms: number) => (now += ms) };
}

describe('FlightResolver', () => {
  it('builds a FlightView from the stored plan with the decoded filed route', async () => {
    const { flights, adsb, resolver } = setup();
    flights.upsert({ gufi: 'G1', callsign: 'AAL558', origin: 'KAAA', dest: 'KBBB', routeText: 'KAAA..VRA.J1.VRB..KBBB', acType: 'A321', etd: NOW - 3600, atd: NOW - 3500, eta: NOW + 3600, status: 'active', amendedAt: NOW - 100, updatedAt: NOW });
    adsb.byCs.set('AAL558', [aircraft()]);
    const r = await resolver.resolve(' aa 558 ');
    expect(r.kind).toBe('flight');
    if (r.kind !== 'flight') return;
    expect(r.view).toMatchObject({
      query: 'aa 558',
      callsign: 'AAL558',
      gufi: 'G1',
      operator: 'American Airlines',
      acType: 'A321',
      origin: { icao: 'KAAA', name: 'ORIGIN INTL', lat: 30, lon: -100 },
      dest: { icao: 'KBBB' },
      status: 'active',
      etd: NOW - 3600,
      atd: NOW - 3500,
      eta: NOW + 3600,
      hex: 'a05c59',
      navCycle: '2610',
      route: { source: 'filed', text: 'KAAA..VRA.J1.VRB..KBBB', partial: false, amendedAt: NOW - 100 },
    });
    expect(r.view.route.points.map((p) => p.ident)).toEqual(['KAAA', 'VRA', 'WPT1', 'WPT2', 'VRB', 'KBBB']);
    expect(r.view.degraded).toBeUndefined();
  });

  it('flags filed routes as possibly delayed when SWIM has been silent for over 3 minutes', async () => {
    const { flights, resolver } = setup({ ...SWIM_DISABLED, enabled: true, connected: true, startedAt: NOW_MS - 3_600_000, lastMessageAt: NOW_MS - 181_000 });
    flights.upsert({ gufi: 'G1', callsign: 'AAL558', origin: 'KAAA', dest: 'KBBB', routeText: 'KAAA..KBBB', status: 'arrived', ata: NOW - 60, updatedAt: NOW });
    const r = await resolver.resolve('AA558');
    expect(r.kind === 'flight' && r.view.degraded).toBe('swim_delayed');
  });

  it('returns a pick list when several operators are flying the number', async () => {
    const { flights, resolver } = setup();
    flights.upsert({ gufi: 'G1', callsign: 'ENY558', origin: 'KAAA', dest: 'KBBB', status: 'active', atd: NOW - 600, updatedAt: NOW });
    flights.upsert({ gufi: 'G2', callsign: 'SKW558', origin: 'KCCC', dest: 'KBBB', etd: NOW - 1200, status: 'active', atd: NOW - 900, updatedAt: NOW });
    expect(await resolver.resolve('AA558')).toEqual({
      kind: 'choices',
      choices: [
        { query: 'ENY558', callsign: 'ENY558', origin: 'KAAA', dest: 'KBBB', status: 'active' },
        { query: 'SKW558', callsign: 'SKW558', origin: 'KCCC', dest: 'KBBB', etd: NOW - 1200, status: 'active' },
      ],
    });
  });

  it('uses the preferred route as the expected route when a plan has no route text', async () => {
    const { flights, resolver } = setup();
    flights.upsert({ gufi: 'G1', callsign: 'AAL558', origin: 'KAAA', dest: 'KBBB', etd: NOW + 600, status: 'filed', updatedAt: NOW });
    const r = await resolver.resolve('AA558');
    expect(r.kind === 'flight' && r.view.route).toMatchObject({ source: 'expected', text: 'AAA VRA J1 VRB BBB', partial: false });
  });

  it('falls back to adsb.lol and the routeset when no plan is stored', async () => {
    const { adsb, resolver } = setup();
    adsb.byCs.set('SKW558', [aircraft({ hex: 'abc123', callsign: 'SKW558' })]);
    adsb.routes.set('SKW558', ['KCCC', 'KAAA', 'KBBB']);
    const r = await resolver.resolve('AA558');
    expect(r.kind).toBe('flight');
    if (r.kind !== 'flight') return;
    expect(r.view).toMatchObject({ callsign: 'SKW558', operator: 'SkyWest Airlines', status: 'active', hex: 'abc123', origin: { icao: 'KAAA' }, dest: { icao: 'KBBB' } });
    expect(r.view.route.source).toBe('expected');
    expect(r.view.route.points.map((p) => p.ident)).toEqual(['KAAA', 'VRA', 'WPT1', 'WPT2', 'VRB', 'KBBB']);
  });

  it('draws a great circle when the pair has no preferred route', async () => {
    const { adsb, resolver } = setup();
    adsb.byCs.set('AAL558', [aircraft({ lat: 32, lon: -95 })]);
    adsb.routes.set('AAL558', ['KCCC', 'KBBB']);
    const r = await resolver.resolve('AA558');
    expect(r.kind === 'flight' && r.view.route).toEqual({
      source: 'expected',
      partial: false,
      points: [
        { ident: 'KCCC', lat: 35, lon: -95, kind: 'airport' },
        { ident: 'KBBB', lat: 30, lon: -90, kind: 'airport' },
      ],
    });
  });

  it('shows position only when neither a plan nor a routeset is known', async () => {
    const { adsb, resolver } = setup();
    adsb.byCs.set('AAL558', [aircraft({ onGround: true })]);
    const r = await resolver.resolve('AA558');
    expect(r.kind === 'flight' && r.view).toMatchObject({ status: 'unknown', route: { source: 'none', points: [], partial: false } });
  });

  it('reports malformed queries, unknown airlines and flights not found', async () => {
    const { resolver } = setup();
    expect(await resolver.resolve('hello')).toMatchObject({ kind: 'error', status: 400, code: 'malformed_query' });
    expect(await resolver.resolve('ZZ1')).toMatchObject({ kind: 'error', status: 400, code: 'unknown_airline' });
    expect(await resolver.resolve('AA558')).toEqual({
      kind: 'error',
      status: 404,
      code: 'not_found',
      message: "No flight AA558 found today. Try the operating carrier's code.",
    });
  });

  it('caches results for 60 s per normalized flight number', async () => {
    const { flights, adsb, resolver, advance } = setup();
    expect((await resolver.resolve('AA558')).kind).toBe('error');
    flights.upsert({ gufi: 'G1', callsign: 'AAL558', status: 'filed', etd: NOW + 600, updatedAt: NOW });
    const calls = adsb.calls;
    expect((await resolver.resolve('AAL 0558')).kind).toBe('error');
    expect(adsb.calls).toBe(calls);
    advance(60_000);
    expect((await resolver.resolve('AA558')).kind).toBe('flight');
  });
});
