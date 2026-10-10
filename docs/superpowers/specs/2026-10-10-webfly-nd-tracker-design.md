# WebFly — Airbus-style ND Flight Tracker: Design Spec

- **Date:** 2026-10-10
- **Status:** Approved in brainstorming; awaiting written-spec review
- **Author:** Aaron Roth (with Claude)

## 1. Summary

WebFly is a free, public, mobile-first web app. The user types a flight number (e.g. `AA558`). The app looks up the flight's **filed IFR route** and **live position**, then draws them on a display modeled on the **Airbus A320-family Navigation Display (ND) in ARC mode**: heading/track-up, aircraft near the bottom, green route line, magenta navaids and airports, TCAS-style traffic, and the flown trail. The display updates every ~5 s with smooth interpolation.

## 2. Goals and success criteria

**Goals**
- Turn an airline flight number into a live, cockpit-styled moving map of that flight's filed route and position.
- Use only free, publicly available data sources. The app is free and not monetized.
- Cover US domestic flights first, with fully decoded routes.

**Success criteria**
1. On a phone, typing `AA558` (or `AAL558`) shows the ND within ~3 s for a flight that is airborne or departing within 12 h.
2. The green route line matches the filed (and amended) flight plan from FAA SWIM, with SIDs, airways and STARs expanded into their fixes.
3. The aircraft symbol moves smoothly. Position data is ≤ ~10 s old under normal conditions.
4. The ND shows navaids, airports, traffic within 40 nm, the flown trail, the range selector (10–320 nm), and GS/TAS/wind/TO-waypoint data blocks.
5. Running cost stays around **$6–7/month** at low-to-moderate traffic.

## 3. Non-goals (v1)

- User accounts and saved flights (only device-local recent searches)
- Decoding routes outside US airspace (international flights show position plus whatever part of the route decodes)
- ROSE, PLAN and other ND modes; vertical display; PFD
- TCAS TA/RA alerting logic, which would mislead in a spectator app
- Push notifications or alerts
- Tail-number or general-aviation flight lookup
- Monetization or paid tiers

## 4. Key decisions and rationale

| Decision | Choice | Why |
|---|---|---|
| Filed-route source | **FAA SWIM via SCDS (SFDPS feed)** | The only free source of real filed and amended routes. FlightAware AeroAPI's free Personal tier is licensed for personal use only, not a public site; Standard tier costs at least $100/mo. |
| Live position source | **adsb.lol API** | Free, ODbL-licensed, has a callsign lookup. Its docs say "You can use the API for free" and ask production users to make contact. |
| Nav database | **FAA NASR 28-day subscription (CSV)** | Public domain, complete for the US (navaids, fixes, airways, SIDs/STARs, preferred routes). |
| Hosting | **Fly.io, one always-on machine** | The SWIM consumer needs a persistent connection, which serverless (Vercel) handles poorly. One process also gives a shared in-memory cache for free. About $6–7/mo, versus $25–30+ on Vercel Pro plus Redis. |
| App framework | **Vite + React SPA, Hono API server, TypeScript** | A single-screen canvas app gains nothing from Next.js SSR once off Vercel. |
| Flight-plan store | **SQLite on a Fly volume** | Single writer, single reader process, small data (~36 h of plans), survives restarts. |
| ND rendering | **Canvas 2D** | Hundreds of features re-projected per frame at 60 fps on mobile. Crisp at `devicePixelRatio`. |
| Font | **B612 / B612 Mono** (SIL OFL) | Open-source cockpit-display font co-developed by Airbus. |

## 5. Architecture

One repository, one Docker image, and one always-on Fly.io machine (shared-cpu-1x, 1 GB RAM, US-East region) with a 1 GB volume mounted at `/data`.

```
Phone browser ──HTTPS──▶ ┌──────────────── Fly machine (Node 22) ─────────────────┐
  Vite + React SPA       │ Hono server                                            │
  ├ input screen         │  ├ GET /                → static SPA files             │
  └ ND canvas            │  ├ GET /api/flight/:q   → resolve + decode route       │
     polls every 5 s     │  ├ GET /api/live/:cs    → position + traffic (5s cache)│
                         │  ├ GET /api/trail/:hex  → current-leg trail            │
                         │  ├ GET /api/nav/...     → nav tiles (immutable)        │
                         │  └ GET /api/health      → ingest / cycle status        │
                         │                                                        │
                         │ SWIM consumer ──Solace/TLS──▶ FAA SCDS (SFDPS queue)   │
                         │   └ upserts flight plans ─▶ SQLite (/data/flights.db)  │
                         │ Nav DB (FAA NASR, in memory, swapped each 28-day cycle)│
                         │ adsb.lol client ──HTTPS──▶ api.adsb.lol / adsb.lol     │
                         └────────────────────────────────────────────────────────┘
```

### 5.1 Units

| Unit | Responsibility | Depends on |
|---|---|---|
| `shared/` | TypeScript types shared by client and server (`FlightView`, `RoutePoint`, `LiveState`, `NavTile`, …) | — |
| `navdata/` | Build: NASR CSV zips → compact `nasr-<cycle>.json.gz`. Runtime: in-memory nav DB with lookups (fix/navaid/airport by ident near a point, airway by name, SID/STAR by computer code, preferred route by airport pair, spatial tile query) | NASR CSVs |
| `server/swim/` | Persistent SCDS connection, raw-string message-type prefilter, SFDPS XML parsing, upserts into SQLite, purge job, health counters | `solclientjs`, SQLite |
| `server/route/` | NAS route string → ordered `RoutePoint[]` | nav DB |
| `server/resolve/` | Flight-number input → candidate callsigns → best flight plan, or a pick list | SQLite, `airlines.json`, `server/live` |
| `server/live/` | adsb.lol client with shared in-memory caches: aircraft by callsign, traffic by cell, trail by hex | adsb.lol |
| `server/api/` | Thin Hono routes composing the units above, plus per-IP rate limiting | all of the above |
| `web/` | Input screen, pick list, ND renderer (Canvas 2D), polling, interpolation | `shared/` |

Each server unit can be unit-tested without network access or SWIM. Only `server/swim/` needs FAA access, and a fixture-replay tool covers it during development (§10).

## 6. Data pipeline

### 6.1 Nav data (FAA NASR)

- **Source:** `https://nfdc.faa.gov/webContent/28DaySub/extra/<DD_Mon_YYYY>_<CAT>_CSV.zip` for categories `APT`, `NAV`, `FIX`, `AWY`, `DP`, `STAR`, `PFR`. Cycles are listed on the FAA NASR Subscription page; the current cycle is effective 2026-10-01 and the next 2026-10-29.
- **Build** (`navdata/build`): download, keep only the needed columns, normalize, and write `nasr-<cycle>.json.gz` to `/data/nasr/`. The Docker image also bakes in the cycle current at build time, so a fresh machine boots without network access to the FAA.
- **Contents kept:**
  - Airports: ident, ICAO id, name, lat/lon, longest runway length, public/private use
  - Navaids: ident, type (VOR, VOR/DME, VORTAC, TACAN, DME, NDB), lat/lon, magnetic variation
  - Fixes: ident, lat/lon
  - Airways: name with an ordered list of fix/navaid idents and coordinates
  - SIDs/STARs: computer code, transitions, ordered points
  - Preferred routes: origin, destination, route string
- **Runtime update:** a daily timer checks the FAA page. Once a newer cycle's effective date has passed, it builds the new file and atomically swaps the in-memory DB. If that fails, it keeps the current cycle and retries the next day.

### 6.2 Flight plans (FAA SWIM → SQLite)

- **Connection:** `solclientjs` to the SCDS SFDPS queue named in the user's SCDS subscription. Reconnects with exponential backoff (1 s → 60 s cap).
- **Prefilter:** before any XML parsing, a cheap substring check on the raw message determines its type. High-volume track messages (`TH`) and other irrelevant types are dropped unparsed. Only flight-plan lifecycle messages are kept: filed, amended, departure, arrival, cancellation.
- **Parsing:** `fast-xml-parser` extracts GUFI, callsign (aircraft ID), departure and arrival airports, route text, aircraft type, ETD/ATD/ETA/ATA, and status.
- **Schema:**

  ```sql
  CREATE TABLE flights (
    gufi        TEXT PRIMARY KEY,
    callsign    TEXT NOT NULL,
    origin      TEXT,
    dest        TEXT,
    route_text  TEXT,
    ac_type     TEXT,
    etd INTEGER, atd INTEGER, eta INTEGER, ata INTEGER,   -- epoch seconds UTC
    status      TEXT NOT NULL,   -- filed | active | arrived | cancelled
    amended_at  INTEGER,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX flights_callsign ON flights(callsign);
  ```

- **Retention:** an hourly purge deletes rows with `updated_at` older than 36 h.
- **Health counters:** last message time, messages/min kept, messages/min dropped, and reconnect count, exposed via `/api/health`.

### 6.3 Route decoding (`server/route/`)

Decoding happens on request and only for flights someone actually looks up. Results are cached in memory, keyed by `gufi + amended_at + nav cycle`.

- **Tokenizer:** NAS format. `.` joins a fix to an airway or procedure (`ABI.J52.TXO`), and `..` means direct (`TXO..ZEMMA`). The first and last tokens are the airports.
- **Token kinds handled:**
  - Airport, fix, navaid
  - Airway (`J52`, `Q30`, `V16`, `T270`): expand the segments between the entry and exit fixes, in either direction
  - SID/STAR by computer code with transition (`BOOVE4.ABI`, `TXO.ANJLL4`)
  - Fix-radial-distance (`ABI270015`)
  - Latitude/longitude (`3530N/09720W`)
- **Duplicate idents:** pick the candidate nearest the previous decoded point (FMS-style heuristic).
- **Unresolvable tokens:** skip, connect the neighbors directly, set `route.partial = true`, and log the token.
- **Zig-zag guard:** drop any point whose inclusion deflects the path more than ~300 nm laterally from the line between its neighbors.
- **Output:** `RoutePoint[]` (see §8).

### 6.4 Live data (adsb.lol)

- **Aircraft:** `GET https://api.adsb.lol/v2/callsign/{callsign}`, cached 5 s per callsign.
- **Traffic:** `GET https://api.adsb.lol/v2/point/{lat}/{lon}/40`, cached 5 s per ~0.1° cell. The subject aircraft is excluded from the results.
- **Trail backfill:** `GET https://adsb.lol/data/traces/{hex[-2:]}/trace_full_{hex}.json`, cached 30 s. Trimmed to the current leg: points after the last on-ground point that match the flight's callsign. This endpoint backs the public map page and is **not a documented API**. If it fails, the trail starts when the user opens the flight.
- **Outbound etiquette:** a descriptive `User-Agent` with a contact URL, timeouts of 5 s, and backoff on 429/5xx.

### 6.5 Fallback when no SWIM plan exists

1. If the aircraft is airborne (found via adsb.lol), try `POST https://api.adsb.lol/api/0/routeset` for origin and destination. This is best-effort; it returned an empty body when tested on 2026-10-10.
2. With origin and destination: use the FAA Preferred Route for that pair if one exists, decoded as in §6.3. Otherwise use a great circle. Either way `route.source = "expected"`, displayed as **EXPECTED ROUTE**.
3. Without origin and destination: `route.source = "none"`. Show position, navaids and traffic only, with a **NO FILED ROUTE** message.

## 7. Flight resolution (`server/resolve/`)

1. **Normalize the input:** uppercase, strip whitespace, match `^([A-Z]{3}|[A-Z0-9]{2})(\d{1,4})$`, and strip leading zeros from the number.
2. **Map the airline:** a 2-character IATA code maps to ICAO through `airlines.json` (curated: US carriers plus major foreign carriers serving the US). A 3-letter code is used as given. An unknown code returns the error `unknown_airline`.
3. **Generate candidates:** the mainline candidate is `ICAO + number`. The brand's regional operators from `airlines.json` add more candidates, e.g. AA → `ENY`, `PDT`, `PSA`, `SKW`, `RPA`; UA → `SKW`, `RPA`, `ASH`, `GJS`; DL → `EDV`, `SKW`, `RPA`.
4. **Score the matching SQLite rows:**
   1. `active`: departed, not arrived
   2. `filed` with the ETD nearest now, within the next 12 h
   3. `arrived` within the last 2 h
5. **Pick the result:** one clear winner returns a `FlightView`. Several equally ranked flights return `{ choices: FlightChoice[] }`. Nothing found means checking each candidate on adsb.lol; an airborne hit goes through the §6.5 fallback, otherwise the result is a 404 `not_found`.

## 8. API contracts

All responses are JSON. Errors use the shape `{ error: { code, message } }`.

```ts
// shared/types.ts
export interface Airport { icao: string; name: string; lat: number; lon: number }

export interface RoutePoint {
  ident: string;                 // "ZEMMA", "ABI", "KDFW", "3530N/09720W"
  lat: number; lon: number;
  kind: 'airport' | 'navaid' | 'fix' | 'latlon' | 'frd';
  via?: string;                  // airway or procedure that produced it, e.g. "J52", "ANJLL4"
}

export interface FlightView {
  query: string;                 // what the user typed
  callsign: string;              // "AAL558"
  gufi?: string;
  operator?: string;             // "American Airlines"
  acType?: string;               // "A321"
  origin?: Airport; dest?: Airport;
  status: 'filed' | 'active' | 'arrived' | 'unknown';
  etd?: number; atd?: number; eta?: number;   // epoch s UTC
  route: {
    source: 'filed' | 'expected' | 'none';
    text?: string;
    points: RoutePoint[];
    partial: boolean;
    amendedAt?: number;
  };
  hex?: string;                  // ICAO 24-bit transponder address, when known
  navCycle: string;              // "2610"
  degraded?: 'swim_delayed';     // set when no SWIM message kept for > 3 min (§10)
}

export interface FlightChoice { query: string; callsign: string; origin?: string; dest?: string; etd?: number; status: string }

export interface LiveState {
  t: number;                     // server time, epoch ms
  aircraft: null | {
    hex: string; lat: number; lon: number;
    altBaro?: number; gs?: number; track?: number; vs?: number;
    tas?: number; trueHeading?: number;
    windDir?: number; windSpd?: number;
    onGround: boolean; ageSec: number;
  };
  traffic: Array<{ hex: string; callsign?: string; lat: number; lon: number; alt?: number; track?: number; vs?: number }>;
}

export type Trail = Array<[t: number, lat: number, lon: number, alt: number | null]>;

export interface NavTile {
  cycle: string;
  navaids: Array<{ ident: string; type: string; lat: number; lon: number }>;
  airports: Array<{ icao: string; lat: number; lon: number }>;
}
```

| Endpoint | Returns | Cache |
|---|---|---|
| `GET /api/flight/:query` | `FlightView`, or `{ choices: FlightChoice[] }`, or 404 | 60 s (server memory) |
| `GET /api/live/:callsign` | `LiveState` | 5 s |
| `GET /api/trail/:hex?callsign=` | `Trail` | 30 s |
| `GET /api/nav/:cycle/:lat/:lon` | `NavTile`: the 2°×2° cell whose SW corner is (`lat`, `lon`), both even integers. Airports filtered to runways ≥ 4,000 ft | `Cache-Control: public, max-age=31536000, immutable` |
| `GET /api/health` | `{ swim: { connected, lastMessageAt, keptPerMin, droppedPerMin }, navCycle, uptimeSec }` | none |

**Rate limit:** token bucket of ~60 requests/min per IP on `/api/*`; exceeding it returns 429.

**Client polling:** `/api/live` every 5 s and `/api/flight` every 2 min, both paused while `document.hidden`. `/api/trail` is fetched once per flight load.

## 9. ND renderer (`web/`)

### 9.1 Screens

- **Input** (`/`): black background, one large `FLT NBR` input, GO button, recent searches (`localStorage`, wrapped in try/catch).
- **Pick list:** shown when `/api/flight` returns `choices`.
- **ND** (`/f/:query`): deep-linkable and shareable.

### 9.2 Layout (portrait phone)

```
┌────────────────────────────────────┐
│ GS 452 TAS ---       ZEMMA         │  top-left: GS/TAS (label white, value green)
│ 270/45 ↘           241° 87NM       │  wind dir/speed + arrow (green)
│                     14:52          │  top-right: TO wpt ident (white), brg/dist/ETA (green)
│        ╭──┬──┬──╋──┬──┬──╮         │  ~100° compass arc, white; TRK label
│       ·      ◆ VOR         ·       │  navaids/airports magenta
│      ·   ─────●ZEMMA──────  ·      │  route green; TO waypoint white
│     ·    160                 ·     │  range labels cyan; range arcs white dashed
│          ◇+12↑                     │  traffic white
│     ·  ....... trail          ·    │  trail dim grey
│                ✈                   │  aircraft yellow, fixed
│  [ − ]          80 NM         [ + ]│
├────────────────────────────────────┤
│ AAL558  A321  KDFW → KLAX  FL350   │  flight strip
│ FILED ROUTE · amended 14:32Z       │  route source badge (FILED / EXPECTED / PARTIAL / NONE)
│ adsb.lol (ODbL) · FAA NASR 2610    │  attribution
└────────────────────────────────────┘
```

Landscape: the ND is centered and sized to the viewport height, and the flight strip moves to the right side.

### 9.3 Symbology (Airbus conventions)

| Element | Rendering |
|---|---|
| Background | black `#000` |
| Own aircraft | yellow symbol, fixed at ~80% of ND height, centered |
| Compass arc | white, ~100° span, 5° ticks, labels every 30° (2-digit, e.g. `27`), fixed lubber line yellow |
| Track diamond | green on the arc. Heading-up when `trueHeading` is present (label `HDG`), otherwise track-up (label `TRK`) |
| Range arcs | white dashed at ¼, ½, ¾ of range. Range values in cyan |
| Route line | green, solid. Waypoint symbols (4-point star) green with green idents |
| TO waypoint | white symbol and ident |
| Origin/destination airports | white |
| DB navaids | magenta: VOR (hexagon-like), VOR/DME and VORTAC (VOR + box/tabs), NDB (dotted circle), with idents |
| DB airports | magenta star-in-circle with ICAO id |
| Traffic | hollow white ◇. Filled ◆ when proximate (< 6 nm and ±1,200 ft). Relative altitude in hundreds of ft (`+12`, `-05`) plus ↑/↓ when \|vs\| > 500 fpm. No TA/RA colors |
| Flown trail | dim grey `#666` dots (deliberately non-Airbus) |
| Missing data | `---` in place of the value |
| Stale position | amber `POS nnS OLD` at the top center when the position is > 30 s old |

**Font:** B612 Mono for all ND text, B612 for the UI chrome.

### 9.4 Rendering pipeline

- Canvas 2D sized to CSS size × `devicePixelRatio`, redrawn on `requestAnimationFrame` only while the ND is visible.
- **Projection:** for each feature, compute the great-circle bearing and distance from the current (interpolated) aircraft position. Convert true bearing to display bearing by subtracting the display reference (magnetic track or heading). Polar → screen, with scale = ND radius ÷ selected range. Features beyond 1.1 × range are culled.
- **True → magnetic:** WMM2025 via a small npm package (e.g. `geomagnetism`). Variation is recomputed when the aircraft has moved more than 10 nm.
- **Interpolation:** dead-reckon from the last fix using `gs` and `track`. When a new fix arrives, blend the predicted-vs-actual error to zero over 1 s. Ease display rotation with a ~0.5 s time constant (shortest-path angle).
- **Range:** − and + buttons and pinch-to-zoom step through 10, 20, 40, 80, 160 and 320 nm. Default 80 nm (40 nm when below 10,000 ft).
- **Nav tiles:** fetch the tiles intersecting a circle of radius `range` around the aircraft; keep up to 64 in an LRU.
- **TO waypoint:** the active leg is the route leg with minimum cross-track distance whose along-track progress lies in [0, 1], searched forward from the previous active leg. TO = that leg's end point. Distance remaining = distance to TO + the sum of later legs. ETA = now + remaining ÷ GS.

## 10. Error handling

| Situation | Behavior |
|---|---|
| Malformed input or unknown airline | Inline message under the input; no request (malformed) or 400 `unknown_airline` |
| No plan, not airborne | 404 `not_found` → "No flight AA558 found today. Try the operating carrier's code." |
| Undecodable route token | Skip, connect neighbors, `partial: true`, badge **PARTIAL**, server log |
| Implausible decoded point | Zig-zag guard drops it (§6.3) |
| adsb.lol error or timeout | Serve the last cached value with its true age. The client dead-reckons ≤ 60 s, then freezes and shows `POS nnS OLD`. Server backs off on 429/5xx |
| No position at all | ND centered on the origin airport, track-up replaced by north-up, `NO POSITION` flag |
| SWIM disconnected | Reconnect with backoff. No kept message for > 3 min → `/api/flight` responses carry `degraded: "swim_delayed"` and the client shows the banner "Filed routes may be delayed" |
| NASR update failure | Keep the current cycle, retry daily, surface in `/api/health` |
| Machine restart | SQLite plans persist on the volume; caches rebuild lazily |
| Rate limit exceeded | 429, and the client backs off to 15 s polling for one minute |

## 11. Testing

- **Route decoder:**
  - Corpus test: decode every route string in the current cycle's PFR file between airports in the NASR data. Assert that at least 99% decode with no unresolved tokens and no zig-zag drops, and print the most frequent misses. Measured on cycle 2026-10-01: 99.38% (10,726 of 10,793). The misses are mostly Canadian fixes, which are absent from FAA data.
  - Golden tests for SID/STAR transitions, airway direction reversal, fix-radial-distance, lat/lon tokens, and duplicate idents.
- **Unit tests (Vitest):**
  - Input normalization and IATA→ICAO, candidate generation, scoring
  - Geo math (bearing, distance, cross-track, along-track, projection)
  - True→magnetic against published WMM test values
  - TO-waypoint and ETA logic
- **SFDPS parser:** fixtures from FAA NSRR sample messages, plus a lifecycle test (filed → amended → departed → arrived → purged) against an in-memory SQLite.
- **API integration:** Hono routes tested with a seeded SQLite and an injected fake adsb.lol client: rate limiting, caching, error shapes, and the fallback path.
- **ND visual regression:** Playwright at a 390×844 viewport with fixture `FlightView`/`LiveState` data and a frozen clock. Screenshots are compared against baselines.
- **Developer mode:** `SWIM_ENABLED=false` runs everything except the consumer, and `npm run swim:replay <dir>` feeds recorded SFDPS fixtures through the consumer pipeline.

## 12. Deployment

- `Dockerfile` (multi-stage): build the SPA and server, then bake in the current NASR cycle.
- `fly.toml`: one machine, `auto_stop_machines = false`, `min_machines_running = 1`, volume `webfly_data` → `/data`, health check on `/api/health`.
- **Secrets** (Fly secrets): `SCDS_URL`, `SCDS_VPN`, `SCDS_USERNAME`, `SCDS_PASSWORD`, `SCDS_QUEUE`.
- **Estimated cost:** shared-cpu-1x 1 GB (~$5.70/mo) + 1 GB volume (~$0.15/mo) + bandwidth ≈ **$6–7/mo**.

## 13. Risks and open items

| Risk | Impact | Mitigation |
|---|---|---|
| FAA SCDS approval takes days, or SFDPS isn't offered on SCDS as expected | No filed routes | Build and test everything else first (fixtures, replay, fallback). Verify the SFDPS availability early in sign-up |
| SFDPS message volume exceeds the shared-CPU allowance | Throttling, ingest lag | Raw-string prefilter. Measure kept/dropped rates via `/api/health`. Upgrade to shared-cpu-2x or a performance CPU if needed |
| SCDS data-use terms (e.g. LADD blocking) | Compliance | Airline-flight-only search in v1. Read the SCDS Service Access Agreement at sign-up |
| adsb.lol introduces mandatory API keys or rate limits | Live data loss | Contact adsb.lol before launch as their docs ask. Shared server-side cache keeps call volume low. Consider feeding adsb.lol (a receiver) to qualify for a key |
| adsb.lol `trace_full` (undocumented) changes | No trail backfill | Optional feature; the trail falls back to live accumulation |
| adsb.lol `routeset` unreliable | Weaker fallback | Fallback only; SWIM is the primary path |
| Regional codeshare mapping is heuristic | Wrong or missing flight for some regional numbers | Pick list when ambiguous; curated `airlines.json` can be extended |

## 14. External setup (owner actions)

1. Register for **FAA SCDS** (SWIM Cloud Distribution Service) and request an **SFDPS** subscription. Record the connection URL, VPN, credentials and queue name.
2. Create a **Fly.io** account and organization and add a payment method.
3. Contact **adsb.lol** about production use of the API (per their API terms), and confirm the preferred attribution.

## 15. Sources

- FAA SWIM access: https://www.faa.gov/air_traffic/technology/swim/products/get_connected
- FAA SWIM Q&A: https://www.faa.gov/air_traffic/technology/swim/questions_answers
- FAA NASR Subscription: https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/
- Solace SWIM feed handler reference: https://github.com/solacese/swim-feed-handler
- adsb.lol API spec: https://api.adsb.lol/api/openapi.json
- FlightAware AeroAPI tiers: https://flightaware.com/commercial/aeroapi/
- Fly.io pricing: https://fly.io/docs/about/pricing/
