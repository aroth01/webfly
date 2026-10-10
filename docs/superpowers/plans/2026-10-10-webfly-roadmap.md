# WebFly Implementation Roadmap

**Spec:** `docs/superpowers/specs/2026-10-10-webfly-nd-tracker-design.md`

The spec covers five subsystems, so the work is split into five plans. Each plan ends with working, tested software. Each plan after the first is written just before it is executed, so it can build on what the previous plan actually produced: real interfaces, real data quirks, and the state of FAA SCDS access.

Plans are numbered in execution order.

| # | Plan | Spec sections | Deliverable you can try | Depends on | Status |
|---|---|---|---|---|---|
| 1 | **Nav core** | §5.1 `shared/`, `navdata/`, `server/route/`; §6.1; §6.3; §11 decoder tests | `npm run navdata:build`, then `npm run decode -- "<route>"` prints decoded points. Corpus test ≥ 99% | — | **Done:** `2026-10-10-webfly-plan-1-nav-core.md` (corpus 99.38% on cycle 2610) |
| 2 | **API server** | §5.1 `server/resolve`, `server/live`, `server/api`; §6.2 schema; §6.4; §6.5; §7; §8; §10 server rows | `npm run dev:server` answers `/api/flight/AA558` (from seeded flight plans), `/api/live/AAL558` (real adsb.lol data), `/api/trail`, `/api/nav` tiles and `/api/health` | 1 | **Done:** `2026-10-10-webfly-plan-2-api-server.md` |
| 3 | **ND client** | §9 (all); §10 client rows; §11 visual regression | Vite dev server on a phone: input screen → live ARC-mode ND against the Plan 2 API | 2 | To be written |
| 4 | **SWIM ingest** | §6.2 consumer, prefilter, purge, health counters; §11 SFDPS parser and replay | `npm run swim:replay <dir>` fills the flights table from recorded SFDPS messages; with SCDS credentials, the live consumer connects and stays current | 2; **FAA SCDS access** (or official SFDPS sample messages) | To be written once SCDS access or samples are in hand |
| 5 | **Deploy and ops** | §5 machine; §6.1 runtime cycle update; §12 | `fly deploy` → the public URL works on a phone; the NASR cycle self-updates; `/api/health` is green | 3 (and 4 for filed routes) | To be written |

## Notes

- **Plan 4 is gated on FAA access.** Until it lands, Plans 2, 3 and 5 still produce a working app: flights resolve through seeded plans in development, and through the §6.5 fallback (expected route) in production.
- **Start the SCDS sign-up now** (spec §14). It has the longest lead time of anything on this list.
- **Plan 2 will extend `NavDb`** with a spatial tile query for `/api/nav/:cycle/:lat/:lon` (spec §8). Plan 1 deliberately leaves that out.
