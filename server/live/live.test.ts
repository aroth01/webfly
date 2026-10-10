import { describe, expect, it } from 'vitest';
import type { AdsbAircraft, AdsbSource, TraceFull } from './adsb.ts';
import { LiveService, LiveUnavailableError } from './live.ts';

const subject: AdsbAircraft = { hex: 'a05c59', callsign: 'AAL558', lat: 33, lon: -100, altBaro: 35000, onGround: false, gs: 450, track: 270, posTime: 0 };

class FakeSource implements AdsbSource {
  calls = { byCallsign: 0, around: 0, trace: 0 };
  fail = false;
  aircraft: AdsbAircraft[] = [subject];
  nearby: AdsbAircraft[] = [];
  traceData: TraceFull | null = null;

  async byCallsign(): Promise<AdsbAircraft[]> {
    this.calls.byCallsign++;
    if (this.fail) throw new Error('adsb.lol down');
    return this.aircraft;
  }
  async around(): Promise<AdsbAircraft[]> {
    this.calls.around++;
    if (this.fail) throw new Error('adsb.lol down');
    return this.nearby;
  }
  async trace(): Promise<TraceFull | null> {
    this.calls.trace++;
    if (this.fail) throw new Error('adsb.lol down');
    return this.traceData;
  }
  async routeset(): Promise<string[] | null> {
    return null;
  }
}

describe('LiveService', () => {
  it('caches the aircraft for 5 s and reports its position age', async () => {
    let now = 1000;
    const src = new FakeSource();
    const live = new LiveService(src, () => now);
    const s1 = await live.liveState('AAL558');
    expect(s1.t).toBe(1000);
    expect(s1.aircraft).toEqual({ hex: 'a05c59', lat: 33, lon: -100, altBaro: 35000, gs: 450, track: 270, onGround: false, ageSec: 1 });
    now = 4000;
    await live.liveState('AAL558');
    expect(src.calls.byCallsign).toBe(1);
    now = 7000;
    await live.liveState('AAL558');
    expect(src.calls.byCallsign).toBe(2);
  });

  it('serves the last position with its growing age while adsb.lol is failing', async () => {
    let now = 0;
    const src = new FakeSource();
    const live = new LiveService(src, () => now);
    await live.liveState('AAL558');
    src.fail = true;
    now = 20_000;
    const s = await live.liveState('AAL558');
    expect(s.aircraft?.ageSec).toBe(20);
    expect(s.traffic).toEqual([]);
  });

  it('throws LiveUnavailableError when adsb.lol fails and nothing is cached', async () => {
    const src = new FakeSource();
    src.fail = true;
    await expect(new LiveService(src).liveState('AAL558')).rejects.toBeInstanceOf(LiveUnavailableError);
  });

  it('returns a null aircraft and no traffic for an unseen callsign', async () => {
    const src = new FakeSource();
    src.aircraft = [];
    expect(await new LiveService(src, () => 0).liveState('AAL558')).toEqual({ t: 0, aircraft: null, traffic: [] });
    expect(src.calls.around).toBe(0);
  });

  it('keeps airborne, recent traffic within 40 nm and excludes the subject', async () => {
    const src = new FakeSource();
    const near: AdsbAircraft = { hex: 'n1', callsign: 'SWA12', lat: 33.2, lon: -100, altBaro: 33800, onGround: false, track: 90, vs: 1500, posTime: 0 };
    src.nearby = [
      subject,
      near,
      { ...near, hex: 'far', lat: 34 }, // 60 nm away
      { ...near, hex: 'gnd', onGround: true },
      { ...near, hex: 'old', posTime: -61_000 },
    ];
    const s = await new LiveService(src, () => 0).liveState('AAL558');
    expect(s.traffic).toEqual([{ hex: 'n1', callsign: 'SWA12', lat: 33.2, lon: -100, alt: 33800, track: 90, vs: 1500 }]);
  });

  it('trims the trail and degrades to an empty trail on failure', async () => {
    const src = new FakeSource();
    src.traceData = { icao: 'a05c59', timestamp: 100, trace: [[0, 33, -99, 'ground', 0, 0, 0, null, null], [5, 33, -99.1, 2000, 200, 270, 0, 1500, { flight: 'AAL558' }]] };
    const live = new LiveService(src, () => 0);
    expect(await live.trail('a05c59', 'AAL558')).toEqual([[105, 33, -99.1, 2000]]);
    const failing = new FakeSource();
    failing.fail = true;
    expect(await new LiveService(failing).trail('a05c59')).toEqual([]);
  });
});
