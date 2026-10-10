import { describe, expect, it } from 'vitest';
import { FlightStore } from './flights.ts';

describe('FlightStore', () => {
  it('inserts, then merges partial updates without erasing known fields', () => {
    const store = new FlightStore(':memory:');
    store.upsert({ gufi: 'G1', callsign: 'AAL558', origin: 'KDFW', dest: 'KLAX', routeText: 'KDFW..KLAX', acType: 'A321', etd: 1000, status: 'filed', updatedAt: 10 });
    store.upsert({ gufi: 'G1', callsign: 'AAL558', atd: 1100, status: 'active', updatedAt: 20 });
    expect(store.get('G1')).toEqual({
      gufi: 'G1', callsign: 'AAL558', origin: 'KDFW', dest: 'KLAX', routeText: 'KDFW..KLAX', acType: 'A321',
      etd: 1000, atd: 1100, status: 'active', updatedAt: 20,
    });
    store.upsert({ gufi: 'G1', callsign: 'AAL558', routeText: 'KDFW.J1.KLAX', amendedAt: 1200, status: 'active', updatedAt: 30 });
    expect(store.get('G1')?.routeText).toBe('KDFW.J1.KLAX');
    expect(store.get('G1')?.amendedAt).toBe(1200);
    expect(store.count()).toBe(1);
  });

  it('finds plans by any of several callsigns', () => {
    const store = new FlightStore(':memory:');
    store.upsert({ gufi: 'A', callsign: 'AAL558', status: 'filed', updatedAt: 1 });
    store.upsert({ gufi: 'B', callsign: 'ENY558', status: 'filed', updatedAt: 1 });
    store.upsert({ gufi: 'C', callsign: 'DAL558', status: 'filed', updatedAt: 1 });
    expect(store.byCallsigns(['AAL558', 'ENY558']).map((r) => r.gufi).sort()).toEqual(['A', 'B']);
    expect(store.byCallsigns([])).toEqual([]);
    expect(store.get('nope')).toBeUndefined();
  });

  it('purges plans not updated since the cutoff', () => {
    const store = new FlightStore(':memory:');
    store.upsert({ gufi: 'OLD', callsign: 'X1', status: 'arrived', updatedAt: 100 });
    store.upsert({ gufi: 'NEW', callsign: 'X2', status: 'filed', updatedAt: 200 });
    expect(store.purge(150)).toBe(1);
    expect(store.byCallsigns(['X1', 'X2']).map((r) => r.gufi)).toEqual(['NEW']);
  });
});
