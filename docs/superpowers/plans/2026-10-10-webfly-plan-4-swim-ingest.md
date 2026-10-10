# WebFly Plan 4 — SWIM Ingest Implementation Plan

**Goal:** Keep the `flights` table current from the FAA SWIM SFDPS feed: a persistent SCDS consumer, a raw-string prefilter that drops track traffic unparsed, a FIXM parser for flight-plan lifecycle messages, merge-upserts into SQLite, health counters, and a replay tool, all testable without FAA access.

**Status of FAA access:** not yet granted. Everything except the live connection runs and is tested against (a) real SFDPS FIXM payloads from NASA RACE (Apache-2.0, all `TH` track messages) and (b) synthetic lifecycle payloads built from the FIXM 3.0 / NAS 3.0 schema in the same shape as the real ones. **When SCDS access arrives:** set the secrets, run with `SWIM_RECORD_DIR`, replace the synthetic fixtures with recorded ones, and fix any path the real messages disagree on.

**Architecture:** `server/swim/prefilter.ts` decides from the raw string whether a payload can contain a kept message. `parse.ts` (fast-xml-parser, namespace prefixes stripped) turns `MessageCollection` or `NasFlight` payloads into `SfdpsFlight` records. `ingest.ts` maps them onto `FlightRecord`s, merging with the stored row (never regressing status), and keeps per-minute counters. `consumer.ts` owns reconnects (1 s → 60 s backoff) over a small `SwimTransport` interface; `solace.ts` implements that interface with `solclientjs`, loaded only when `SWIM_ENABLED=true`. `scripts/swim-replay.ts` feeds a directory of recorded payloads through the same pipeline.

**Tech stack additions:** `fast-xml-parser` 5.11, `solclientjs` 10.18 (Solace's licence; CommonJS, default import only).

**Spec:** §6.2 (connection, prefilter, parsing, retention, health), §10 (SWIM rows), §11 (SFDPS parser, lifecycle, replay).

## Facts the code relies on (from the FIXM 3.0 schema, FAA SWIM briefings and the real samples)

- Payload root is `{http://www.faa.aero/nas/3.0}MessageCollection` with 1..n `message/flight`, or (older) a single `NasFlight`. Only the root is namespaced and prefixes vary between payloads, so the parser strips prefixes and matches local names.
- `flight/@source` is the ERAM message type. A batch can mix types, so filtering happens per `flight`.
- Paths: `gufi` (text), `flightIdentification/@aircraftIdentification`, `departure/@departurePoint`, `arrival/@arrivalPoint`, `agreed/route/@nasRouteText`, `aircraftDescription/aircraftType/icaoModelIdentifier`, `departure|arrival/runwayPositionAndTime/runwayTime/{estimated,actual}/@time`, `coordination/@coordinationTime` (+ `@coordinationTimeHandling` P/D/E), `flightStatus/@fdpsFlightStatus` (PROPOSED, ACTIVE, COMPLETED, CANCELLED, DROPPED), `flight/@timestamp`.
- Kept sources: `FH` flight plan, `AH` amendment, `HU` update, `DH` departure, `HV` arrival, `CL` cancellation, `RH` drop track, `IH` aircraft-ID amendment. Everything else (`TH` tracks above all, `HZ`, `HP`, `LH`, `OH`, …) is dropped.

## Interpretations (spec gaps, decided here)

1. **Status mapping:** PROPOSED → `filed`, ACTIVE → `active`, COMPLETED → `arrived`, CANCELLED → `cancelled`, DROPPED → `arrived` (updates stopped: left FAA airspace or went VFR; leaving it `active` would beat tomorrow's plan for the same callsign for 36 h). Without a status, the source decides (`DH` → active, `HV`/`RH` → arrived, `CL` → cancelled), else the stored status, else `filed`.
2. **Status never regresses** (filed < cancelled < active < arrived), because batches can arrive out of order.
3. **ETD** = `departure/.../estimated`, else a proposed (`P`) coordination time. **ATD** = `departure/.../actual`, else the message time of a `DH`. **ATA** = `arrival/.../actual`, else the message time of an `HV`/`RH`.
4. **`amended_at`** = the message timestamp of `AH` and `IH` messages.
5. **Counters are per payload** (one SCDS message): *kept* when at least one flight was upserted, *dropped* otherwise (prefiltered, or no kept flight inside). `lastMessageAt` is the time of the last kept payload; `degraded: "swim_delayed"` (Plan 2) uses it with a grace period from consumer start.
6. **Acknowledge every message**, including ones that fail to parse: a poison message must not stall the queue. Parse failures are counted and logged (first 200 characters).
7. **Recording:** `SWIM_RECORD_DIR` writes every kept payload to disk for replay and future fixtures.

## File structure

| File | Responsibility |
|---|---|
| `server/swim/prefilter.ts` | `KEPT_SOURCES`, `mayContainKept(raw)` |
| `server/swim/parse.ts` | `SfdpsFlight`, `parseSfdps(xml)` |
| `server/swim/ingest.ts` | `RateCounter`, `toFlightRecord()`, `SwimIngest` |
| `server/swim/consumer.ts` | `SwimTransport`, `SwimConsumer` (backoff, ack, counters → `SwimStatus`) |
| `server/swim/solace.ts` | `solaceTransportFactory(cfg)`, `payloadOf(message)` |
| `server/swim/fixtures/nasa-race/` | Real TH payloads + Apache-2.0 licence and attribution |
| `server/swim/fixtures/synthetic/` | FH/AH/DH/HV/CL lifecycle payloads (schema-shaped) |
| `scripts/swim-replay.ts` | `npm run swim:replay -- <dir> [--db path]` |
| `server/config.ts`, `server/main.ts` | `SCDS_*` settings; consumer wiring when `SWIM_ENABLED=true` |

## Tasks

- [x] **Task 1 — Prefilter and parser.** Tests: real TH batches are dropped by the prefilter; the parser reads all 36 real messages with differing prefixes and both root shapes, tolerates missing gufi/status/airports, and extracts every field from the synthetic FH.
- [x] **Task 2 — Ingest pipeline.** Tests: status mapping and non-regression; the lifecycle filed → amended → departed → arrived → purged against an in-memory store; a cancellation; per-minute counters.
- [x] **Task 3 — Consumer.** Tests with a fake transport: messages are ingested and acknowledged (also when parsing fails); reconnects back off 1, 2, 4 … 60 s and reset after a good connection; status reports connection, rates and reconnects. `payloadOf` reads XML content, text and binary attachments.
- [x] **Task 4 — Wiring and replay.** `SWIM_ENABLED=true` + `SCDS_*` starts the consumer and feeds `/api/health`; `npm run swim:replay -- server/swim/fixtures/synthetic` fills the table.

## Acceptance

    npm test && npm run typecheck
    npm run swim:replay -- server/swim/fixtures/synthetic --db data/replay.db
    SWIM_ENABLED=true SCDS_URL=… SCDS_VPN=… SCDS_USERNAME=… SCDS_PASSWORD=… SCDS_QUEUE=… npm start   # once SCDS access exists
