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

## Run the API server

    npm run dev:server           # http://localhost:8080, seeded with development flight plans

    curl localhost:8080/api/flight/AA558      # FlightView (seeded plan, filed route decoded)
    curl localhost:8080/api/flight/UA5000     # pick list: two operators fly this number
    curl localhost:8080/api/live/AAL558       # live position + traffic from adsb.lol
    curl localhost:8080/api/nav/2610/32/-98   # nav tile (navaids, airports), immutable
    curl localhost:8080/api/health

A flight that is airborne right now but has no stored plan resolves through adsb.lol (spec §6.5).

Environment: `PORT` (8080), `DATA_DIR` (`data`), `FLIGHTS_DB` (`$DATA_DIR/flights.db`), `CONTACT_URL` (sent to adsb.lol in the User-Agent).

## Data sources

- FAA NASR 28-day subscription (public domain): airports, navaids, fixes, airways, SIDs/STARs, preferred routes.
- [adsb.lol](https://adsb.lol) (ODbL): live positions, traffic and trails.
