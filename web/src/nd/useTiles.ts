import { useEffect, useRef, useState } from 'react';
import type { NavTile } from '../../../shared/types.ts';
import type { DataSource } from '../source.ts';
import { Lru, tileKey, tilesFor, type TileId } from './tiles.ts';

const MAX_TILES = 64;

/**
 * Keeps the nav tiles around the aircraft loaded (LRU of 64). `get` returns whichever of the tiles covering
 * the range circle are already in memory; missing ones are fetched in the background and picked up next frame.
 */
export function useTiles(source: DataSource, cycle: string | undefined) {
  const cache = useRef(new Lru<string, NavTile>(MAX_TILES));
  const pending = useRef(new Set<string>());
  const [, bump] = useState(0);

  // A new nav cycle invalidates everything.
  useEffect(() => {
    cache.current = new Lru(MAX_TILES);
    pending.current.clear();
  }, [cycle, source]);

  const ensure = (lat: number, lon: number, rangeNm: number): void => {
    if (!cycle) return;
    for (const t of tilesFor(lat, lon, rangeNm)) {
      const key = tileKey(t);
      if (cache.current.has(key) || pending.current.has(key)) continue;
      pending.current.add(key);
      void load(t, key);
    }
  };

  const load = async (t: TileId, key: string) => {
    const store = cache.current;
    const r = await source.tile(cycle as string, t);
    pending.current.delete(key);
    if (r.ok && store === cache.current) {
      store.set(key, r.data);
      bump((n) => n + 1);
    }
  };

  const get = (lat: number, lon: number, rangeNm: number): NavTile[] => {
    const out: NavTile[] = [];
    for (const t of tilesFor(lat, lon, rangeNm)) {
      const tile = cache.current.get(tileKey(t));
      if (tile) out.push(tile);
    }
    return out;
  };

  return { ensure, get };
}
