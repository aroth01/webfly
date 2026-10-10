import { describe, expect, it } from 'vitest';
import { assembleNavData } from './assemble.ts';

const csv: Record<string, string> = {
  'APT_BASE.csv':
    '"SITE_NO","SITE_TYPE_CODE","ARPT_STATUS","ARPT_ID","ICAO_ID","ARPT_NAME","LAT_DECIMAL","LONG_DECIMAL","FACILITY_USE_CODE"\n' +
    '"23710.6","A","O","DFW","KDFW","DALLAS-FORT WORTH INTL",32.89723305,-97.03769472,"PU"\n',
  'APT_RWY.csv': '"SITE_NO","RWY_LEN"\n"23710.6",13401\n',
  'NAV_BASE.csv':
    '"NAV_ID","NAV_TYPE","NAV_STATUS","NAME","LAT_DECIMAL","LONG_DECIMAL","MAG_VARN","MAG_VARN_HEMIS"\n' +
    '"MLC","TACAN","OPERATIONAL IFR","MC ALESTER",34.85,-95.78,6,"E"\n',
  'FIX_BASE.csv': '"FIX_ID","LAT_DECIMAL","LONG_DECIMAL"\n"AKUNA",33.5,-96.2\n',
  'AWY_BASE.csv': '"AWY_ID","AWY_LOCATION","AIRWAY_STRING"\n"J52","C","AKUNA MLC"\n',
  'DP_RTE.csv':
    '"DP_COMPUTER_CODE","ROUTE_PORTION_TYPE","ROUTE_NAME","BODY_SEQ","TRANSITION_COMPUTER_CODE","POINT_SEQ","POINT","ARPT_RWY_ASSOC"\n' +
    '"AKUNA9.AKUNA","BODY","AKUNA",1,"",10,"AKUNA","DFW/31L"\n',
  'STAR_RTE.csv':
    '"STAR_COMPUTER_CODE","ROUTE_PORTION_TYPE","ROUTE_NAME","BODY_SEQ","TRANSITION_COMPUTER_CODE","POINT_SEQ","POINT","ARPT_RWY_ASSOC"\n',
  'PFR_RMT_FMT.csv': '"Orig","Route String","Dest","Type"\n"DFW","DFW AKUNA9 AKUNA J52 MLC","MLC","H"\n',
};

describe('assembleNavData', () => {
  it('parses every file into one NavDataFile', () => {
    const data = assembleNavData('2026-10-01', csv);
    expect(data.cycle).toBe('2026-10-01');
    expect(data.airports.map((a) => a.icao)).toEqual(['KDFW']);
    expect(data.navaids.map((n) => n.id)).toEqual(['MLC']);
    expect(data.fixes.map((f) => f.id)).toEqual(['AKUNA']);
    expect(data.airways.map((w) => w.id)).toEqual(['J52']);
    expect(data.procs.map((p) => `${p.kind}:${p.name}`)).toEqual(['SID:AKUNA9']);
    expect(data.prefRoutes).toHaveLength(1);
  });

  it('fails loudly when a file is missing', () => {
    const { ['FIX_BASE.csv']: _omit, ...rest } = csv;
    expect(() => assembleNavData('2026-10-01', rest)).toThrow('missing NASR file FIX_BASE.csv');
  });
});
