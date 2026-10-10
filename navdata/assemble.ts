import { readCsv } from './csv.ts';
import { parseAirports, parseAirways, parseFixes, parseNavaids, parsePrefRoutes, parseProcedures } from './parse.ts';
import type { NavDataFile } from './types.ts';

/** NASR CSV categories to download, and the files used from each zip. */
export const NASR_FILES = {
  APT: ['APT_BASE.csv', 'APT_RWY.csv'],
  NAV: ['NAV_BASE.csv'],
  FIX: ['FIX_BASE.csv'],
  AWY: ['AWY_BASE.csv'],
  DP: ['DP_RTE.csv'],
  STAR: ['STAR_RTE.csv'],
  PFR: ['PFR_RMT_FMT.csv'],
} as const;

/** Turn the raw CSV texts (keyed by file name) into one NavDataFile. */
export function assembleNavData(cycle: string, csv: Record<string, string>): NavDataFile {
  const rows = (name: string) => {
    const text = csv[name];
    if (text === undefined) throw new Error(`missing NASR file ${name}`);
    return readCsv(text);
  };
  return {
    cycle,
    airports: parseAirports(rows('APT_BASE.csv'), rows('APT_RWY.csv')),
    navaids: parseNavaids(rows('NAV_BASE.csv')),
    fixes: parseFixes(rows('FIX_BASE.csv')),
    airways: parseAirways(rows('AWY_BASE.csv')),
    procs: [...parseProcedures(rows('DP_RTE.csv'), 'SID'), ...parseProcedures(rows('STAR_RTE.csv'), 'STAR')],
    prefRoutes: parsePrefRoutes(rows('PFR_RMT_FMT.csv')),
  };
}
