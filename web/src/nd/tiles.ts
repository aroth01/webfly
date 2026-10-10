import type { LatLon } from '../../../shared/geo.ts';
import type { NavTile } from '../../../shared/types.ts';

const TILE = 2;
const floorTile = (x: number) => Math.floor(x / TILE) * TILE;

/** South-west corners of the 2° tiles that intersect a circle of `radiusNm` around `c`. */
export function tilesForCircle(c: LatLon, radiusNm: number): Array<[number, number]> {
  const dLat = radiusNm / 60;
  const latMin = Math.max(-90, c.lat - dLat);
  const latMax = Math.min(89.999, c.lat + dLat);
  const maxAbsLat = Math.min(89, Math.max(Math.abs(latMin), Math.abs(latMax)));
  const dLon = radiusNm / (60 * Math.cos((maxAbsLat * Math.PI) / 180));
  const lons: number[] = [];
  if (dLon >= 180) {
    for (let lo = -180; lo < 180; lo += TILE) lons.push(lo);
  } else {
    for (let lo = floorTile(c.lon - dLon); lo <= floorTile(c.lon + dLon); lo += TILE) {
      const wrapped = ((((lo + 180) % 360) + 360) % 360) - 180;
      if (!lons.includes(wrapped)) lons.push(wrapped);
    }
  }
  const out: Array<[number, number]> = [];
  for (let la = floorTile(latMin); la <= Math.min(88, floorTile(latMax)); la += TILE) {
    for (const lo of lons) out.push([la, lo]);
  }
  return out;
}

export type FetchTile = (cycle: string, lat: number, lon: number) => Promise<NavTile>;

/** Up to `max` tiles of one nav cycle, least recently used evicted first; one request per missing tile. */
export class TileCache {
  private readonly tiles = new Map<string, NavTile>();
  private readonly pending = new Set<string>();
  private readonly fetchTile: FetchTile;
  private readonly max: number;
  private cycle = '';
  onUpdate: () => void = () => {};
  onError: (err: unknown) => void = () => {};

  constructor(fetchTile: FetchTile, max = 64) {
    this.fetchTile = fetchTile;
    this.max = max;
  }

  /** Tiles for these corners that are loaded; starts loading the rest. */
  get(cycle: string, corners: Array<[number, number]>): NavTile[] {
    if (cycle !== this.cycle) {
      this.cycle = cycle;
      this.tiles.clear();
      this.pending.clear();
    }
    const out: NavTile[] = [];
    for (const [lat, lon] of corners) {
      const key = `${lat},${lon}`;
      const tile = this.tiles.get(key);
      if (tile) {
        this.tiles.delete(key);
        this.tiles.set(key, tile);
        out.push(tile);
      } else if (!this.pending.has(key)) {
        this.load(cycle, key, lat, lon);
      }
    }
    return out;
  }

  private load(cycle: string, key: string, lat: number, lon: number): void {
    this.pending.add(key);
    this.fetchTile(cycle, lat, lon).then(
      (tile) => {
        if (cycle !== this.cycle || !this.pending.delete(key)) return;
        this.tiles.set(key, tile);
        while (this.tiles.size > this.max) this.tiles.delete(this.tiles.keys().next().value as string);
        this.onUpdate();
      },
      (err) => {
        this.pending.delete(key);
        this.onError(err);
      },
    );
  }
}
