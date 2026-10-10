# WebFly Plan 2: API Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run dev:server` answers `/api/flight/:q`, `/api/live/:cs`, `/api/trail/:hex`, `/api/nav/:cycle/:lat/:lon` and `/api/health`, using seeded flight plans, real adsb.lol data and the Plan 1 nav core.

**Architecture:** Pure units with injected dependencies (`fetch`, clock, `NavDb`, `FlightStore`) so every unit tests without network. `server/api/app.ts` builds a Hono app from those units; `server/index.ts` wires real ones and serves it with `@hono/node-server`.

**Tech Stack:** Node ≥ 22.13 (`node:sqlite`, no native dependency), Hono, `@hono/node-server`, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-10-webfly-nd-tracker-design.md` (§5.1, §6.2 schema, §6.4, §6.5, §7, §8, §10 server rows)

## Global Constraints

- TypeScript with `.ts` import specifiers, `verbatimModuleSyntax`, strict (as in Plan 1).
- Error body shape: `{ error: { code, message } }`.
- Cache TTLs: flight 60 s, live 5 s per callsign, traffic 5 s per ~0.1° cell, trail 30 s; `/api/nav` is `public, max-age=31536000, immutable`.
- Rate limit: ~60 requests/min per IP on `/api/*`, then 429.
- Outbound: descriptive `User-Agent`, 5 s timeout, serve stale cache on upstream error.
- `navCycle` is the AIRAC ident (2026-10-01 → `2610`, 2026-10-29 → `2611`), not YYMM.
- `NavTile` is the 2°×2° cell with even-integer SW corner; airports only with runway ≥ 4,000 ft.

## Review Focus

- Callsign with leading zeros / lowercase / spaces (`" aa 0558 "`) normalizes to `AAL558`.
- Unknown airline → 400 `unknown_airline`; malformed → 400 `bad_query`.
- adsb.lol down → live endpoint serves last cached value with true `ageSec`, never a 500.
- Odd `/api/nav` coordinates (odd ints, non-numeric, out of range) → 400, not an empty immutable tile.
- Flight store holds two plans with the same callsign (yesterday's arrived + today's filed) → today's wins.
- Origin/dest not in NASR (foreign) → route marked partial, not a crash.

---

### Task 1: Dependencies and flight store

**Files:** Modify `package.json`; Create `server/store/flights.ts`, `server/store/flights.test.ts`

**Interfaces:**
- Produces: `interface FlightRow {gufi, callsign, origin?, dest?, routeText?, acType?, etd?, atd?, eta?, ata?, status: 'filed'|'active'|'arrived'|'cancelled', amendedAt?, updatedAt}`; `class FlightStore { constructor(path=':memory:'); upsert(row); byCallsigns(cs: string[]): FlightRow[]; purge(olderThanSec: number): number; count(): number }`

- [ ] Install `hono @hono/node-server`, bump `engines.node` to `>=22.13`, add scripts `dev:server`, `seed`.
- [ ] Test: upsert twice with same gufi → one row, newer fields; `byCallsigns` filters; `purge` deletes by `updated_at`.
- [ ] Implement with `node:sqlite` `DatabaseSync`, schema from spec §6.2.
- [ ] Commit.

### Task 2: Nav DB additions (carried from Plan 1 review)

**Files:** Modify `navdata/cycle.ts`, `navdata/navdb.ts`, `navdata/types.ts`, `server/route/decode.ts`; tests alongside.

**Interfaces:**
- Produces: `airacIdent(cycle: string): string`; `NavDb.tile(lat0, lon0): NavTile` (`NavTile` in `shared/types.ts`); `NavDb.prefRoutes` returns a copy; `NavDb.bestPrefRoute(orig, dest): PrefRouteRec | undefined` (prefers `H`/`NAR`, then others).

- [ ] Tests: `airacIdent('2026-10-01')==='2610'`, `'2026-10-29'==='2611'`, `'2027-01-21'==='2701'`; tile contains only items in the cell, airports ≥ 4000 ft; mutating `prefRoutes()` result does not change the DB; `bestPrefRoute` preference; `decodeRoute('', db, {origin:'ZZZ'})` puts `ZZZ` in `unresolved`.
- [ ] Implement. AIRAC ident: year = cycle year mod 100; number = floor(daysSince(first cycle of that year)/28)+1, where the first cycle of year Y is the cycle date falling in Jan 1–28 (anchor 2026-01-22 → 2601, step 28 days).
- [ ] Commit.

### Task 3: Flight resolution

**Files:** Create `server/resolve/airlines.json`, `server/resolve/normalize.ts`, `server/resolve/resolve.ts` + tests.

**Interfaces:**
- Produces: `normalizeQuery(q): {ok:true, airline:string, number:string} | {ok:false, code:'bad_query'|'unknown_airline'}`; `candidateCallsigns(airlineIcao, number): string[]`; `scoreRows(rows, now): FlightRow[]` (ranked winners only, per spec §7.4); `resolve(q, store, now): {kind:'one', row} | {kind:'choices', rows} | {kind:'none', candidates: string[]} | {kind:'error', code}`.

- [ ] Tests for normalization, IATA→ICAO, regional candidates, scoring order (active > filed within 12 h > arrived within 2 h), tie → choices, stale rows ignored.
- [ ] Implement; commit.

### Task 4: Live data client

**Files:** Create `server/live/adsb.ts`, `server/live/trail.ts` + tests.

**Interfaces:**
- Produces: `class AdsbClient { constructor({fetch, now, userAgent}); aircraft(callsign): Promise<LiveAircraft|null>; traffic(lat, lon, excludeHex?): Promise<Traffic[]>; trace(hex): Promise<any|null>; routeset(callsign, lat, lon): Promise<{origin?, dest?}> }`; `liveState(client, callsign): Promise<LiveState>`; `trimTrail(trace, callsign): Trail`.

- [ ] Tests with fake fetch: 5 s cache hit (one fetch for two calls), stale-on-error returns old value with larger `ageSec`, 429 triggers backoff, traffic cell caching and subject exclusion, trail trimmed to last on-ground point.
- [ ] Implement; commit.

### Task 5: Flight builder with fallback

**Files:** Create `server/flight/build.ts` + test.

**Interfaces:**
- Consumes: Tasks 1–4. Produces: `buildFlightView(query, deps): Promise<FlightView | {choices} | {error}>` with route cache keyed `gufi+amendedAt+cycle`, §6.5 fallback (routeset → preferred route → great circle → none), `degraded` flag, unresolved tokens logged via injected `log`.

- [ ] Tests: filed row → decoded route, `source:'filed'`; no row + airborne + routeset → `expected` via preferred route; no origin/dest → `none`; `swim_delayed` when last message > 3 min.
- [ ] Implement; commit.

### Task 6: Hono app, server entry and seed tool

**Files:** Create `server/api/app.ts`, `server/api/ratelimit.ts`, `server/index.ts`, `scripts/seed.ts` + tests.

- [ ] Tests (`app.request()`): each endpoint's happy path, error shapes, 429 after burst, nav tile cache header, nav 400s, health payload.
- [ ] Implement; `npm run seed` inserts a sample active flight (AAL558 KDFW→KLAX); `npm run dev:server` listens on `PORT` (default 8787).
- [ ] Final: `npm test`, `npm run typecheck`, manual curl against the dev server if nav data is built; commit.
