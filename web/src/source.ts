import type { LiveState, NavTile, Trail } from '../../shared/types.ts';
import { fetchFlight, fetchLive, fetchTile, fetchTrail, type ApiResult, type FlightResponse } from './api.ts';
import type { TileId } from './nd/tiles.ts';

/** Where the ND gets its data. The real source calls the API; fixtures return canned data (`?fixture=1`). */
export interface DataSource {
  flight(query: string, signal?: AbortSignal): Promise<ApiResult<FlightResponse>>;
  live(callsign: string, signal?: AbortSignal): Promise<ApiResult<LiveState>>;
  trail(hex: string, callsign: string, signal?: AbortSignal): Promise<ApiResult<Trail>>;
  tile(cycle: string, tile: TileId, signal?: AbortSignal): Promise<ApiResult<NavTile>>;
}

export const apiSource: DataSource = { flight: fetchFlight, live: fetchLive, trail: fetchTrail, tile: fetchTile };
