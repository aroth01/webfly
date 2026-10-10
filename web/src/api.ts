import type { FlightChoice, FlightView, LiveState, NavTile, Trail } from '../../shared/types.ts';
import type { TileId } from './nd/tiles.ts';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string };

/** GET a JSON endpoint, mapping every failure (HTTP error body, bad JSON, network) to the same shape. */
export async function getJson<T>(path: string, fetchFn: typeof fetch = fetch, signal?: AbortSignal): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetchFn(path, signal ? { signal } : undefined);
  } catch {
    return { ok: false, status: 0, code: 'network', message: 'Network error. Check your connection.' };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  if (res.ok) return { ok: true, data: body as T };
  const err = (body as { error?: { code?: string; message?: string } } | undefined)?.error;
  if (res.status === 429) return { ok: false, status: 429, code: 'rate_limited', message: err?.message ?? 'Too many requests.' };
  return { ok: false, status: res.status, code: err?.code ?? 'http_error', message: err?.message ?? `Request failed (${res.status}).` };
}

export type FlightResponse = FlightView | { choices: FlightChoice[] };
export const isChoices = (r: FlightResponse): r is { choices: FlightChoice[] } => 'choices' in r;

export const fetchFlight = (query: string, signal?: AbortSignal) => getJson<FlightResponse>(`/api/flight/${encodeURIComponent(query)}`, fetch, signal);
export const fetchLive = (callsign: string, signal?: AbortSignal) => getJson<LiveState>(`/api/live/${encodeURIComponent(callsign)}`, fetch, signal);
export const fetchTrail = (hex: string, callsign: string, signal?: AbortSignal) =>
  getJson<Trail>(`/api/trail/${encodeURIComponent(hex)}?callsign=${encodeURIComponent(callsign)}`, fetch, signal);
export const fetchTile = (cycle: string, t: TileId, signal?: AbortSignal) => getJson<NavTile>(`/api/nav/${cycle}/${t.lat0}/${t.lon0}`, fetch, signal);
