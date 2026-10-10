# WebFly Plan 3: ND Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Vite + React SPA in `web/`: input screen → (pick list) → live ARC-mode Airbus ND drawn on Canvas 2D against the Plan 2 API.

**Architecture:** All geometry and state logic lives in small pure modules under `web/src/nd/` (projection, interpolation, active leg, magnetic variation, tiles) with Vitest tests; `draw.ts` turns that state into canvas calls; React only owns screens, polling and the animation loop. A `?fixture=1` mode feeds canned `FlightView`/`LiveState` so the ND can be developed and screenshot without the API.

**Tech Stack:** Vite, React 19, TypeScript, Canvas 2D, `geomagnetism` (WMM), `@fontsource/b612` + `@fontsource/b612-mono`.

**Spec:** `docs/superpowers/specs/2026-10-10-webfly-nd-tracker-design.md` (§9, §10 client rows, §11 ND tests)

## Global Constraints

- Colors/symbology per spec §9.3 (black bg, yellow ownship, green route, white TO waypoint, magenta DB navaids/airports, cyan range labels, dim grey `#666` trail, white traffic).
- Ranges 10, 20, 40, 80, 160, 320 nm; default 80 (40 when below 10,000 ft).
- Polling: `/api/live` every 5 s, `/api/flight` every 2 min, both paused while `document.hidden`; `/api/trail` once per flight load; after a 429, back off to 15 s polling for one minute.
- Stale position: amber `POS nnS OLD` when > 30 s old; dead-reckon ≤ 60 s then freeze.
- `localStorage` access always in try/catch.
- Nav tiles: 2°×2° cells, fetch those intersecting the range circle, LRU of 64.
- Carried from Plan 1: `crossTrackNm` must be guarded for zero-length legs; add antimeridian and southern-hemisphere geo tests.

## Review Focus

- Zero-length leg (a == b) or a single-point route: no NaN, no crash, TO waypoint still sensible.
- Aircraft near the antimeridian or in the southern hemisphere: projection and tile selection stay correct.
- `/api/live` returns `aircraft: null`: ND centers on the origin airport, north-up, `NO POSITION`.
- Missing `gs`/`track`/`trueHeading`: data blocks show `---`, no NaN on the canvas.
- Route `source: 'none'` or `partial`: badge text is right and the ND still draws.
- localStorage unavailable (private mode): input screen still works.

---

### Task 1: Geo hardening + pure ND logic

**Files:** Modify `shared/geo.ts`, `shared/geo.test.ts`; Create `web/src/nd/{ranges,projection,activeLeg,interpolate,magvar,tiles}.ts` with `*.test.ts` alongside.

**Interfaces (produced):**
- `crossTrackNm` returns distance to `a` when a == b; add `alongTrackNm(p, a, b)`.
- `RANGES`, `defaultRange(altFt?)`, `stepRange(r, dir)`.
- `project(own, refDeg, rangeNm, geom, feature): {x, y} | null` with `geom = {cx, cy, radius}`; ownship at (cx, cy), up = refDeg.
- `activeLeg(points, pos, prevIdx): {idx, toIdx, remainingNm}`; `etaMs(remainingNm, gsKt, nowMs)`.
- `class PositionTracker { push(fix, nowMs); at(nowMs): {lat, lon, track, ageSec, frozen} }`; `easeAngle(cur, target, dtMs, tauMs)`.
- `magVariation(lat, lon, date)`: east-positive degrees, cached until 10 nm moved.
- `tilesFor(lat, lon, rangeNm): Array<{lat0, lon0}>`; `class Lru<K,V>`.

- [ ] Tests first for each (zero-length leg, antimeridian, southern hemisphere, WMM sanity values, tile coverage at 179°E, LRU eviction), watch fail, implement, pass, commit.

### Task 2: API client, fixtures, screens

**Files:** Create `web/index.html`, `web/vite.config.ts`, `web/src/{main,App,api,recent,fixtures}.ts(x)`, `web/src/screens/{InputScreen,PickList}.tsx`.

- [ ] Vite config (proxy `/api` → `localhost:8787`, build to `dist/web`), routing with the History API (`/`, `/f/:query`), input normalization message under the input, recents via try/catch localStorage, pick list from `choices`. Tests for `api.ts` error mapping and `recent.ts` with throwing storage. Commit.

### Task 3: ND renderer and NdScreen

**Files:** Create `web/src/nd/draw.ts`, `web/src/screens/NdScreen.tsx`, `web/src/nd/useNd.ts`.

- [ ] Draw arc, ticks, labels, range arcs, route, TO waypoint, navaids/airports, traffic, trail, ownship, data blocks (GS/TAS/wind/TO/ETA), badges (FILED/EXPECTED/PARTIAL/NONE, stale, no position, swim banner). Polling hook with visibility pause and 429 backoff, rAF loop only while visible, range buttons + pinch, nav tile fetching. Verify visually from the fixture and the live API with a browser screenshot. Commit.

### Task 4: Wire-up and verification

- [ ] `npm run dev:web`, `npm run build:web`; full `npm test`, `typecheck`; screenshot at 390×844; update roadmap. (Playwright baseline snapshots are deferred to Plan 5's CI work: they need a pinned browser image.)
