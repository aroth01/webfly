// Test fixtures shared by server tests: a small synthetic nav world and a scriptable adsb.lol source.
import { NavDb } from '../../navdata/navdb.ts';
import type { NavDataFile } from '../../navdata/types.ts';
import type { AdsbAircraft, AdsbSource, TraceFull } from '../live/adsb.ts';

/** Laid out west to east along 30N: KAAA (100W) → VRA → J1 → VRB → KBBB (90W). */
export const WORLD: NavDataFile = {
  cycle: '2026-10-01',
  airports: [
    { id: 'AAA', icao: 'KAAA', name: 'ORIGIN INTL', lat: 30.0, lon: -100.0, rwyFt: 10000, pub: true },
    { id: 'BBB', icao: 'KBBB', name: 'DEST INTL', lat: 30.0, lon: -90.0, rwyFt: 10000, pub: true },
    { id: 'CCC', icao: 'KCCC', name: 'THIRD FIELD', lat: 35.0, lon: -95.0, rwyFt: 8000, pub: true },
  ],
  navaids: [
    { id: 'VRA', type: 'VORTAC', name: 'ALPHA', lat: 30.0, lon: -98.0, varDeg: 5 },
    { id: 'VRB', type: 'VORTAC', name: 'BRAVO', lat: 30.0, lon: -95.0, varDeg: 3 },
  ],
  fixes: [
    { id: 'WPT1', lat: 30.0, lon: -97.0 },
    { id: 'WPT2', lat: 30.0, lon: -96.0 },
  ],
  airways: [{ id: 'J1', loc: 'C', pts: ['VRA', 'WPT1', 'WPT2', 'VRB'] }],
  procs: [],
  prefRoutes: [
    { orig: 'AAA', dest: 'BBB', type: 'L', route: 'AAA NOSUCH BBB' },
    { orig: 'AAA', dest: 'BBB', type: 'H', route: 'AAA VRA J1 VRB BBB' },
  ],
};

export const worldDb = () => new NavDb(WORLD);

export const aircraft = (over: Partial<AdsbAircraft> = {}): AdsbAircraft => ({
  hex: 'a05c59',
  callsign: 'AAL558',
  lat: 30.0,
  lon: -96.5,
  altBaro: 35000,
  onGround: false,
  gs: 450,
  track: 90,
  posTime: 0,
  ...over,
});

/** adsb.lol stand-in: aircraft by callsign, traffic list, traces and routesets set per test. */
export class FakeAdsb implements AdsbSource {
  byCs = new Map<string, AdsbAircraft[]>();
  nearby: AdsbAircraft[] = [];
  traces = new Map<string, TraceFull>();
  routes = new Map<string, string[]>();
  down = false;
  calls = 0;

  async byCallsign(callsign: string): Promise<AdsbAircraft[]> {
    this.calls++;
    if (this.down) throw new Error('adsb.lol down');
    return this.byCs.get(callsign) ?? [];
  }
  async around(): Promise<AdsbAircraft[]> {
    if (this.down) throw new Error('adsb.lol down');
    return this.nearby;
  }
  async trace(hex: string): Promise<TraceFull | null> {
    if (this.down) throw new Error('adsb.lol down');
    return this.traces.get(hex) ?? null;
  }
  async routeset(callsign: string): Promise<string[] | null> {
    return this.routes.get(callsign) ?? null;
  }
}
