# WebFly

A free, mobile-first flight tracker that draws a flight's filed route and live position on an Airbus-style Navigation Display (ARC mode).

- Design spec: `docs/superpowers/specs/2026-10-10-webfly-nd-tracker-design.md`
- Implementation plans: `docs/superpowers/plans/`

## Setup

Requires Node.js 22.13 or newer (`node:sqlite`).

    npm install
    npm run navdata:build        # downloads the current FAA NASR cycle into data/
    npm test                     # unit tests + preferred-route corpus test
    npm run typecheck

## Run it locally

    npm run seed                 # sample flight plans into data/flights.db
    npm run dev:server           # API on http://localhost:8787
    npm run dev:web              # Vite on http://localhost:5173, proxies /api to the server

Open `/f/AA558`, or `/f/AA558?fixture` to run the ND on canned data without the API.
`npm run build:web && npm start` serves the SPA and the API from one process.

## Filed routes (FlightAware AeroAPI)

Create an AeroAPI key, copy `env.example` to `.env` and set `AEROAPI_KEY`. The server then fetches each looked-up
flight's filed route (cached 2 min per callsign, at most 8 calls/min, paused 60 s after a 429) and stores it in
SQLite. On Fly, use `fly secrets set AEROAPI_KEY=...`. The Personal tier is licensed for personal use only, so keep
the deployment private.

## Access control

With `ACCESS_CODE` set, `/api/*` (except `/api/health` and `/api/auth`) needs a session: the web app asks for the
code once and the server sets a signed, HttpOnly, SameSite=Strict cookie (30 days). Wrong guesses are limited to
5 per minute per IP. Independently, cross-site browser requests are rejected. In production the server refuses to
start without `ACCESS_CODE` unless `ALLOW_PUBLIC=1`. Without a code (local dev) the API is open.

## Deploy (Fly.io)

    fly apps create <name> && fly volumes create webfly_data --size 1 --region iad
    fly deploy

The image bakes in the NASR cycle current at build time; the server then checks daily for a new cycle and
swaps it in at 0901Z on its effective date. `/api/health` reports the nav cycle and the last update error.
Set secrets first: `fly secrets set ACCESS_CODE=... SESSION_SECRET=$(openssl rand -hex 32) AEROAPI_KEY=...`.

## Try the route decoder

    npm run decode -- "KDFW.AKUNA9.MLC..SGF.WELTS.TRTLL6.KORD"

## Data sources

- FAA NASR 28-day subscription (public domain): airports, navaids, fixes, airways, SIDs/STARs, preferred routes.
