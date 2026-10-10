/** SW corner of a 2 x 2 degree nav tile; both are even integers. */
export interface TileId {
  lat0: number;
  lon0: number;
}

export const tileKey = (t: TileId): string => `${t.lat0},${t.lon0}`;

const wrapLon = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;

/**
 * The tiles covering the circle of `rangeNm` around a point (its bounding box, so a few corner tiles are not
 * strictly needed). Longitude wraps across the antimeridian; latitude is clamped to the world grid.
 */
export function tilesFor(lat: number, lon: number, rangeNm: number): TileId[] {
  const dLat = rangeNm / 60;
  const south = Math.max(-90, lat - dLat);
  const north = Math.min(90, lat + dLat);
  // Longitude degrees shrink toward the poles: size the span for the highest-latitude edge of the box.
  const cos = Math.cos((Math.max(Math.abs(south), Math.abs(north)) * Math.PI) / 180);
  const dLon = cos < 0.05 ? 180 : Math.min(180, dLat / cos);

  const latIdx0 = Math.floor(south / 2);
  const latIdx1 = Math.floor(north / 2);
  const lonIdx0 = Math.floor((lon - dLon) / 2);
  const lonIdx1 = Math.floor((lon + dLon) / 2);
  const seen = new Set<string>();
  const out: TileId[] = [];
  for (let la = latIdx0; la <= latIdx1; la++) {
    const lat0 = Math.max(-90, Math.min(88, la * 2));
    for (let lo = lonIdx0; lo <= lonIdx1; lo++) {
      const t = { lat0, lon0: wrapLon(lo * 2) };
      const k = tileKey(t);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(t);
      }
    }
  }
  return out;
}

/** Least-recently-used cache. */
export class Lru<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly max: number) {}

  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as K);
  }

  get size(): number {
    return this.map.size;
  }
}
