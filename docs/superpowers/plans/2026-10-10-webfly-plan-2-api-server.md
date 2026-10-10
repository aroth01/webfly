# WebFly Plan 2 — API Server Implementation Plan

**Goal:** A Hono API server that turns a typed flight number into a `FlightView` (filed route decoded by Plan 1), serves live position and traffic from adsb.lol, the flown trail, immutable nav tiles and a health report — testable without the network and without SWIM.

**Architecture:** `server/store/` wraps a `node:sqlite` database with the spec §6.2 `flights` table. `server/live/` is an adsb.lol client behind an `AdsbSource` interface, plus a `LiveService` with shared TTL caches that serve stale values with their true age when upstream fails. `server/resolve/` normalizes the query, maps airlines, ranks stored plans and falls back to adsb.lol + preferred routes. `server/api/` is a thin Hono app built from injected dependencies, so tests run against a seeded in-memory store and a fake adsb source. `server/main.ts` wires the real pieces.

**Tech stack additions:** `hono` 4.13, `@hono/node-server` 2.1, built-in `node:sqlite` (no native module to compile; works under Vitest and `tsc`).

**Spec:** §5.1 (`server/resolve`, `server/live`, `server/api`), §6.2 schema, §6.4, §6.5, §7, §8, §10 (server rows), §11 (API integration).

## Interpretations (spec gaps, decided here)

1. **`navCycle` is the AIRAC ident** (`"2610"`), as in the spec's `FlightView` example. `airacIdent("2026-10-01") === "2610"` (the 10th 28-day cycle effective in 2026). The nav tile URL uses the same ident: `/api/nav/2610/32/-98`. A request for any other cycle gets 404 `stale_cycle`, never another cycle's data under an immutable URL.
2. **Filed flights that are late** still count: rank 2 accepts ETDs from 3 h ago to 12 h ahead, nearest to now first.
3. **"Equally ranked"** means the best non-empty rank holds rows for more than one callsign. Rows for one callsign never produce a pick list; the best row in that rank wins (active: latest ATD; filed: ETD nearest now; arrived: latest ATA).
4. **Live fallback accepts on-ground hits** (a taxiing aircraft is "departing"); `status` is `active` only when airborne, else `unknown`. Several live hits produce a pick list.
5. **Decoded-route cache key** is `cycle | origin | dest | route text` instead of `gufi + amended_at + cycle`: equivalent when amendments change the text, correct when a message fills in a route without an amendment time, and shared across flights that file the same route.
6. **Rate limits:** `/api/*` gets ~60 requests/min per IP (burst 60, refill 1/s). `/api/nav` tiles use a separate 600/min bucket, because zooming out to 320 nm needs ~40 tiles at once. `/api/health` is not limited.
7. **Client IP** is `Fly-Client-IP` when running on Fly (`FLY_APP_NAME` set), otherwise the socket address. Headers are not trusted elsewhere.
8. **Traffic query** asks adsb.lol for 45 nm around the 0.1° cell centre, then keeps aircraft within 40 nm of the subject. Ground traffic and positions older than 60 s are dropped.
9. **Trail times are epoch seconds**; `LiveState.t` stays epoch ms (spec).
10. **adsb.lol failure with nothing cached** → 503 `live_unavailable` (the client keeps dead-reckoning). A missing aircraft is `aircraft: null`, not an error.
11. **`degraded: "swim_delayed"`** is only set when SWIM is enabled; before Plan 4 every flight goes through the fallback, and "filed routes may be delayed" would be wrong.
12. **PSA Airlines files as `JIA`**, its ICAO code; spec §7's example list says `PSA`. `airlines.json` uses `JIA`, and adds Air Wisconsin (`AWI`), which flies as American Eagle.
13. **`/api/health`** keeps the spec fields and adds `swim.enabled`, `swim.reconnects`, `navEffective`, `flights` (row count). It always answers 200, so Fly does not restart the machine for an upstream outage.

## File structure

| File | Responsibility |
|---|---|
| `shared/types.ts` | + `Airport`, `FlightView`, `FlightChoice`, `LiveState`, `Trail`, `NavTile`, `Health`, `ApiErrorBody` (spec §8) |
| `navdata/cycle.ts` | + `airacIdent(cycle)` |
| `navdata/navdb.ts` | + `airac` and `tile(lat, lon)`: navaids and ≥ 4,000 ft airports in a 2°×2° cell |
| `server/store/flights.ts` | `FlightRecord`, `FlightStore`: open/migrate, merge-upsert, lookup by callsigns, purge, count |
| `server/store/seed.ts`, `seed-flights.json` | Development flight plans with times relative to now |
| `server/live/adsb.ts` | `AdsbSource` interface and `HttpAdsbSource` (User-Agent, 5 s timeout, per-host backoff on 429/5xx) |
| `server/live/cache.ts` | `TtlCache`: TTL, LRU bound, in-flight coalescing, stale-on-error |
| `server/live/trail.ts` | `trimTrace()`: trace_full → current-leg `Trail` |
| `server/live/live.ts` | `LiveService`: aircraft, traffic, `LiveState`, trail, routeset |
| `server/resolve/airlines.json`, `airlines.ts` | Curated IATA → ICAO brands, regional operators, operator names |
| `server/resolve/normalize.ts` | `normalizeQuery()`, `candidateCallsigns()` |
| `server/resolve/rank.ts` | `rankFlights()` (spec §7.4–7.5) |
| `server/resolve/resolve.ts` | `FlightResolver`: query → `FlightView` / choices / error, 60 s result cache, §6.5 fallback |
| `server/swim/status.ts` | `SwimStatus` interface and the disabled stub (Plan 4 provides the real one) |
| `server/api/ratelimit.ts` | Token-bucket limiter |
| `server/api/app.ts` | `createApp(deps)`: Hono routes, error shape, cache headers |
| `server/config.ts`, `server/main.ts` | Env config; wiring; hourly purge; `--seed` |

## Tasks

- [x] **Task 1 — Shared API types, AIRAC ident, nav tiles.** Tests: `airacIdent` for 2026-01-22 (`2601`), 2026-10-01 (`2610`), 2026-12-24 (`2613`), 2027-01-21 (`2701`); `NavDb.tile` returns only the cell's navaids and long-runway airports.
- [x] **Task 2 — Flight store.** Tests: insert then partial upsert keeps earlier non-null fields; `byCallsigns`; `purge(cutoff)` deletes only rows updated before the cutoff.
- [x] **Task 3 — adsb.lol client, cache and trail.** Tests (fake `fetch`): User-Agent sent, callsign trimmed, `ageSec` from `now − seen_pos`, `alt_baro: "ground"` → `onGround`, 429 starts a backoff that skips calls until it expires; `TtlCache` fresh/stale/coalescing; `trimTrace` keeps only points after the last ground point / new-leg flag with the matching callsign.
- [x] **Task 4 — LiveService.** Tests (fake source): 5 s cache, stale value served with growing age when the source fails, 503 path when nothing is cached, traffic excludes the subject, ground traffic and anything beyond 40 nm.
- [x] **Task 5 — Resolution.** Tests: normalization table (`aa 0558` → `AA`/`558`, `AAL558`, `B61`, malformed inputs), IATA → ICAO, regional candidates; ranking (active beats filed beats arrived, late filed flights count, pick list only across callsigns); fallback via routeset + preferred route (`source: "expected"`), great circle when no preferred route, `source: "none"` without airports, 404 `not_found`.
- [x] **Task 6 — Hono app.** Tests with `app.request()`: every route's success shape; error shapes for malformed query, unknown airline, bad hex, bad tile coordinates, stale cycle; `Cache-Control: immutable` on tiles and `no-store` elsewhere; 429 after the bucket empties; `/api/flight` served from the 60 s cache.
- [x] **Task 7 — Wiring and seeds.** `npm run dev:server` loads the newest nav file, opens `data/flights.db`, seeds development flights and listens on `:8080`. A test decodes every seed route against the built cycle (skipped without nav data); only the seed meant to show **PARTIAL** may be partial.

## Acceptance

    npm test && npm run typecheck
    npm run dev:server
    curl localhost:8080/api/flight/AA558          # FlightView from the seeded plan, route source "filed"
    curl localhost:8080/api/flight/UA5000         # { choices: [...] }
    curl localhost:8080/api/live/AAL558           # LiveState from adsb.lol (aircraft null unless airborne)
    curl localhost:8080/api/nav/2610/32/-98       # NavTile, immutable
    curl localhost:8080/api/health
