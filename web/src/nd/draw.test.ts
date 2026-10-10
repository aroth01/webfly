import { describe, expect, it } from 'vitest';
import { FIXTURE_FLIGHT, FIXTURE_LIVE, FIXTURE_TRAIL, fixtureTile } from '../fixtures.ts';
import { drawNd, legPoints, ndLayout } from './draw.ts';
import { buildScene } from './scene.ts';

/** A canvas context that accepts any call and records the text drawn. */
function fakeCtx() {
  const texts: string[] = [];
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(t, k: string) {
      if (k === 'fillText') return (s: string) => void texts.push(s);
      if (k in t) return t[k];
      return () => undefined;
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}

const pos = { lat: 32.34, lon: -100.7, track: 262, gs: 452, ageSec: 1, frozen: false };
const base = { flight: FIXTURE_FLIGHT, live: FIXTURE_LIVE, pos, varEast: 5, rangeNm: 80, prevLegIdx: 0, nowMs: Date.now(), tiles: [fixtureTile({ lat0: 32, lon0: -102 })], trail: FIXTURE_TRAIL };

describe('drawNd', () => {
  it('draws the fixture with data blocks and route idents', () => {
    const { ctx, texts } = fakeCtx();
    drawNd(ctx, 390, 700, buildScene(base));
    expect(texts).toEqual(expect.arrayContaining(['GS', 'TAS', '452', '478', 'SPUDS', 'HDG']));
  });
  it('shows dashes instead of NaN for missing data', () => {
    const { ctx, texts } = fakeCtx();
    const live = { ...FIXTURE_LIVE, aircraft: { ...FIXTURE_LIVE.aircraft!, gs: undefined, tas: undefined, windDir: undefined, windSpd: undefined, trueHeading: undefined, track: undefined } };
    drawNd(ctx, 390, 700, buildScene({ ...base, live, pos: { ...pos, track: undefined, gs: undefined } }));
    expect(texts.join(' ')).not.toMatch(/NaN|undefined/);
    expect(texts).toContain('---/--');
  });
  it('shows NO POSITION and NO FILED ROUTE, and survives no centre at all', () => {
    const none = { ...FIXTURE_FLIGHT, route: { source: 'none' as const, points: [], partial: false } };
    const a = fakeCtx();
    drawNd(a.ctx, 390, 700, buildScene({ ...base, flight: none, pos: null, live: { t: 0, aircraft: null, traffic: [] } }));
    expect(a.texts).toEqual(expect.arrayContaining(['NO POSITION', 'NO FILED ROUTE']));
    const { origin: _o, dest: _d, ...bare } = none;
    const b = fakeCtx();
    drawNd(b.ctx, 390, 700, buildScene({ ...base, flight: bare, pos: null, live: null }));
    expect(b.texts).toContain('NO POSITION');
  });
  it('flags a stale position', () => {
    const { ctx, texts } = fakeCtx();
    drawNd(ctx, 390, 700, buildScene({ ...base, pos: { ...pos, ageSec: 42 } }));
    expect(texts).toContain('POS 42S OLD');
  });
});

describe('legPoints and layout', () => {
  it('subdivides long legs and leaves zero-length legs alone', () => {
    expect(legPoints({ lat: 0, lon: 0 }, { lat: 0, lon: 0 })).toHaveLength(2);
    const pts = legPoints({ lat: 30, lon: -100 }, { lat: 30, lon: -90 });
    expect(pts.length).toBeGreaterThan(20);
    expect(pts.length).toBeLessThanOrEqual(81);
  });
  it('keeps the arc inside narrow and wide canvases', () => {
    for (const [w, h] of [[320, 500], [390, 700], [800, 360]] as const) {
      const L = ndLayout(w, h);
      expect(L.cx - L.radius * Math.sin((50 * Math.PI) / 180)).toBeGreaterThanOrEqual(0);
      expect(L.cy - L.radius).toBeGreaterThan(0);
    }
  });
});
