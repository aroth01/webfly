import { describe, expect, it } from 'vitest';
import { findLatestNavData, loadNavDb } from '../../navdata/load.ts';
import { decodeRoute } from './decode.ts';

// Decodes every FAA preferred route in the built NASR cycle. Run `npm run navdata:build` first.
const path = findLatestNavData('data');

describe.skipIf(!path)('route decoder against the FAA preferred-route corpus', () => {
  it('fully decodes at least 99% of routes between known airports', () => {
    const db = loadNavDb(path as string);
    let total = 0;
    let clean = 0;
    const misses = new Map<string, number>();
    for (const r of db.allPrefRoutes()) {
      if (!db.airport(r.orig) || !db.airport(r.dest)) continue;
      total++;
      const d = decodeRoute(r.route, db);
      if (!d.partial) clean++;
      for (const t of [...d.unresolved, ...d.dropped]) misses.set(t, (misses.get(t) ?? 0) + 1);
    }
    const top = [...misses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    console.log(`decoded ${clean}/${total} (${((100 * clean) / total).toFixed(2)}%); top misses:`, top);
    expect(total).toBeGreaterThan(5000);
    expect(clean / total).toBeGreaterThanOrEqual(0.99);
  });
});
