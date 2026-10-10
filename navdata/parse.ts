import type { Row } from './csv.ts';
import type { AirportRec, AirwayRec, FixRec, NavaidRec, NavaidType, PrefRouteRec, ProcRec } from './types.ts';

const KEPT_NAVAID_TYPES = new Set<string>(['VOR', 'VOR/DME', 'VORTAC', 'TACAN', 'DME', 'NDB', 'NDB/DME']);

export function parseAirports(base: Row[], runways: Row[]): AirportRec[] {
  const longest = new Map<string, number>();
  for (const r of runways) {
    const len = Number(r.RWY_LEN) || 0;
    const site = r.SITE_NO ?? '';
    if (len > (longest.get(site) ?? 0)) longest.set(site, len);
  }
  return base
    .filter((r) => r.SITE_TYPE_CODE === 'A' && r.ARPT_STATUS === 'O')
    .map((r) => {
      const rec: AirportRec = {
        id: r.ARPT_ID ?? '',
        name: r.ARPT_NAME ?? '',
        lat: Number(r.LAT_DECIMAL),
        lon: Number(r.LONG_DECIMAL),
        rwyFt: longest.get(r.SITE_NO ?? '') ?? 0,
        pub: r.FACILITY_USE_CODE === 'PU',
      };
      if (r.ICAO_ID) rec.icao = r.ICAO_ID;
      return rec;
    });
}

export function parseNavaids(rows: Row[]): NavaidRec[] {
  return rows
    .filter((r) => r.NAV_STATUS !== 'SHUTDOWN' && KEPT_NAVAID_TYPES.has(r.NAV_TYPE ?? ''))
    .map((r) => ({
      id: r.NAV_ID ?? '',
      type: r.NAV_TYPE as NavaidType,
      name: r.NAME ?? '',
      lat: Number(r.LAT_DECIMAL),
      lon: Number(r.LONG_DECIMAL),
      varDeg: (Number(r.MAG_VARN) || 0) * (r.MAG_VARN_HEMIS === 'W' ? -1 : 1),
    }));
}

export function parseFixes(rows: Row[]): FixRec[] {
  return rows.map((r) => ({ id: r.FIX_ID ?? '', lat: Number(r.LAT_DECIMAL), lon: Number(r.LONG_DECIMAL) }));
}

export function parseAirways(rows: Row[]): AirwayRec[] {
  return rows.map((r) => ({
    id: r.AWY_ID ?? '',
    loc: r.AWY_LOCATION ?? '',
    pts: (r.AIRWAY_STRING ?? '').split(/\s+/).filter(Boolean),
  }));
}

/** Longest run of points shared by the end of every list (SID bodies converge on the exit fix). */
function commonSuffix(lists: string[][]): string[] {
  let common = lists[0] ?? [];
  for (const list of lists.slice(1)) {
    let k = 0;
    while (k < common.length && k < list.length && common[common.length - 1 - k] === list[list.length - 1 - k]) k++;
    common = common.slice(common.length - k);
  }
  return common;
}

/** Longest run of points shared by the start of every list (STAR bodies diverge toward runways). */
function commonPrefix(lists: string[][]): string[] {
  let common = lists[0] ?? [];
  for (const list of lists.slice(1)) {
    let k = 0;
    while (k < common.length && k < list.length && common[k] === list[k]) k++;
    common = common.slice(0, k);
  }
  return common;
}

/**
 * Build SIDs from DP_RTE rows or STARs from STAR_RTE rows.
 * SID computer codes are "PROC#.TRANSITION" (AKUNA9.MLC); STAR codes are "TRANSITION.PROC#" (CGNEY.ANJLL4).
 */
export function parseProcedures(rows: Row[], kind: 'SID' | 'STAR'): ProcRec[] {
  const codeCol = kind === 'SID' ? 'DP_COMPUTER_CODE' : 'STAR_COMPUTER_CODE';
  type Acc = { airports: Set<string>; bodies: Map<string, [number, string][]>; trans: Map<string, [number, string][]> };
  const byName = new Map<string, Acc>();

  for (const r of rows) {
    const code = (r[codeCol] ?? '').split('.');
    const name = (kind === 'SID' ? code[0] : code[1]) ?? '';
    if (!name) continue;
    let acc = byName.get(name);
    if (!acc) {
      acc = { airports: new Set(), bodies: new Map(), trans: new Map() };
      byName.set(name, acc);
    }
    const seq = Number(r.POINT_SEQ);
    const point = r.POINT ?? '';
    if (r.ROUTE_PORTION_TYPE === 'BODY') {
      const key = `${r.ROUTE_NAME}#${r.BODY_SEQ}`;
      const list = acc.bodies.get(key) ?? [];
      list.push([seq, point]);
      acc.bodies.set(key, list);
      for (const assoc of (r.ARPT_RWY_ASSOC ?? '').split(',')) {
        const apt = assoc.trim().split('/')[0];
        if (apt) acc.airports.add(apt);
      }
    } else {
      const tcode = (r.TRANSITION_COMPUTER_CODE ?? '').split('.');
      const key = (kind === 'SID' ? tcode[1] : tcode[0]) ?? '';
      if (!key) continue;
      const list = acc.trans.get(key) ?? [];
      list.push([seq, point]);
      acc.trans.set(key, list);
    }
  }

  const ordered = (list: [number, string][]) => [...list].sort((a, b) => a[0] - b[0]).map(([, p]) => p);
  return [...byName.entries()].map(([name, acc]) => {
    const bodies = [...acc.bodies.values()].map(ordered);
    const transitions: Record<string, string[]> = {};
    for (const [key, list] of acc.trans) transitions[key] = ordered(list);
    return {
      name,
      kind,
      airports: [...acc.airports].sort(),
      body: kind === 'SID' ? commonSuffix(bodies) : commonPrefix(bodies),
      transitions,
    };
  });
}

/** Rows from PFR_RMT_FMT.csv ("remote format": full route strings). */
export function parsePrefRoutes(rows: Row[]): PrefRouteRec[] {
  return rows.map((r) => ({
    orig: r.Orig ?? '',
    dest: r.Dest ?? '',
    type: r.Type ?? '',
    route: (r['Route String'] ?? '').trim(),
  }));
}
