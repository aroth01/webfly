import { describe, expect, it } from 'vitest';
import { parseAirports, parseAirways, parseFixes, parseNavaids, parsePrefRoutes, parseProcedures } from './parse.ts';

describe('parseAirports', () => {
  const base = [
    { SITE_NO: '23710.6', SITE_TYPE_CODE: 'A', ARPT_STATUS: 'O', ARPT_ID: 'DFW', ICAO_ID: 'KDFW', ARPT_NAME: 'DALLAS-FORT WORTH INTL', LAT_DECIMAL: '32.89723305', LONG_DECIMAL: '-97.03769472', FACILITY_USE_CODE: 'PU' },
    { SITE_NO: '00106.', SITE_TYPE_CODE: 'A', ARPT_STATUS: 'O', ARPT_ID: '2A8', ICAO_ID: '', ARPT_NAME: 'ADDISON', LAT_DECIMAL: '34.21714166', LONG_DECIMAL: '-87.15815833', FACILITY_USE_CODE: 'PR' },
    { SITE_NO: '99999.', SITE_TYPE_CODE: 'H', ARPT_STATUS: 'O', ARPT_ID: 'XH1', ICAO_ID: '', ARPT_NAME: 'SOME HELIPORT', LAT_DECIMAL: '30', LONG_DECIMAL: '-90', FACILITY_USE_CODE: 'PR' },
    { SITE_NO: '88888.', SITE_TYPE_CODE: 'A', ARPT_STATUS: 'CI', ARPT_ID: 'XC1', ICAO_ID: '', ARPT_NAME: 'CLOSED', LAT_DECIMAL: '30', LONG_DECIMAL: '-90', FACILITY_USE_CODE: 'PU' },
  ];
  const rwys = [
    { SITE_NO: '23710.6', RWY_LEN: '13401' },
    { SITE_NO: '23710.6', RWY_LEN: '8500' },
    { SITE_NO: '00106.', RWY_LEN: '2644' },
  ];

  it('keeps operational airports with longest runway and ICAO id', () => {
    expect(parseAirports(base, rwys)).toEqual([
      { id: 'DFW', icao: 'KDFW', name: 'DALLAS-FORT WORTH INTL', lat: 32.89723305, lon: -97.03769472, rwyFt: 13401, pub: true },
      { id: '2A8', name: 'ADDISON', lat: 34.21714166, lon: -87.15815833, rwyFt: 2644, pub: false },
    ]);
  });
});

describe('parseNavaids', () => {
  it('keeps navigational types, drops shutdown, signs variation', () => {
    const rows = [
      { NAV_ID: 'ABI', NAV_TYPE: 'VORTAC', NAV_STATUS: 'OPERATIONAL IFR', NAME: 'ABILENE', LAT_DECIMAL: '32.48', LONG_DECIMAL: '-99.86', MAG_VARN: '10', MAG_VARN_HEMIS: 'E' },
      { NAV_ID: 'AA', NAV_TYPE: 'NDB', NAV_STATUS: 'OPERATIONAL IFR', NAME: 'KENIE', LAT_DECIMAL: '47.0', LONG_DECIMAL: '-96.8', MAG_VARN: '4', MAG_VARN_HEMIS: 'W' },
      { NAV_ID: 'OLD', NAV_TYPE: 'VOR', NAV_STATUS: 'SHUTDOWN', NAME: 'X', LAT_DECIMAL: '1', LONG_DECIMAL: '1', MAG_VARN: '', MAG_VARN_HEMIS: '' },
      { NAV_ID: 'VT1', NAV_TYPE: 'VOT', NAV_STATUS: 'OPERATIONAL IFR', NAME: 'X', LAT_DECIMAL: '1', LONG_DECIMAL: '1', MAG_VARN: '', MAG_VARN_HEMIS: '' },
    ];
    expect(parseNavaids(rows)).toEqual([
      { id: 'ABI', type: 'VORTAC', name: 'ABILENE', lat: 32.48, lon: -99.86, varDeg: 10 },
      { id: 'AA', type: 'NDB', name: 'KENIE', lat: 47.0, lon: -96.8, varDeg: -4 },
    ]);
  });
});

describe('parseFixes', () => {
  it('maps id and decimal coordinates', () => {
    expect(parseFixes([{ FIX_ID: 'AAALL', LAT_DECIMAL: '42.12018888', LONG_DECIMAL: '-71.14176111' }])).toEqual([
      { id: 'AAALL', lat: 42.12018888, lon: -71.14176111 },
    ]);
  });
});

describe('parseAirways', () => {
  it('splits the ordered airway string', () => {
    expect(parseAirways([{ AWY_ID: 'J52', AWY_LOCATION: 'C', AIRWAY_STRING: 'CFDDH SHUKA  CASCD' }])).toEqual([
      { id: 'J52', loc: 'C', pts: ['CFDDH', 'SHUKA', 'CASCD'] },
    ]);
  });
});

describe('parseProcedures', () => {
  it('builds a SID: common body suffix plus exit transitions', () => {
    const r = (ROUTE_PORTION_TYPE: string, ROUTE_NAME: string, TRANSITION_COMPUTER_CODE: string, POINT_SEQ: string, POINT: string, ARPT_RWY_ASSOC = '') => ({
      DP_COMPUTER_CODE: 'AKUNA9.AKUNA', ROUTE_PORTION_TYPE, ROUTE_NAME, BODY_SEQ: '1', TRANSITION_COMPUTER_CODE, POINT_SEQ, POINT, ARPT_RWY_ASSOC,
    });
    const rows = [
      r('BODY', 'BPARK-AKUNA', '', '20', 'YAMEL', 'DFW/18L, DFW/18R'),
      r('BODY', 'BPARK-AKUNA', '', '10', 'BPARK', 'DFW/18L, DFW/18R'),
      r('BODY', 'BPARK-AKUNA', '', '30', 'AKUNA', 'DFW/18L, DFW/18R'),
      r('BODY', 'CUZEN-AKUNA', '', '10', 'CUZEN', 'DFW/35C'),
      r('BODY', 'CUZEN-AKUNA', '', '20', 'AKUNA', 'DFW/35C'),
      r('TRANSITION', 'MCALESTER TRANSITION', 'AKUNA9.MLC', '10', 'AKUNA'),
      r('TRANSITION', 'MCALESTER TRANSITION', 'AKUNA9.MLC', '30', 'MLC'),
      r('TRANSITION', 'MCALESTER TRANSITION', 'AKUNA9.MLC', '20', 'TIKYS'),
    ];
    expect(parseProcedures(rows, 'SID')).toEqual([
      { name: 'AKUNA9', kind: 'SID', airports: ['DFW'], body: ['AKUNA'], transitions: { MLC: ['AKUNA', 'TIKYS', 'MLC'] } },
    ]);
  });

  it('builds a STAR: entry transitions plus common body prefix', () => {
    const r = (ROUTE_PORTION_TYPE: string, ROUTE_NAME: string, TRANSITION_COMPUTER_CODE: string, POINT_SEQ: string, POINT: string, ARPT_RWY_ASSOC = '') => ({
      STAR_COMPUTER_CODE: 'ANJLL.ANJLL4', ROUTE_PORTION_TYPE, ROUTE_NAME, BODY_SEQ: '1', TRANSITION_COMPUTER_CODE, POINT_SEQ, POINT, ARPT_RWY_ASSOC,
    });
    const rows = [
      r('BODY', 'ANJLL-CRCUS', '', '10', 'ANJLL', 'LAX'),
      r('BODY', 'ANJLL-CRCUS', '', '20', 'CAANN', 'LAX'),
      r('BODY', 'ANJLL-CRCUS', '', '30', 'CRCUS', 'LAX'),
      r('TRANSITION', 'SALYY TRANSITION', 'SALYY.ANJLL4', '10', 'SALYY'),
      r('TRANSITION', 'SALYY TRANSITION', 'SALYY.ANJLL4', '20', 'GLESN'),
      r('TRANSITION', 'SALYY TRANSITION', 'SALYY.ANJLL4', '30', 'ANJLL'),
    ];
    expect(parseProcedures(rows, 'STAR')).toEqual([
      { name: 'ANJLL4', kind: 'STAR', airports: ['LAX'], body: ['ANJLL', 'CAANN', 'CRCUS'], transitions: { SALYY: ['SALYY', 'GLESN', 'ANJLL'] } },
    ]);
  });
});

describe('parsePrefRoutes', () => {
  it('maps the remote-format columns', () => {
    expect(parsePrefRoutes([{ Orig: 'DFW', Dest: 'ORD', Type: 'H', 'Route String': 'DFW AKUNA9 MLC SGF WELTS TRTLL6 ORD ' }])).toEqual([
      { orig: 'DFW', dest: 'ORD', type: 'H', route: 'DFW AKUNA9 MLC SGF WELTS TRTLL6 ORD' },
    ]);
  });
});
