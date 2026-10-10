import { describe, expect, it } from 'vitest';
import type { NavTile } from '../../../shared/types.ts';
import { TileCache, tilesForCircle } from './tiles.ts';

describe('tilesForCircle', () => {
  it('covers the circle with 2° tiles', () => {
    expect(tilesForCircle({ lat: 33, lon: -97 }, 40)).toEqual([[32, -98]]);
    expect(tilesForCircle({ lat: 33, lon: -96.5 }, 40)).toEqual([
      [32, -98],
      [32, -96],
    ]);
    expect(tilesForCircle({ lat: 33, lon: -97 }, 80)).toHaveLength(9);
  });

  it('wraps across the antimeridian', () => {
    const lons = new Set(tilesForCircle({ lat: 0, lon: 179.5 }, 60).map(([, lo]) => lo));
    expect([...lons].sort((a, b) => a - b)).toEqual([-180, 178]);
  });
});

describe('TileCache', () => {
  const tile = (cycle: string): NavTile => ({ cycle, navaids: [], airports: [] });

  it('loads each missing tile once, notifies, and evicts the least recently used', async () => {
    const requests: string[] = [];
    const cache = new TileCache(async (cycle, lat, lon) => {
      requests.push(`${cycle}:${lat},${lon}`);
      return tile(cycle);
    }, 2);
    let updates = 0;
    cache.onUpdate = () => updates++;
    expect(cache.get('2610', [[30, -100], [32, -100]])).toEqual([]);
    expect(cache.get('2610', [[30, -100]])).toEqual([]);
    await Promise.resolve();
    expect(requests).toEqual(['2610:30,-100', '2610:32,-100']);
    expect(updates).toBe(2);
    expect(cache.get('2610', [[30, -100], [32, -100]])).toHaveLength(2);
    cache.get('2610', [[34, -100]]);
    await Promise.resolve();
    expect(cache.get('2610', [[30, -100], [32, -100], [34, -100]])).toHaveLength(2);
  });

  it('drops everything when the nav cycle changes', async () => {
    const cache = new TileCache(async (cycle) => tile(cycle));
    cache.get('2610', [[30, -100]]);
    await Promise.resolve();
    expect(cache.get('2611', [[30, -100]])).toEqual([]);
  });
});
