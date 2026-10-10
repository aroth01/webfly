import { readFileSync } from 'node:fs';

export interface Airline {
  iata?: string;
  icao: string;
  name: string;
  regionals?: string[]; // ICAO codes of operators flying this brand's numbers under their own callsign
}

export class AirlineDb {
  private readonly byIataCode = new Map<string, Airline>();
  private readonly byIcaoCode = new Map<string, Airline>();

  constructor(list: Airline[]) {
    for (const a of list) {
      if (a.iata) this.byIataCode.set(a.iata, a);
      this.byIcaoCode.set(a.icao, a);
    }
  }

  byIata(code: string): Airline | undefined {
    return this.byIataCode.get(code);
  }

  byIcao(code: string): Airline | undefined {
    return this.byIcaoCode.get(code);
  }

  /** Operator name from a callsign's ICAO prefix ("ENY3456" → "Envoy Air"). */
  operatorOf(callsign: string): string | undefined {
    const prefix = /^[A-Z]{3}/.exec(callsign)?.[0];
    return prefix ? this.byIcaoCode.get(prefix)?.name : undefined;
  }
}

export function loadAirlines(): AirlineDb {
  const file = JSON.parse(readFileSync(new URL('./airlines.json', import.meta.url), 'utf8')) as { airlines: Airline[] };
  return new AirlineDb(file.airlines);
}
