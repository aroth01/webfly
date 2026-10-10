import airlineList from './airlines.json' with { type: 'json' };

export interface Airline {
  iata: string;
  icao: string;
  name: string;
  regionals?: string[];
}

const airlines = airlineList as Airline[];
const byIata = new Map(airlines.map((a) => [a.iata, a]));
const byIcao = new Map(airlines.map((a) => [a.icao, a]));

export type Normalized =
  | { ok: true; airline: string; number: string } // airline is an ICAO code
  | { ok: false; code: 'bad_query' | 'unknown_airline' };

const QUERY_RE = /^([A-Z]{3}|[A-Z0-9]{2})(\d{1,4})$/;

/** "aa 0558" -> { airline: "AAL", number: "558" }. A 3-letter code is taken as an ICAO designator as given. */
export function normalizeQuery(input: string): Normalized {
  const q = input.toUpperCase().replace(/\s+/g, '');
  const m = QUERY_RE.exec(q);
  if (!m || !/[A-Z]/.test(m[1])) return { ok: false, code: 'bad_query' };
  const number = String(Number(m[2]));
  if (number === '0') return { ok: false, code: 'bad_query' };
  const code = m[1];
  if (code.length === 3) return { ok: true, airline: code, number };
  const a = byIata.get(code);
  return a ? { ok: true, airline: a.icao, number } : { ok: false, code: 'unknown_airline' };
}

/** Mainline callsign first, then the brand's regional operators ("AAL558", "ENY558", ...). */
export function candidateCallsigns(airlineIcao: string, number: string): string[] {
  const regionals = byIcao.get(airlineIcao)?.regionals ?? [];
  return [...new Set([airlineIcao, ...regionals])].map((c) => `${c}${number}`);
}

export function operatorName(callsign: string): string | undefined {
  return byIcao.get(callsign.slice(0, 3))?.name;
}
