import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildCycle, dropCache } from './fetch.ts';
import { loadNavDb } from './load.ts';

// Minimal CSVs, one zip per NASR category, served by a fake fetch.
const CSV: Record<string, Record<string, string>> = {
  APT: {
    'APT_BASE.csv': '"SITE_NO","SITE_TYPE_CODE","ARPT_STATUS","ARPT_ID","ICAO_ID","ARPT_NAME","LAT_DECIMAL","LONG_DECIMAL","FACILITY_USE_CODE"\n"1","A","O","DFW","KDFW","DFW INTL",32.9,-97.0,"PU"\n',
    'APT_RWY.csv': '"SITE_NO","RWY_LEN"\n"1",13401\n',
  },
  NAV: { 'NAV_BASE.csv': '"NAV_ID","NAV_TYPE","NAV_STATUS","NAME","LAT_DECIMAL","LONG_DECIMAL","MAG_VARN","MAG_VARN_HEMIS"\n' },
  FIX: { 'FIX_BASE.csv': '"FIX_ID","LAT_DECIMAL","LONG_DECIMAL"\n"AKUNA",33.5,-96.2\n' },
  AWY: { 'AWY_BASE.csv': '"AWY_ID","AWY_LOCATION","AIRWAY_STRING"\n' },
  DP: { 'DP_RTE.csv': '"DP_COMPUTER_CODE","ROUTE_PORTION_TYPE","ROUTE_NAME","BODY_SEQ","TRANSITION_COMPUTER_CODE","POINT_SEQ","POINT","ARPT_RWY_ASSOC"\n' },
  STAR: { 'STAR_RTE.csv': '"STAR_COMPUTER_CODE","ROUTE_PORTION_TYPE","ROUTE_NAME","BODY_SEQ","TRANSITION_COMPUTER_CODE","POINT_SEQ","POINT","ARPT_RWY_ASSOC"\n' },
  PFR: { 'PFR_RMT_FMT.csv': '"Orig","Route String","Dest","Type"\n' },
};

describe('buildCycle', () => {
  it('downloads each category once, writes a loadable nav file and can drop its cache', async () => {
    const root = mkdtempSync(join(tmpdir(), 'webfly-nav-'));
    const urls: string[] = [];
    const fakeFetch = (async (url: string | URL | Request) => {
      urls.push(String(url));
      const cat = /_([A-Z]+)_CSV\.zip$/.exec(String(url))?.[1] as string;
      const files = Object.fromEntries(Object.entries(CSV[cat] ?? {}).map(([n, t]) => [n, strToU8(t)]));
      return new Response(zipSync(files));
    }) as typeof fetch;
    const opts = { outDir: join(root, 'out'), cacheDir: join(root, 'cache'), fetch: fakeFetch };
    const { path } = await buildCycle('2026-10-29', opts);
    expect(path).toBe(join(root, 'out', 'nasr-2026-10-29.json.gz'));
    expect(urls[0]).toBe('https://nfdc.faa.gov/webContent/28DaySub/extra/29_Oct_2026_APT_CSV.zip');
    expect(loadNavDb(path).airport('KDFW')?.rwyFt).toBe(13401);
    expect(readdirSync(join(root, 'out'))).toEqual(['nasr-2026-10-29.json.gz']);
    await buildCycle('2026-10-29', opts);
    expect(urls).toHaveLength(7);
    dropCache(opts.cacheDir);
    expect(existsSync(opts.cacheDir)).toBe(false);
  });

  it('fails on an HTTP error without leaving a nav file behind', async () => {
    const root = mkdtempSync(join(tmpdir(), 'webfly-nav-'));
    const notFound = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    await expect(buildCycle('2026-10-29', { outDir: join(root, 'out'), cacheDir: join(root, 'cache'), fetch: notFound })).rejects.toThrow('HTTP 404');
    expect(readdirSync(join(root, 'out'))).toEqual([]);
  });
});
