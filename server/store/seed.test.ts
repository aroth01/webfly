import { describe, expect, it } from 'vitest';
import { findLatestNavData, loadNavDb } from '../../navdata/load.ts';
import { decodeRoute } from '../route/decode.ts';
import { FlightStore } from './flights.ts';
import { readSeedFlights, seedFlights } from './seed.ts';

describe('seedFlights', () => {
  it('writes plans with times relative to now', () => {
    const store = new FlightStore(':memory:');
    const n = seedFlights(store, 1_000_000_000, [{ callsign: 'AAL1', origin: 'KAAA', dest: 'KBBB', acType: 'A321', status: 'active', etdMin: -10, atdMin: -5, route: 'KAAA..KBBB' }]);
    expect(n).toBe(1);
    expect(store.get('seed-AAL1')).toEqual({
      gufi: 'seed-AAL1', callsign: 'AAL1', origin: 'KAAA', dest: 'KBBB', acType: 'A321', routeText: 'KAAA..KBBB',
      etd: 1_000_000 - 600, atd: 1_000_000 - 300, status: 'active', updatedAt: 1_000_000,
    });
  });
});

const navPath = findLatestNavData('data');

describe.skipIf(!navPath)('seed routes against the built NASR cycle', () => {
  it('decode cleanly, except the one meant to show PARTIAL', () => {
    const db = loadNavDb(navPath as string);
    for (const s of readSeedFlights()) {
      expect(db.airport(s.origin), s.origin).toBeDefined();
      expect(db.airport(s.dest), s.dest).toBeDefined();
      if (!s.route) continue;
      const d = decodeRoute(s.route, db, { origin: s.origin, dest: s.dest });
      expect(d.partial, `${s.callsign}: ${d.unresolved.join(' ')} ${d.dropped.join(' ')}`).toBe(s.partial === true);
    }
  });
});
