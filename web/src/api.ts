import type { ApiErrorBody, FlightChoice, FlightView, LiveState, NavTile, Trail } from '../../shared/types.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function getJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch {
    throw new ApiError(0, 'network', "Can't reach WebFly. Check your connection.");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, body?.error.code ?? 'http_error', body?.error.message ?? `Request failed (HTTP ${res.status}).`);
  }
  return (await res.json()) as T;
}

export type FlightResponse = FlightView | { choices: FlightChoice[] };

export const api = {
  flight: (query: string) => getJson<FlightResponse>(`/api/flight/${encodeURIComponent(query)}`),
  live: (callsign: string) => getJson<LiveState>(`/api/live/${encodeURIComponent(callsign)}`),
  trail: (hex: string, callsign: string) => getJson<Trail>(`/api/trail/${hex}?callsign=${encodeURIComponent(callsign)}`),
  tile: (cycle: string, lat: number, lon: number) => getJson<NavTile>(`/api/nav/${cycle}/${lat}/${lon}`),
};
