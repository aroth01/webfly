# WebFly Plan 5 — Deploy and Ops Implementation Plan

**Goal:** One Docker image and one always-on Fly.io machine serving the web app and the API, with the NASR cycle baked in at build time and self-updating every 28 days, and a health endpoint Fly can check.

**Architecture:** The API server also serves `web/dist` (hashed assets cached forever, a deep-link fallback to `index.html`, gzip, standard security headers). `navdata/fetch.ts` is the build logic shared by the CLI and `navdata/update.ts`, which checks daily for a newly effective cycle, builds it in a child process into `/data/nasr`, and swaps the in-memory `NavDb` behind the `() => nav` getter every consumer already uses. A multi-stage Dockerfile builds the SPA, bakes the current cycle and prunes to production dependencies; `fly.toml` runs one `shared-cpu-1x`/1 GB machine with a 1 GB volume at `/data`.

**Spec:** §5 (machine), §6.1 (runtime cycle update), §12 (deployment).

## Interpretations (spec gaps, decided here)

1. **"Checks the FAA page"** is done by date: NASR cycles are exactly 28 days apart (Plan 1's `cycleFor`), so once the date reaches a cycle newer than the loaded one, the updater downloads that cycle's zips. If they aren't posted yet or the download fails, the current cycle stays and the next check retries. The first check runs a minute after boot, because an old image may boot with an old baked-in cycle, then daily.
2. **The build runs in a child process.** Parsing the CSVs peaks near 300 MB RSS (measured); a child returns that memory to the OS when it exits and can't take the server down. Downloaded zips are deleted after each build, and the volume keeps the two newest nav files.
3. **Failures surface in `/api/health`** as `navUpdate.lastError` with `lastCheckAt`; `/api/health` still answers 200 so Fly doesn't restart a machine that is serving fine.
4. **Node 22.22 in the image** (the version everything was tested on) runs the TypeScript sources directly through type stripping, so there is no compile step and no `tsx` at runtime. Browser-only libraries are dev dependencies (Vite bundles them); production `node_modules` is ~27 MB.
5. **The container runs as root:** Fly volumes mount root-owned, and the VM is the isolation boundary.
6. **Verification without Docker or Fly:** the build environment has no Docker daemon and no Fly account, so the Dockerfile was verified by replaying its steps (clean context → `npm ci` → web build → baked cycle → prune → runtime file set booted against an empty volume). `fly deploy` itself is the owner's step.

## File structure

| File | Responsibility |
|---|---|
| `navdata/fetch.ts` | `buildCycle()` (atomic write), `dropCache()` |
| `navdata/build.ts` | CLI: `[cycle] [--out] [--cache] [--drop-cache]` |
| `navdata/update.ts` | `NavUpdater`, `buildInChildProcess()` |
| `server/api/static.ts` | `mountSpa()` |
| `server/api/app.ts` | + compression and security headers |
| `server/main.ts`, `server/config.ts` | Swappable nav DB, updater, SPA; `WEB_DIST`, `NAV_AUTO_UPDATE` |
| `Dockerfile`, `.dockerignore`, `fly.toml` | Image and machine |

## Tasks

- [x] **Task 1 — Reusable cycle build.** Tests: a fake FAA serves zips; the nav file is written atomically and loads; zips are downloaded once and can be dropped; an HTTP error leaves no file.
- [x] **Task 2 — Runtime self-update.** Tests: no work while current; after the effective date the new cycle is built, validated, swapped in (AIRAC `2611` for 2026-10-29) and old files pruned; a failed build keeps the current cycle and reports the error. Verified once for real: the child-process build downloads and builds cycle 2610 in under 5 s.
- [x] **Task 3 — Serve the web app.** Tests: immutable hashed assets, revalidated files, deep links answered with `index.html`, API routes untouched.
- [x] **Task 4 — Image and machine.** Dockerfile, `.dockerignore`, `fly.toml`; replayed build boots and serves `/`, `/f/:query`, `/api/health` and a live flight from an empty volume.

## Acceptance (owner)

    fly launch --no-deploy --copy-config --name <app>
    fly volumes create webfly_data --size 1 --region iad
    fly deploy
    curl https://<app>.fly.dev/api/health
