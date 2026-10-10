import { describe, expect, it } from 'vitest';
import { crossTrackNm, distanceNm } from '../../shared/geo.ts';
import { FlightStore } from '../store/flights.ts';
import { worldDb } from '../testing/world.ts';
import { SimAdsbSource } from './sim.ts';

const T0 = 1_800_000_000; // epoch s

function setup(nowMs: number) {
  const flights = new FlightStore(':memory:');
  // KAAA → KBBB is 519 nm due east along 30N; ETA set for exactly 450 kt.
  flights.upsert({ gufi: 'G1', callsign: 'AAL558', origin: 'KAAA', dest: 'KBBB', routeText: 'KAAA..VRA.J1.VRB..KBBB', status: 'active', atd: T0, eta: T0 + Math.round((519.6 / 450) * 3600), updatedAt: T0 });
  const db = worldDb();
  return new SimAdsbSource({ flights, nav: () => db, now: () => nowMs });
}

describe('SimAdsbSource', () => {
  it('flies an active flight along its decoded route at the speed that meets its ETA', async () => {
    const sim = setup((T0 + 3600) * 1000);
    const [ac] = await sim.byCallsign('AAL558');
    expect(ac).toBeDefined();
    expect(distanceNm({ lat: 30, lon: -100 }, ac!)).toBeCloseTo(450, -1);
    expect(crossTrackNm(ac!, { lat: 30, lon: -100 }, { lat: 30, lon: -90 })).toBeLessThan(5);
    expect(ac!.altBaro).toBe(22_150); // 70 nm out, on a 3° descent
    expect(ac!.vs).toBeLessThan(0);
    const [cruise] = await setup((T0 + 1800) * 1000).byCallsign('AAL558');
    expect(cruise!.altBaro).toBe(35_000);
    expect(ac!.track).toBeGreaterThan(80);
    expect(ac!.track).toBeLessThan(100);
    expect(ac!.trueHeading).toBeDefined();
    expect(await sim.byCallsign('NOPE1')).toEqual([]);
  });

  it('lands at the destination', async () => {
    const [ac] = await setup((T0 + 3 * 3600) * 1000).byCallsign('AAL558');
    expect(ac!.onGround).toBe(true);
    expect(distanceNm({ lat: 30, lon: -90 }, ac!)).toBeLessThan(0.5);
  });

  it('surrounds a point with traffic and backfills a trace for the simulated aircraft', async () => {
    const sim = setup((T0 + 1800) * 1000);
    const traffic = await sim.around(30, -96, 45);
    expect(traffic.length).toBeGreaterThan(5);
    for (const t of traffic) expect(distanceNm({ lat: 30, lon: -96 }, t)).toBeLessThanOrEqual(45);
    const [ac] = await sim.byCallsign('AAL558');
    const trace = await sim.trace(ac!.hex);
    expect(trace?.trace.length).toBe(91);
    expect(trace?.trace[0]?.[8]).toEqual({ flight: 'AAL558' });
  });
});
