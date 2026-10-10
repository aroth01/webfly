import { beforeAll, describe, expect, it } from 'vitest';
import { distanceNm, distanceToSegmentNm } from '../../shared/geo.ts';
import { findLatestNavData, loadNavDb } from '../../navdata/load.ts';
import type { AirportRec, PrefRouteRec } from '../../navdata/types.ts';
import { decodeRoute, type DecodedRoute } from './decode.ts';

// Decodes every FAA preferred route in the built NASR cycle. Run `npm run navdata:build` first.
const path = findLatestNavData('data');

/** A clean route may not put a point farther than both of these from the origin-destination segment. */
const PLAUSIBLE_NM = 300;
const PLAUSIBLE_FRACTION = 0.75; // of the origin-destination distance

interface Decoded {
  route: PrefRouteRec;
  orig: AirportRec;
  dest: AirportRec;
  decoded: DecodedRoute;
}

describe.skipIf(!path)('route decoder against the FAA preferred-route corpus', () => {
  const routes: Decoded[] = [];

  beforeAll(() => {
    const db = loadNavDb(path as string);
    for (const route of db.allPrefRoutes()) {
      const orig = db.airport(route.orig);
      const dest = db.airport(route.dest);
      if (orig && dest) routes.push({ route, orig, dest, decoded: decodeRoute(route.route, db) });
    }
  });

  it('fully decodes at least 99% of routes between known airports', () => {
    const total = routes.length;
    const clean = routes.filter((r) => !r.decoded.partial).length;
    const misses = new Map<string, number>();
    for (const { decoded } of routes) {
      for (const t of [...decoded.unresolved, ...decoded.dropped]) misses.set(t, (misses.get(t) ?? 0) + 1);
    }
    const top = [...misses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    console.log(`decoded ${clean}/${total} (${((100 * clean) / total).toFixed(2)}%); top misses:`, top);
    expect(total).toBeGreaterThan(5000);
    expect(clean / total).toBeGreaterThanOrEqual(0.99);
  });

  it('keeps every fully decoded route near the line from origin to destination', () => {
    // Resolving every token is not the same as decoding it correctly: a wrong ident match can resolve cleanly.
    const implausible: string[] = [];
    for (const { route, orig, dest, decoded } of routes) {
      if (decoded.partial) continue;
      const limit = Math.max(PLAUSIBLE_NM, PLAUSIBLE_FRACTION * distanceNm(orig, dest));
      for (const p of decoded.points) {
        const off = distanceToSegmentNm(p, orig, dest);
        if (off > limit) implausible.push(`${route.route}: ${p.ident} ${off.toFixed(0)} nm off`);
      }
    }
    if (implausible.length > 0) console.log('implausible clean routes:', implausible);
    expect(implausible).toEqual([]);
  });
});
