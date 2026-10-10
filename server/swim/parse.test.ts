import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSfdps } from './parse.ts';
import { mayContainKept } from './prefilter.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const epoch = (iso: string) => Date.parse(iso) / 1000;

describe('mayContainKept', () => {
  it('drops real track batches without parsing them', () => {
    expect(mayContainKept(fixture('nasa-race/MessageCollection-TH-36.xml'))).toBe(false);
    expect(mayContainKept(fixture('nasa-race/NasFlight-TH-single.xml'))).toBe(false);
  });

  it('keeps payloads that hold a lifecycle message, even inside a track batch', () => {
    expect(mayContainKept(fixture('synthetic/01-FH-AAL558.xml'))).toBe(true);
    expect(mayContainKept(fixture('synthetic/03-batch-DH-TH.xml'))).toBe(true);
    expect(mayContainKept('<x reportSource="FH"/>')).toBe(false);
  });
});

describe('parseSfdps', () => {
  it('reads every flight of a real MessageCollection', () => {
    const flights = parseSfdps(fixture('nasa-race/MessageCollection-TH-36.xml'));
    expect(flights).toHaveLength(36);
    expect(flights[0]).toEqual({
      source: 'TH',
      centre: 'ZKC',
      timestamp: Math.floor(epoch('2016-09-27T18:59:49.365Z')),
      gufi: 'c5787b6a-9fc6-4963-80cf-3ccce698c218',
      callsign: 'JIA5180',
      origin: 'KTUL',
      dest: 'KCLT',
      atd: epoch('2016-09-20T18:48:00Z'),
      eta: epoch('2016-09-20T20:39:00Z'),
      fdpsStatus: 'ACTIVE',
    });
    // Real payloads omit fields freely: some messages have no gufi, status or airports.
    expect(flights.filter((f) => f.gufi === undefined).length).toBeGreaterThan(0);
    expect(flights.every((f) => f.callsign !== undefined)).toBe(true);
  });

  it('reads the older single NasFlight root with different namespace prefixes', () => {
    const [f] = parseSfdps(fixture('nasa-race/NasFlight-TH-single.xml'));
    expect(f?.source).toBe('TH');
    expect(f?.centre).toBe('ZDC');
    expect(f?.atd).toBe(epoch('2015-09-11T15:58:00Z'));
  });

  it('extracts every field of a flight plan message, taking a proposed coordination time as the ETD', () => {
    expect(parseSfdps(fixture('synthetic/01-FH-AAL558.xml'))).toEqual([
      {
        source: 'FH',
        centre: 'ZFW',
        timestamp: Math.floor(epoch('2026-10-10T14:05:12.118Z')),
        gufi: '2b7c4e9a-58f1-4d0e-9a51-6f0e3c2d1a10',
        callsign: 'AAL558',
        origin: 'KDFW',
        dest: 'KLAX',
        routeText: 'KDFW.HRPER3.ABI.J66.EWM..SSO.J4.BXK..DNERO.ANJLL4.KLAX',
        acType: 'A321',
        etd: epoch('2026-10-10T16:40:00Z'),
        eta: epoch('2026-10-10T19:35:00Z'),
        fdpsStatus: 'PROPOSED',
      },
    ]);
  });

  it('does not take a departed coordination time as the ETD', () => {
    const flights = parseSfdps(fixture('synthetic/03-batch-DH-TH.xml'));
    expect(flights.map((f) => f.source)).toEqual(['TH', 'DH']);
    expect(flights[1]?.etd).toBeUndefined();
    expect(flights[1]?.atd).toBe(epoch('2026-10-10T16:51:00Z'));
  });

  it('rejects payloads that are not SFDPS FIXM', () => {
    expect(() => parseSfdps('<hello/>')).toThrow('not an SFDPS FIXM payload');
    expect(parseSfdps('<ns5:MessageCollection xmlns:ns5="http://www.faa.aero/nas/3.0"/>')).toEqual([]);
  });
});
