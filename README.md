# WebFly

A free, mobile-first flight tracker that draws a flight's filed route and live position on an Airbus-style Navigation Display (ARC mode).

- Design spec: `docs/superpowers/specs/2026-10-10-webfly-nd-tracker-design.md`
- Implementation plans: `docs/superpowers/plans/`

## Setup

Requires Node.js 22 or newer.

    npm install
    npm run navdata:build        # downloads the current FAA NASR cycle into data/
    npm test                     # unit tests + preferred-route corpus test
    npm run typecheck

## Try the route decoder

    npm run decode -- "KDFW.AKUNA9.MLC..SGF.WELTS.TRTLL6.KORD"

## Run the app

    npm run dev:server -- --sim  # terminal 1: API on :8080, seeded flights flying simulated positions
    npm run dev:web              # terminal 2: http://localhost:5173 (also served on your LAN, for a phone)

Type `AA558` (an active seeded flight), `UA5000` (a pick list) or `DL1234` (not yet departed: no position). Without `--sim`, live positions come from adsb.lol, so only flights that are really airborne move.

## Run the API server

    npm run dev:server           # http://localhost:8080, seeded with development flight plans

    curl localhost:8080/api/flight/AA558      # FlightView (seeded plan, filed route decoded)
    curl localhost:8080/api/flight/UA5000     # pick list: two operators fly this number
    curl localhost:8080/api/live/AAL558       # live position + traffic from adsb.lol
    curl localhost:8080/api/nav/2610/32/-98   # nav tile (navaids, airports), immutable
    curl localhost:8080/api/health

A flight that is airborne right now but has no stored plan resolves through adsb.lol (spec §6.5).

Environment: `PORT` (8080), `DATA_DIR` (`data`), `FLIGHTS_DB` (`$DATA_DIR/flights.db`), `CONTACT_URL` (sent to adsb.lol in the User-Agent).

## Filed routes from FAA SWIM

Filed routes come from the FAA SWIM SFDPS feed through SCDS (spec §6.2). Without SCDS credentials the app still works: flights resolve through the adsb.lol fallback (expected route).

    npm run swim:replay -- server/swim/fixtures/synthetic --db data/replay.db   # replay recorded payloads

With an SCDS subscription:

    SWIM_ENABLED=true SCDS_URL=tcps://… SCDS_VPN=… SCDS_USERNAME=… SCDS_PASSWORD=… SCDS_QUEUE=… npm start

Set `SWIM_RECORD_DIR=data/swim-recordings` to keep every payload that updated a flight, for replay and test fixtures. `/api/health` reports the connection, kept/dropped messages per minute and reconnects.

## Deploy to Fly.io

The image bundles the server, the built web app and the NASR cycle in force at build time (`Dockerfile`); `fly.toml` runs one always-on `shared-cpu-1x` machine with a 1 GB volume at `/data` for the flight-plan database and newer nav cycles.

    fly launch --no-deploy --copy-config --name <your-app>   # app names are global; fly.toml says "webfly"
    fly volumes create webfly_data --size 1 --region iad
    fly deploy
    curl https://<your-app>.fly.dev/api/health

Once SCDS credentials exist: `fly secrets set SCDS_URL=… SCDS_VPN=… SCDS_USERNAME=… SCDS_PASSWORD=… SCDS_QUEUE=…`, set `SWIM_ENABLED = "true"` in `fly.toml`, and `fly deploy` again.

Operations:

- `/api/health`: SWIM connection and message rates, the loaded nav cycle, the last NASR update check and its error (if any), stored flights, uptime.
- The NASR cycle updates itself: a minute after boot and then daily, a newly effective cycle is built in a child process and swapped in without a restart. A failure keeps the current cycle and retries the next day.
- Flight plans older than 36 h are purged hourly.
- `fly logs` shows SWIM reconnects, unresolved route tokens and nav updates.

## Visual regression tests

    npx playwright install chromium    # once; or point PLAYWRIGHT_CHROMIUM_EXECUTABLE at an installed Chromium
    npm run test:visual                # ND screenshots at 390×844 against web/e2e/__screenshots__/
    npm run test:visual -- --update-snapshots

The tests serve fixed API responses from `web/e2e/fixtures/` with a frozen clock. Regenerate the fixtures after API changes with `npx tsx scripts/make-e2e-fixtures.ts` (needs the built nav data).

## Data sources

- FAA NASR 28-day subscription (public domain): airports, navaids, fixes, airways, SIDs/STARs, preferred routes.
- [adsb.lol](https://adsb.lol) (ODbL): live positions, traffic and trails.
