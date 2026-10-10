import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FlightStore } from '../store/flights.ts';
import { RateCounter, SwimIngest, toFlightRecord } from './ingest.ts';

const dir = new URL('./fixtures/synthetic/', import.meta.url);
const synthetic = (name: string) => readFileSync(new URL(name, dir), 'utf8');
const epoch = (iso: string) => Date.parse(iso) / 1000;
const GUFI = '2b7c4e9a-58f1-4d0e-9a51-6f0e3c2d1a10';

describe('toFlightRecord', () => {
  it('maps FDPS statuses, falling back to what the message type implies', () => {
    const rec = (fdpsStatus: string | undefined, source = 'FH') =>
      toFlightRecord({ source, gufi: 'G', callsign: 'X1', ...(fdpsStatus ? { fdpsStatus } : {}) }, undefined, 0)?.status;
    expect([rec('PROPOSED'), rec('ACTIVE'), rec('COMPLETED'), rec('CANCELLED'), rec('DROPPED')]).toEqual(['filed', 'active', 'arrived', 'cancelled', 'arrived']);
    expect([rec(undefined, 'DH'), rec(undefined, 'HV'), rec(undefined, 'CL'), rec(undefined, 'FH')]).toEqual(['active', 'arrived', 'cancelled', 'filed']);
  });

  it('never moves a status backwards and needs a gufi and a callsign', () => {
    const prev = { gufi: 'G', callsign: 'X1', status: 'active' as const, updatedAt: 0 };
    expect(toFlightRecord({ source: 'FH', gufi: 'G', fdpsStatus: 'PROPOSED' }, prev, 1)).toEqual({ gufi: 'G', callsign: 'X1', status: 'active', updatedAt: 1 });
    expect(toFlightRecord({ source: 'FH', callsign: 'X1' }, undefined, 1)).toBeUndefined();
    expect(toFlightRecord({ source: 'FH', gufi: 'G' }, undefined, 1)).toBeUndefined();
  });
});

describe('SwimIngest', () => {
  it('follows a flight from filed through amended, departed and arrived, until it is purged', () => {
    let now = Date.parse('2026-10-10T14:05:13Z');
    const store = new FlightStore(':memory:');
    const ingest = new SwimIngest(store, () => now);

    expect(ingest.handle(synthetic('01-FH-AAL558.xml'))).toEqual({ kept: true, upserts: 1 });
    expect(store.get(GUFI)).toEqual({
      gufi: GUFI, callsign: 'AAL558', origin: 'KDFW', dest: 'KLAX', routeText: 'KDFW.HRPER3.ABI.J66.EWM..SSO.J4.BXK..DNERO.ANJLL4.KLAX',
      acType: 'A321', etd: epoch('2026-10-10T16:40:00Z'), eta: epoch('2026-10-10T19:35:00Z'), status: 'filed', updatedAt: now / 1000,
    });

    now = Date.parse('2026-10-10T16:12:41Z');
    ingest.handle(synthetic('02-AH-AAL558.xml'));
    expect(store.get(GUFI)).toMatchObject({
      routeText: 'KDFW.HRPER3.ABI.J4.BXK..DNERO.ANJLL4.KLAX', etd: epoch('2026-10-10T16:45:00Z'), acType: 'A321',
      amendedAt: Math.floor(epoch('2026-10-10T16:12:40.502Z')), status: 'filed',
    });

    now = Date.parse('2026-10-10T16:52:08Z');
    expect(ingest.handle(synthetic('03-batch-DH-TH.xml'))).toEqual({ kept: true, upserts: 1 });
    expect(store.get(GUFI)).toMatchObject({ status: 'active', atd: epoch('2026-10-10T16:51:00Z'), eta: epoch('2026-10-10T19:41:00Z') });
    expect(store.byCallsigns(['UAL1979'])).toEqual([]); // the track message in the same batch is ignored

    now = Date.parse('2026-10-10T19:44:32Z');
    ingest.handle(synthetic('04-HV-AAL558.xml'));
    expect(store.get(GUFI)).toMatchObject({ status: 'arrived', ata: epoch('2026-10-10T19:44:00Z'), routeText: 'KDFW.HRPER3.ABI.J4.BXK..DNERO.ANJLL4.KLAX' });

    expect(store.purge(now / 1000 - 36 * 3600)).toBe(0);
    expect(store.purge(now / 1000 + 1)).toBe(1);
    expect(store.get(GUFI)).toBeUndefined();
  });

  it('records a cancellation', () => {
    const store = new FlightStore(':memory:');
    const ingest = new SwimIngest(store, () => Date.parse('2026-10-10T17:03:00Z'));
    ingest.handle(synthetic('05-FH-DAL1234.xml'));
    ingest.handle(synthetic('06-CL-DAL1234.xml'));
    expect(store.byCallsigns(['DAL1234'])).toMatchObject([{ status: 'cancelled', origin: 'KATL', routeText: 'KATL.SMLTZ3.WALET..ZJAYX.GRNCH5.KMCO' }]);
  });

  it('counts kept and dropped payloads per minute and survives garbage', () => {
    let now = 1_000_000;
    const store = new FlightStore(':memory:');
    const ingest = new SwimIngest(store, () => now);
    const track = readFileSync(new URL('./fixtures/nasa-race/MessageCollection-TH-36.xml', import.meta.url), 'utf8');
    ingest.handle(track);
    ingest.handle(track);
    expect(ingest.handle('<not xml source="FH"')).toMatchObject({ kept: false, upserts: 0 });
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.xml')).sort()) ingest.handle(synthetic(f));
    expect(ingest.kept.perMin(now)).toBe(6);
    expect(ingest.dropped.perMin(now)).toBe(3);
    expect(ingest.lastKeptAt).toBe(now);
    expect(ingest.upserts).toBe(6);
    now += 61_000;
    expect(ingest.kept.perMin(now)).toBe(0);
  });
});

describe('RateCounter', () => {
  it('slides over the last 60 seconds', () => {
    const c = new RateCounter();
    c.add(0);
    c.add(30_000, 2);
    expect(c.perMin(59_999)).toBe(3);
    expect(c.perMin(60_000)).toBe(2);
    expect(c.perMin(90_000)).toBe(0);
  });
});
