export interface Declutter {
  navaidTypes: ReadonlySet<string>;
  navaidIdents: boolean;
  airports: boolean;
  airportIdents: boolean;
}

const VOR_FAMILY = ['VOR', 'VOR/DME', 'VORTAC', 'TACAN'];
const ALL = [...VOR_FAMILY, 'DME', 'NDB', 'NDB/DME'];

/** What the ND shows at each range; the real ND leaves this to pilot-selected filters. */
export function declutterFor(rangeNm: number): Declutter {
  if (rangeNm <= 40) return { navaidTypes: new Set(ALL), navaidIdents: true, airports: true, airportIdents: true };
  if (rangeNm <= 80) return { navaidTypes: new Set([...VOR_FAMILY, 'DME']), navaidIdents: true, airports: true, airportIdents: true };
  if (rangeNm <= 160) return { navaidTypes: new Set(VOR_FAMILY), navaidIdents: true, airports: true, airportIdents: false };
  return { navaidTypes: new Set(VOR_FAMILY), navaidIdents: false, airports: false, airportIdents: false };
}
