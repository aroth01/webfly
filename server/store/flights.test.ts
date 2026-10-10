import { describe, expect, it } from 'vitest';
import { FlightStore, type FlightRow } from './flights.ts';

const row = (o: Partial<FlightRow> = {}): FlightRow => ({
  gufi: 'g1',
  callsign: 'AAL558',
  origin: 'KDFW',
  dest: 'KLAX',
  status: 'filed',
  updatedAt: 1000,
  ...o,
});

describe('FlightStore', () => {
  it('upserts by gufi', () => {
    const s = new FlightStore();
    s.upsert(row());
    s.upsert(row({ status: 'active', routeText: 'KDFW..KLAX', updatedAt: 2000 }));
    expect(s.count()).toBe(1);
    const [r] = s.byCallsigns(['AAL558']);
    expect(r.status).toBe('active');
    expect(r.routeText).toBe('KDFW..KLAX');
    expect(r.updatedAt).toBe(2000);
  });

  it('filters by callsign list and returns none for empty list', () => {
    const s = new FlightStore();
    s.upsert(row());
    s.upsert(row({ gufi: 'g2', callsign: 'SKW558' }));
    s.upsert(row({ gufi: 'g3', callsign: 'DAL1' }));
    expect(s.byCallsigns(['AAL558', 'SKW558']).map((r) => r.gufi).sort()).toEqual(['g1', 'g2']);
    expect(s.byCallsigns([])).toEqual([]);
  });

  it('purges rows not updated since the cutoff', () => {
    const s = new FlightStore();
    s.upsert(row({ gufi: 'old', updatedAt: 100 }));
    s.upsert(row({ gufi: 'new', updatedAt: 900 }));
    expect(s.purge(500)).toBe(1);
    expect(s.byCallsigns(['AAL558']).map((r) => r.gufi)).toEqual(['new']);
  });
});
