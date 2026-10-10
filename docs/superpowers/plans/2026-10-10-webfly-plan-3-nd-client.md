# WebFly Plan 3 — ND Client Implementation Plan

**Goal:** A Vite + React single-page app that turns a flight number into a live Airbus-style Navigation Display in ARC mode on a phone, drawing everything the Plan 2 API returns: the decoded route, the TO waypoint, navaids and airports, traffic, the flown trail and the data blocks, all moving smoothly between 5 s position updates.

**Architecture:** `web/` is a Vite root with its own `tsconfig.json` (DOM + JSX). React owns the screens (input, pick list, flight) and the HTML chrome (range buttons, flight strip). The ND itself is one `<canvas>` drawn on `requestAnimationFrame` by plain TypeScript modules in `web/src/nd/`. Those modules are deliberately React-free and mostly pure: geometry (`layout`, `projection`), motion (`motion`), navigation logic (`toWaypoint`, `tiles`, `range`), formatting, then a single `drawNd(ctx, layout, scene)` that turns a `Scene` into pixels. The pure parts are unit-tested with Vitest; the drawing is covered by Playwright screenshots. `shared/geo.ts` and `shared/types.ts` are imported by both sides.

**Tech stack additions:** `vite` 8, `react`/`react-dom` 19, `@vitejs/plugin-react` 6, `geomagnetism` 0.2 (bundles WMM2025), `@fontsource/b612` + `@fontsource/b612-mono` (SIL OFL, self-hosted so screenshots don't depend on the network), `@playwright/test` (driving the pre-installed Chromium when `PLAYWRIGHT_CHROMIUM_EXECUTABLE` is set).

**Spec:** §9 (all), §10 client rows, §11 ND visual regression.

## Interpretations (spec gaps, decided here)

1. **ARC geometry.** The ND radius `R` is the largest that fits both a ~100° arc across the width (`R·sin 50° ≤ W/2 − margin`) and the height (top data blocks + `R` + space below the aircraft). The aircraft sits at the arc centre, which lands at ~80% of the ND height. The outer arc is the selected range.
2. **Rotation.** Features are projected with true bearings relative to the aircraft's *true* track (or true heading in HDG mode), so magnetic variation only labels the compass and the displayed numbers (TRK/HDG, TO bearing, wind). The compass rose is rotated by the same reference, so labels stay correct.
3. **Passed legs are hidden.** The green line starts at the active leg's FROM point, like an FMS that sequences waypoints; the trail shows where the aircraft has been. With no position the whole route is drawn.
4. **TO waypoint search window:** forward from the previous active leg, at most 8 legs ahead, so a route that doubles back can't steal the active leg.
5. **Declutter by range** (the real ND uses pilot-selected filters): ≤ 40 nm shows every navaid and every tile airport (runway ≥ 4,000 ft) with idents; 80 nm hides NDBs and airports under 7,000 ft; 160 nm keeps VOR-family navaids and airports of 9,000 ft or more, without airport idents; 320 nm shows VOR-family navaids without idents. Route waypoints always win over DB symbols with the same ident, and database idents that would overlap a label already drawn are left out. Tiles therefore carry each airport's `rwyFt` (an additive field on spec §8's `NavTile`).
6. **Wind** is shown magnetic, with the arrow pointing where the wind blows *to*, rotated with the display. ETA is UTC `HH:MM`, as on the flight deck. GS below 50 kt shows ETA `---`.
7. **Long legs are densified** for drawing only (every ~25 nm along the great circle), because the azimuthal projection curves great circles that don't pass the aircraft.
8. **Trail** = `/api/trail` fetched once per flight, then extended with each new live position that is newer and has moved more than 0.1 nm.
9. **Range** buttons, pinch and mouse wheel step through 10–320 nm. The default (80 nm, or 40 nm below 10,000 ft) is chosen once, at the first position, and never overrides the user afterwards.
10. **No position:** the ND centres on the origin airport (else the first route point), north-up, with an amber `NO POSITION` flag.
11. **Rate limiting:** a 429 on `/api/live` switches polling to 15 s for one minute (spec §10). `/api/nav` 404 `stale_cycle` re-fetches the flight to learn the new cycle.
12. **Compass labels** are tens of degrees without a leading zero (`3`, `27`), as on the Airbus rose; spec §9.3's "2-digit" example (`27`) reads the same.
13. **Simulated live data for development:** `npm run dev:server -- --sim` flies the seeded active flights along their decoded routes at their filed ETAs and adds synthetic traffic, so the ND can be tried without a real aircraft aloft. Production never uses it.

## File structure

| File | Responsibility |
|---|---|
| `shared/geo.ts` | + `alongTrackNm`, `interpolateGc` |
| `web/index.html`, `web/vite.config.ts`, `web/tsconfig.json` | Vite root; `/api` proxied to `:8080` in dev |
| `web/src/main.tsx`, `App.tsx`, `router.ts` | Entry, history-API routing (`/`, `/f/:query`) |
| `web/src/api.ts` | Typed fetch wrappers and `ApiError` |
| `web/src/recent.ts` | Recent searches in `localStorage` (try/catch, works without storage) |
| `web/src/query.ts` | Client-side input validation (same regex as the server) |
| `web/src/screens/InputScreen.tsx`, `PickList.tsx`, `FlightScreen.tsx`, `FlightStrip.tsx` | Screens and HTML chrome |
| `web/src/hooks/useFlight.ts`, `useLive.ts`, `useVisible.ts` | Polling paused while hidden; 429 back-off |
| `web/src/nd/layout.ts` | ND geometry from canvas size |
| `web/src/nd/projection.ts` | Geo → screen |
| `web/src/nd/motion.ts` | Dead reckoning, 1 s error blend, rotation easing |
| `web/src/nd/magvar.ts` | WMM2025 variation, recomputed after 10 nm |
| `web/src/nd/toWaypoint.ts` | Active leg, TO waypoint, distance remaining, ETA |
| `web/src/nd/tiles.ts` | Tile keys for a circle; 64-tile LRU with in-flight dedupe |
| `web/src/nd/range.ts`, `format.ts`, `declutter.ts` | Range steps, number formatting, declutter table |
| `web/src/nd/scene.ts` | Builds a `Scene` from flight, live, trail, tiles and motion state |
| `web/src/nd/draw.ts`, `symbols.ts` | Canvas drawing |
| `web/src/nd/NdView.tsx` | Canvas element, rAF loop, resize, pinch/wheel, range buttons |
| `web/e2e/nd.spec.ts`, `web/e2e/fixtures/`, `web/playwright.config.ts` | Visual regression at 390×844 with a frozen clock |
| `server/live/sim.ts` | `SimAdsbSource` for `--sim` |

## Tasks

- [x] **Task 1 — Scaffold and geo additions.** Vite root builds; `npm run typecheck` checks server and web. Tests: `alongTrackNm` (signed, matches distance on the track), `interpolateGc` endpoints and midpoint.
- [x] **Task 2 — ND math.** Tests: layout keeps a ~100° arc inside a 390 px width and puts the aircraft near 80% height; projection (a point dead ahead at full range lands on the arc top, 90° right lands right of centre, culling beyond 1.1× range); range steps and default; tile keys for a circle; LRU eviction; magvar against WMM2025 test values; formatting (`---`, `FL350`, UTC ETA, wind).
- [x] **Task 3 — Motion and TO waypoint.** Tests: dead reckoning along track at GS; a new fix blends the error to zero over 1 s; dead reckoning stops at 60 s; rotation eases with a 0.5 s time constant along the shortest path; active leg advances, never goes back, ignores far legs; distance remaining and ETA.
- [x] **Task 4 — Renderer.** `scene.ts` + `draw.ts` + `symbols.ts`: compass arc, lubber line, track diamond, range arcs, route with densified legs, waypoint stars, TO waypoint, origin/destination, DB navaids and airports with declutter, traffic diamonds with relative altitude and trend arrows, trail, own aircraft, data blocks, `POS nnS OLD`, `NO POSITION`. Tests for `scene.ts` decisions (passed legs hidden, route idents beat DB symbols, proximate traffic).
- [x] **Task 5 — Screens and data hooks.** Input with inline validation and recent searches; pick list; flight screen with polling (live 5 s, flight 2 min, both paused while hidden, 429 → 15 s for 60 s), trail accumulation, tiles, error messages from spec §10, the flight strip and route badge, the `swim_delayed` banner, portrait and landscape layouts.
- [x] **Task 6 — Simulated live data.** `SimAdsbSource` and `--sim`. Tests: the simulated aircraft is on the decoded route at the expected distance flown, and traffic surrounds it.
- [x] **Task 7 — Visual regression.** Playwright at 390×844 with fixture `FlightView`/`LiveState`/trail/tiles (generated by `scripts/make-e2e-fixtures.ts` from the real NASR cycle and the sim) and a paused clock that only advances through `clock.runFor`, so every run renders the same frame: input screen, pick list, ND at 80 nm, ND at 20 nm, stale position, no position, landscape; plus malformed-input and not-found behaviour. Baselines committed under `web/e2e/__screenshots__/linux/`.

## Acceptance

    npm test && npm run typecheck
    npm run dev:server -- --sim     # terminal 1
    npm run dev:web                 # terminal 2 → http://<host>:5173, type AA558
    npm run test:visual             # screenshots match the committed baselines
