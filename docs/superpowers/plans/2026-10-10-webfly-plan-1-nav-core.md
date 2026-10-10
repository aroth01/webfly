# WebFly Plan 1 — Nav Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the navigation-data core of WebFly: a TypeScript project scaffold, geodesy helpers, a pipeline that turns the FAA's 28-day NASR CSV subscription into a compact in-memory nav database, and a route decoder that turns filed route strings (NAS, ICAO or FAA preferred-route format) into ordered lat/lon points — proven against the FAA's ~13,000 published preferred routes.

**Architecture:** One ESM TypeScript package run with `tsx` (no compile step). `navdata/` downloads and parses NASR CSVs into `data/nasr-<cycle>.json.gz` and indexes it in a `NavDb` class. `server/route/` tokenizes and decodes route strings against a `NavDb`. `shared/` holds code the browser will also use later (geo math, `RoutePoint`). Nothing in this plan needs the network except the explicit build command.

**Tech Stack:** Node.js ≥ 22 (developed on 24), TypeScript 7, Vitest 5, tsx 4, csv-parse 7, fflate 0.8.

**Spec:** `docs/superpowers/specs/2026-10-10-webfly-nd-tracker-design.md` (sections §5.1, §6.1, §6.3, §8 `RoutePoint`, §10, §11). Roadmap of all plans: `docs/superpowers/plans/2026-10-10-webfly-roadmap.md`.

## Global Constraints

- Node.js `>=22` (`engines` in package.json); ESM only (`"type": "module"`); relative imports use explicit `.ts` extensions.
- TypeScript `strict: true`; `tsc --noEmit` must pass after every task (`npm run typecheck`).
- Install dependencies with a **single** `npm install` after writing package.json. Installing runtime and dev dependencies in two separate commands can drop Vitest's native bundler binary (error: `Cannot find module './rolldown-binding...'`); the fix is `rm -rf node_modules package-lock.json && npm install`.
- Nav data source: FAA NASR CSV zips at `https://nfdc.faa.gov/webContent/28DaySub/extra/<DD>_<Mon>_<YYYY>_<CAT>_CSV.zip`, categories `APT`, `NAV`, `FIX`, `AWY`, `DP`, `STAR`, `PFR` (spec §6.1). Built output: `data/nasr-<YYYY-MM-DD>.json.gz` (git-ignored).
- NASR cycles are 28 days apart; 2026-10-01 is a known effective date.
- `RoutePoint` shape is fixed by spec §8: `{ ident, lat, lon, kind: 'airport' | 'navaid' | 'fix' | 'latlon' | 'frd', via? }`.
- Duplicate idents resolve to the candidate nearest the previous route point (spec §6.3).
- Zig-zag guard threshold: 300 nm (spec §6.3).
- Corpus acceptance: ≥ 99% of preferred routes between known airports decode with no unresolved tokens and no zig-zag drops (spec §11; measured 99.38% on cycle 2026-10-01).
- Every commit message ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

The spec implies these inputs but its own examples never show them; each now has a pinning test in the owning task:

1. **SID filed with an exit fix that is not one of its transitions** (`KAAA DEPRT1 WPT1 KBBB`) → fly the SID body only, then go direct. Test in Task 6.
2. **STAR entered from a fix that is not one of its transitions** (`KAAA WPT2 ARRVL2 KBBB`) → fly the STAR body only. Test in Task 6.
3. **Airway whose exit fix is not on it, or an airway as the last token** (`KAAA VRA J1 STRT1 KBBB`, `KAAA VRA J1`) → report the airway as unresolved and continue; never throw. Tests in Task 6.
4. **Procedure filed with an outdated version digit** (`AKUNA8` when NASR has `AKUNA9`) → use the current version. Tests in Task 3 and Task 6.
5. **Dates before the reference cycle** (negative cycle index, e.g. 2026-09-30) → the earlier cycle 2026-09-03, not a crash or a future cycle. Test in Task 4.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts`, `.nvmrc`, `.gitignore` | Project config |
| `shared/geo.ts` | Great-circle distance, bearing, destination point, cross-track distance |
| `shared/types.ts` | Types shared with the future browser client (`RoutePoint`) |
| `navdata/types.ts` | Nav data record types and the `NavDataFile` container |
| `navdata/csv.ts` | NASR CSV text → row objects |
| `navdata/parse.ts` | Row objects → typed records (airports, navaids, fixes, airways, SIDs/STARs, preferred routes) |
| `navdata/navdb.ts` | `NavDb`: in-memory indexes and lookups over a `NavDataFile` |
| `navdata/cycle.ts` | 28-day cycle math and FAA download URLs |
| `navdata/assemble.ts` | All CSV texts → one `NavDataFile` |
| `navdata/load.ts` | Find/load `data/nasr-*.json.gz` into a `NavDb` |
| `navdata/build.ts` | CLI: download a cycle's zips, assemble, write `data/nasr-<cycle>.json.gz` |
| `server/route/tokenize.ts` | Route text → tokens |
| `server/route/decode.ts` | Tokens + `NavDb` → `RoutePoint[]` with unresolved/dropped reporting |
| `server/route/corpus.test.ts` | Decodes every FAA preferred route in the built cycle |
| `scripts/decode.ts` | CLI: decode a route string and print a table |
| `README.md` | Setup and commands |

---

### Task 1: Project scaffold and geo math

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.nvmrc`
- Modify: `.gitignore` (append `.cache/`)
- Create: `shared/geo.ts`
- Test: `shared/geo.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (`shared/geo.ts`): `EARTH_RADIUS_NM: number`; `interface LatLon { lat: number; lon: number }`; `normalizeDeg(deg: number): number`; `distanceNm(a: LatLon, b: LatLon): number`; `bearingDeg(a: LatLon, b: LatLon): number`; `destinationPoint(from: LatLon, bearing: number, distNm: number): LatLon`; `crossTrackNm(p: LatLon, a: LatLon, b: LatLon): number`.

- [ ] **Step 1: Create the project config**

`package.json`:

```json
{
  "name": "webfly",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "navdata:build": "tsx navdata/build.ts",
    "decode": "tsx scripts/decode.ts"
  },
  "dependencies": {
    "csv-parse": "^7.0.3",
    "fflate": "^0.8.3"
  },
  "devDependencies": {
    "@types/node": "^24.19.2",
    "tsx": "^4.23.15",
    "typescript": "^7.0.2",
    "vitest": "^5.0.3"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["es2023"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["shared", "navdata", "server", "scripts"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
  },
});
```

`.nvmrc`:

```
24
```

Append to `.gitignore`:

```
.cache/
```

Then install (one command — see Global Constraints):

Run: `npm install`
Expected: `added N packages`, and `ls node_modules/@rolldown` lists a `binding-<platform>` directory.

- [ ] **Step 2: Write the failing test**

`shared/geo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { bearingDeg, crossTrackNm, destinationPoint, distanceNm, normalizeDeg } from './geo.ts';

const DFW = { lat: 32.89723305, lon: -97.03769472 };
const LAX = { lat: 33.94249638, lon: -118.40804861 };

describe('geo', () => {
  it('normalizes angles into [0, 360)', () => {
    expect(normalizeDeg(-90)).toBe(270);
    expect(normalizeDeg(450)).toBe(90);
    expect(normalizeDeg(360)).toBe(0);
  });

  it('measures one degree of longitude at the equator as ~60.04 nm', () => {
    expect(distanceNm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(60.0405, 3);
  });

  it('measures DFW to LAX', () => {
    expect(distanceNm(DFW, LAX)).toBeCloseTo(1070.84, 1);
    expect(bearingDeg(DFW, LAX)).toBeCloseTo(279.25, 1);
  });

  it('gives cardinal bearings', () => {
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0, 6);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 6);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: -1, lon: 0 })).toBeCloseTo(180, 6);
  });

  it('round-trips destinationPoint with bearing and distance', () => {
    const p = destinationPoint(DFW, bearingDeg(DFW, LAX), distanceNm(DFW, LAX));
    expect(p.lat).toBeCloseTo(LAX.lat, 6);
    expect(p.lon).toBeCloseTo(LAX.lon, 6);
  });

  it('wraps longitude across the antimeridian', () => {
    const p = destinationPoint({ lat: 0, lon: 179.9 }, 90, 60.0405);
    expect(p.lon).toBeCloseTo(-179.1, 3);
  });

  it('measures cross-track distance from a great circle', () => {
    expect(crossTrackNm({ lat: 1, lon: 0.5 }, { lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(60.04, 1);
    expect(crossTrackNm({ lat: 0, lon: 0.5 }, { lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(0, 6);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run shared/geo.test.ts`
Expected: FAIL — Vitest reports it cannot resolve/load `./geo.ts`.

- [ ] **Step 4: Write the implementation**

`shared/geo.ts`:

```ts
export const EARTH_RADIUS_NM = 3440.065;

export interface LatLon {
  lat: number;
  lon: number;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Wrap any angle into [0, 360). */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Great-circle distance in nautical miles (haversine). */
export function distanceNm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial true bearing from a to b, degrees in [0, 360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return normalizeDeg(toDeg(Math.atan2(y, x)));
}

/** Point reached from `from` after travelling `distNm` on initial true bearing `bearing`. */
export function destinationPoint(from: LatLon, bearing: number, distNm: number): LatLon {
  const la1 = toRad(from.lat);
  const lo1 = toRad(from.lon);
  const brg = toRad(bearing);
  const dr = distNm / EARTH_RADIUS_NM;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(dr) + Math.cos(la1) * Math.sin(dr) * Math.cos(brg));
  const lo2 =
    lo1 + Math.atan2(Math.sin(brg) * Math.sin(dr) * Math.cos(la1), Math.cos(dr) - Math.sin(la1) * Math.sin(la2));
  return { lat: toDeg(la2), lon: ((toDeg(lo2) + 540) % 360) - 180 };
}

/** Unsigned distance (nm) of point p from the great circle through a and b. */
export function crossTrackNm(p: LatLon, a: LatLon, b: LatLon): number {
  const d13 = distanceNm(a, p) / EARTH_RADIUS_NM;
  const t13 = toRad(bearingDeg(a, p));
  const t12 = toRad(bearingDeg(a, b));
  return Math.abs(Math.asin(Math.sin(d13) * Math.sin(t13 - t12)) * EARTH_RADIUS_NM);
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run shared/geo.test.ts && npm run typecheck`
Expected: PASS — 7 tests pass; `tsc` prints nothing and exits 0.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .nvmrc .gitignore shared/geo.ts shared/geo.test.ts
git commit -m "chore: scaffold TypeScript project with geo math" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: NASR CSV reader and record parsers

**Files:**
- Create: `navdata/types.ts`, `navdata/csv.ts`, `navdata/parse.ts`
- Test: `navdata/csv.test.ts`, `navdata/parse.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `navdata/types.ts`: `AirportRec`, `NavaidType`, `NavaidRec`, `FixRec`, `AirwayRec`, `ProcRec`, `PrefRouteRec`, `NavDataFile` (exact fields below).
  - `navdata/csv.ts`: `type Row = Record<string, string>`; `readCsv(text: string): Row[]`.
  - `navdata/parse.ts`: `parseAirports(base: Row[], runways: Row[]): AirportRec[]`; `parseNavaids(rows: Row[]): NavaidRec[]`; `parseFixes(rows: Row[]): FixRec[]`; `parseAirways(rows: Row[]): AirwayRec[]`; `parseProcedures(rows: Row[], kind: 'SID' | 'STAR'): ProcRec[]`; `parsePrefRoutes(rows: Row[]): PrefRouteRec[]`.

Background the implementer needs (verified against the 2026-10-01 files):
- Column names are exact NASR CSV headers (`ARPT_ID`, `LAT_DECIMAL`, `AIRWAY_STRING`, …). Files are plain ASCII with every value quoted except numbers.
- `AWY_BASE.csv` already lists each airway's points in order in `AIRWAY_STRING`.
- SID computer codes are `PROC#.TRANSITION` (`AKUNA9.MLC`); STAR codes are reversed, `TRANSITION.PROC#` (`CGNEY.ANJLL4`). Points are in flight order by `POINT_SEQ`.
- A SID has one BODY route per runway group, all converging on the same exit fix, so keep their **common suffix**. A STAR's bodies share a start and diverge toward runways, so keep their **common prefix**. The runway in use is unknown to us.

- [ ] **Step 1: Write the types**

`navdata/types.ts`:

```ts
export interface AirportRec {
  id: string; // FAA location id, e.g. "DFW"
  icao?: string; // e.g. "KDFW"
  name: string;
  lat: number;
  lon: number;
  rwyFt: number; // longest runway length, feet (0 if none)
  pub: boolean; // public use
}

export type NavaidType = 'VOR' | 'VOR/DME' | 'VORTAC' | 'TACAN' | 'DME' | 'NDB' | 'NDB/DME';

export interface NavaidRec {
  id: string;
  type: NavaidType;
  name: string;
  lat: number;
  lon: number;
  varDeg: number; // magnetic variation, east positive
}

export interface FixRec {
  id: string;
  lat: number;
  lon: number;
}

export interface AirwayRec {
  id: string; // "J52", "V16", "Q30"
  loc: string; // "C" contiguous US, "A" Alaska, "H" Hawaii
  pts: string[]; // ordered point idents
}

export interface ProcRec {
  name: string; // "AKUNA9" (SID) or "ANJLL4" (STAR)
  kind: 'SID' | 'STAR';
  airports: string[]; // FAA ids served
  body: string[]; // runway-independent part of the body, in flight order
  transitions: Record<string, string[]>; // transition fix -> points in flight order
}

export interface PrefRouteRec {
  orig: string;
  dest: string;
  type: string; // "H", "L", "TEC", "NAR", ...
  route: string; // space separated, includes orig and dest
}

export interface NavDataFile {
  cycle: string; // "2026-10-01"
  airports: AirportRec[];
  navaids: NavaidRec[];
  fixes: FixRec[];
  airways: AirwayRec[];
  procs: ProcRec[];
  prefRoutes: PrefRouteRec[];
}
```

- [ ] **Step 2: Write the failing tests**

`navdata/csv.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readCsv } from './csv.ts';

describe('readCsv', () => {
  it('parses quoted NASR-style CSV with empty and numeric fields', () => {
    const text = '"FIX_ID","LAT_DECIMAL","LONG_DECIMAL","REMARK"\n"AAALL",42.12018888,-71.14176111,""\n';
    expect(readCsv(text)).toEqual([
      { FIX_ID: 'AAALL', LAT_DECIMAL: '42.12018888', LONG_DECIMAL: '-71.14176111', REMARK: '' },
    ]);
  });
});
```

`navdata/parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseAirports, parseAirways, parseFixes, parseNavaids, parsePrefRoutes, parseProcedures } from './parse.ts';

describe('parseAirports', () => {
  const base = [
    { SITE_NO: '23710.6', SITE_TYPE_CODE: 'A', ARPT_STATUS: 'O', ARPT_ID: 'DFW', ICAO_ID: 'KDFW', ARPT_NAME: 'DALLAS-FORT WORTH INTL', LAT_DECIMAL: '32.89723305', LONG_DECIMAL: '-97.03769472', FACILITY_USE_CODE: 'PU' },
    { SITE_NO: '00106.', SITE_TYPE_CODE: 'A', ARPT_STATUS: 'O', ARPT_ID: '2A8', ICAO_ID: '', ARPT_NAME: 'ADDISON', LAT_DECIMAL: '34.21714166', LONG_DECIMAL: '-87.15815833', FACILITY_USE_CODE: 'PR' },
    { SITE_NO: '99999.', SITE_TYPE_CODE: 'H', ARPT_STATUS: 'O', ARPT_ID: 'XH1', ICAO_ID: '', ARPT_NAME: 'SOME HELIPORT', LAT_DECIMAL: '30', LONG_DECIMAL: '-90', FACILITY_USE_CODE: 'PR' },
    { SITE_NO: '88888.', SITE_TYPE_CODE: 'A', ARPT_STATUS: 'CI', ARPT_ID: 'XC1', ICAO_ID: '', ARPT_NAME: 'CLOSED', LAT_DECIMAL: '30', LONG_DECIMAL: '-90', FACILITY_USE_CODE: 'PU' },
  ];
  const rwys = [
    { SITE_NO: '23710.6', RWY_LEN: '13401' },
    { SITE_NO: '23710.6', RWY_LEN: '8500' },
    { SITE_NO: '00106.', RWY_LEN: '2644' },
  ];

  it('keeps operational airports with longest runway and ICAO id', () => {
    expect(parseAirports(base, rwys)).toEqual([
      { id: 'DFW', icao: 'KDFW', name: 'DALLAS-FORT WORTH INTL', lat: 32.89723305, lon: -97.03769472, rwyFt: 13401, pub: true },
      { id: '2A8', name: 'ADDISON', lat: 34.21714166, lon: -87.15815833, rwyFt: 2644, pub: false },
    ]);
  });
});

describe('parseNavaids', () => {
  it('keeps navigational types, drops shutdown, signs variation', () => {
    const rows = [
      { NAV_ID: 'ABI', NAV_TYPE: 'VORTAC', NAV_STATUS: 'OPERATIONAL IFR', NAME: 'ABILENE', LAT_DECIMAL: '32.48', LONG_DECIMAL: '-99.86', MAG_VARN: '10', MAG_VARN_HEMIS: 'E' },
      { NAV_ID: 'AA', NAV_TYPE: 'NDB', NAV_STATUS: 'OPERATIONAL IFR', NAME: 'KENIE', LAT_DECIMAL: '47.0', LONG_DECIMAL: '-96.8', MAG_VARN: '4', MAG_VARN_HEMIS: 'W' },
      { NAV_ID: 'OLD', NAV_TYPE: 'VOR', NAV_STATUS: 'SHUTDOWN', NAME: 'X', LAT_DECIMAL: '1', LONG_DECIMAL: '1', MAG_VARN: '', MAG_VARN_HEMIS: '' },
      { NAV_ID: 'VT1', NAV_TYPE: 'VOT', NAV_STATUS: 'OPERATIONAL IFR', NAME: 'X', LAT_DECIMAL: '1', LONG_DECIMAL: '1', MAG_VARN: '', MAG_VARN_HEMIS: '' },
    ];
    expect(parseNavaids(rows)).toEqual([
      { id: 'ABI', type: 'VORTAC', name: 'ABILENE', lat: 32.48, lon: -99.86, varDeg: 10 },
      { id: 'AA', type: 'NDB', name: 'KENIE', lat: 47.0, lon: -96.8, varDeg: -4 },
    ]);
  });
});

describe('parseFixes', () => {
  it('maps id and decimal coordinates', () => {
    expect(parseFixes([{ FIX_ID: 'AAALL', LAT_DECIMAL: '42.12018888', LONG_DECIMAL: '-71.14176111' }])).toEqual([
      { id: 'AAALL', lat: 42.12018888, lon: -71.14176111 },
    ]);
  });
});

describe('parseAirways', () => {
  it('splits the ordered airway string', () => {
    expect(parseAirways([{ AWY_ID: 'J52', AWY_LOCATION: 'C', AIRWAY_STRING: 'CFDDH SHUKA  CASCD' }])).toEqual([
      { id: 'J52', loc: 'C', pts: ['CFDDH', 'SHUKA', 'CASCD'] },
    ]);
  });
});

describe('parseProcedures', () => {
  it('builds a SID: common body suffix plus exit transitions', () => {
    const r = (ROUTE_PORTION_TYPE: string, ROUTE_NAME: string, TRANSITION_COMPUTER_CODE: string, POINT_SEQ: string, POINT: string, ARPT_RWY_ASSOC = '') => ({
      DP_COMPUTER_CODE: 'AKUNA9.AKUNA', ROUTE_PORTION_TYPE, ROUTE_NAME, BODY_SEQ: '1', TRANSITION_COMPUTER_CODE, POINT_SEQ, POINT, ARPT_RWY_ASSOC,
    });
    const rows = [
      r('BODY', 'BPARK-AKUNA', '', '20', 'YAMEL', 'DFW/18L, DFW/18R'),
      r('BODY', 'BPARK-AKUNA', '', '10', 'BPARK', 'DFW/18L, DFW/18R'),
      r('BODY', 'BPARK-AKUNA', '', '30', 'AKUNA', 'DFW/18L, DFW/18R'),
      r('BODY', 'CUZEN-AKUNA', '', '10', 'CUZEN', 'DFW/35C'),
      r('BODY', 'CUZEN-AKUNA', '', '20', 'AKUNA', 'DFW/35C'),
      r('TRANSITION', 'MCALESTER TRANSITION', 'AKUNA9.MLC', '10', 'AKUNA'),
      r('TRANSITION', 'MCALESTER TRANSITION', 'AKUNA9.MLC', '30', 'MLC'),
      r('TRANSITION', 'MCALESTER TRANSITION', 'AKUNA9.MLC', '20', 'TIKYS'),
    ];
    expect(parseProcedures(rows, 'SID')).toEqual([
      { name: 'AKUNA9', kind: 'SID', airports: ['DFW'], body: ['AKUNA'], transitions: { MLC: ['AKUNA', 'TIKYS', 'MLC'] } },
    ]);
  });

  it('builds a STAR: entry transitions plus common body prefix', () => {
    const r = (ROUTE_PORTION_TYPE: string, ROUTE_NAME: string, TRANSITION_COMPUTER_CODE: string, POINT_SEQ: string, POINT: string, ARPT_RWY_ASSOC = '') => ({
      STAR_COMPUTER_CODE: 'ANJLL.ANJLL4', ROUTE_PORTION_TYPE, ROUTE_NAME, BODY_SEQ: '1', TRANSITION_COMPUTER_CODE, POINT_SEQ, POINT, ARPT_RWY_ASSOC,
    });
    const rows = [
      r('BODY', 'ANJLL-CRCUS', '', '10', 'ANJLL', 'LAX'),
      r('BODY', 'ANJLL-CRCUS', '', '20', 'CAANN', 'LAX'),
      r('BODY', 'ANJLL-CRCUS', '', '30', 'CRCUS', 'LAX'),
      r('TRANSITION', 'SALYY TRANSITION', 'SALYY.ANJLL4', '10', 'SALYY'),
      r('TRANSITION', 'SALYY TRANSITION', 'SALYY.ANJLL4', '20', 'GLESN'),
      r('TRANSITION', 'SALYY TRANSITION', 'SALYY.ANJLL4', '30', 'ANJLL'),
    ];
    expect(parseProcedures(rows, 'STAR')).toEqual([
      { name: 'ANJLL4', kind: 'STAR', airports: ['LAX'], body: ['ANJLL', 'CAANN', 'CRCUS'], transitions: { SALYY: ['SALYY', 'GLESN', 'ANJLL'] } },
    ]);
  });
});

describe('parsePrefRoutes', () => {
  it('maps the remote-format columns', () => {
    expect(parsePrefRoutes([{ Orig: 'DFW', Dest: 'ORD', Type: 'H', 'Route String': 'DFW AKUNA9 MLC SGF WELTS TRTLL6 ORD ' }])).toEqual([
      { orig: 'DFW', dest: 'ORD', type: 'H', route: 'DFW AKUNA9 MLC SGF WELTS TRTLL6 ORD' },
    ]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run navdata/csv.test.ts navdata/parse.test.ts`
Expected: FAIL — cannot resolve `./csv.ts` and `./parse.ts`.

- [ ] **Step 4: Write the implementation**

`navdata/csv.ts`:

```ts
import { parse } from 'csv-parse/sync';

export type Row = Record<string, string>;

/** Parse a NASR CSV file (header row + quoted values) into row objects. */
export function readCsv(text: string): Row[] {
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
  }) as Row[];
}
```

`navdata/parse.ts`:

```ts
import type { Row } from './csv.ts';
import type { AirportRec, AirwayRec, FixRec, NavaidRec, NavaidType, PrefRouteRec, ProcRec } from './types.ts';

const KEPT_NAVAID_TYPES = new Set<string>(['VOR', 'VOR/DME', 'VORTAC', 'TACAN', 'DME', 'NDB', 'NDB/DME']);

export function parseAirports(base: Row[], runways: Row[]): AirportRec[] {
  const longest = new Map<string, number>();
  for (const r of runways) {
    const len = Number(r.RWY_LEN) || 0;
    const site = r.SITE_NO ?? '';
    if (len > (longest.get(site) ?? 0)) longest.set(site, len);
  }
  return base
    .filter((r) => r.SITE_TYPE_CODE === 'A' && r.ARPT_STATUS === 'O')
    .map((r) => {
      const rec: AirportRec = {
        id: r.ARPT_ID ?? '',
        name: r.ARPT_NAME ?? '',
        lat: Number(r.LAT_DECIMAL),
        lon: Number(r.LONG_DECIMAL),
        rwyFt: longest.get(r.SITE_NO ?? '') ?? 0,
        pub: r.FACILITY_USE_CODE === 'PU',
      };
      if (r.ICAO_ID) rec.icao = r.ICAO_ID;
      return rec;
    });
}

export function parseNavaids(rows: Row[]): NavaidRec[] {
  return rows
    .filter((r) => r.NAV_STATUS !== 'SHUTDOWN' && KEPT_NAVAID_TYPES.has(r.NAV_TYPE ?? ''))
    .map((r) => ({
      id: r.NAV_ID ?? '',
      type: r.NAV_TYPE as NavaidType,
      name: r.NAME ?? '',
      lat: Number(r.LAT_DECIMAL),
      lon: Number(r.LONG_DECIMAL),
      varDeg: (Number(r.MAG_VARN) || 0) * (r.MAG_VARN_HEMIS === 'W' ? -1 : 1),
    }));
}

export function parseFixes(rows: Row[]): FixRec[] {
  return rows.map((r) => ({ id: r.FIX_ID ?? '', lat: Number(r.LAT_DECIMAL), lon: Number(r.LONG_DECIMAL) }));
}

export function parseAirways(rows: Row[]): AirwayRec[] {
  return rows.map((r) => ({
    id: r.AWY_ID ?? '',
    loc: r.AWY_LOCATION ?? '',
    pts: (r.AIRWAY_STRING ?? '').split(/\s+/).filter(Boolean),
  }));
}

/** Longest run of points shared by the end of every list (SID bodies converge on the exit fix). */
function commonSuffix(lists: string[][]): string[] {
  let common = lists[0] ?? [];
  for (const list of lists.slice(1)) {
    let k = 0;
    while (k < common.length && k < list.length && common[common.length - 1 - k] === list[list.length - 1 - k]) k++;
    common = common.slice(common.length - k);
  }
  return common;
}

/** Longest run of points shared by the start of every list (STAR bodies diverge toward runways). */
function commonPrefix(lists: string[][]): string[] {
  let common = lists[0] ?? [];
  for (const list of lists.slice(1)) {
    let k = 0;
    while (k < common.length && k < list.length && common[k] === list[k]) k++;
    common = common.slice(0, k);
  }
  return common;
}

/**
 * Build SIDs from DP_RTE rows or STARs from STAR_RTE rows.
 * SID computer codes are "PROC#.TRANSITION" (AKUNA9.MLC); STAR codes are "TRANSITION.PROC#" (CGNEY.ANJLL4).
 */
export function parseProcedures(rows: Row[], kind: 'SID' | 'STAR'): ProcRec[] {
  const codeCol = kind === 'SID' ? 'DP_COMPUTER_CODE' : 'STAR_COMPUTER_CODE';
  type Acc = { airports: Set<string>; bodies: Map<string, [number, string][]>; trans: Map<string, [number, string][]> };
  const byName = new Map<string, Acc>();

  for (const r of rows) {
    const code = (r[codeCol] ?? '').split('.');
    const name = (kind === 'SID' ? code[0] : code[1]) ?? '';
    if (!name) continue;
    let acc = byName.get(name);
    if (!acc) {
      acc = { airports: new Set(), bodies: new Map(), trans: new Map() };
      byName.set(name, acc);
    }
    const seq = Number(r.POINT_SEQ);
    const point = r.POINT ?? '';
    if (r.ROUTE_PORTION_TYPE === 'BODY') {
      const key = `${r.ROUTE_NAME}#${r.BODY_SEQ}`;
      const list = acc.bodies.get(key) ?? [];
      list.push([seq, point]);
      acc.bodies.set(key, list);
      for (const assoc of (r.ARPT_RWY_ASSOC ?? '').split(',')) {
        const apt = assoc.trim().split('/')[0];
        if (apt) acc.airports.add(apt);
      }
    } else {
      const tcode = (r.TRANSITION_COMPUTER_CODE ?? '').split('.');
      const key = (kind === 'SID' ? tcode[1] : tcode[0]) ?? '';
      if (!key) continue;
      const list = acc.trans.get(key) ?? [];
      list.push([seq, point]);
      acc.trans.set(key, list);
    }
  }

  const ordered = (list: [number, string][]) => [...list].sort((a, b) => a[0] - b[0]).map(([, p]) => p);
  return [...byName.entries()].map(([name, acc]) => {
    const bodies = [...acc.bodies.values()].map(ordered);
    const transitions: Record<string, string[]> = {};
    for (const [key, list] of acc.trans) transitions[key] = ordered(list);
    return {
      name,
      kind,
      airports: [...acc.airports].sort(),
      body: kind === 'SID' ? commonSuffix(bodies) : commonPrefix(bodies),
      transitions,
    };
  });
}

/** Rows from PFR_RMT_FMT.csv ("remote format": full route strings). */
export function parsePrefRoutes(rows: Row[]): PrefRouteRec[] {
  return rows.map((r) => ({
    orig: r.Orig ?? '',
    dest: r.Dest ?? '',
    type: r.Type ?? '',
    route: (r['Route String'] ?? '').trim(),
  }));
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run navdata/csv.test.ts navdata/parse.test.ts && npm run typecheck`
Expected: PASS — 8 tests pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add navdata/types.ts navdata/csv.ts navdata/csv.test.ts navdata/parse.ts navdata/parse.test.ts
git commit -m "feat(navdata): parse NASR CSV records" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: NavDb in-memory index

**Files:**
- Create: `navdata/navdb.ts`
- Test: `navdata/navdb.test.ts`

**Interfaces:**
- Consumes: `LatLon`, `distanceNm` from `shared/geo.ts` (Task 1); record types from `navdata/types.ts` (Task 2).
- Produces (`navdata/navdb.ts`):
  - `interface PointHit { id: string; lat: number; lon: number; kind: 'fix' | 'navaid' | 'airport' }`
  - `class NavDb` with `constructor(data: NavDataFile)`, `readonly cycle: string`, and methods:
    - `airport(id: string): AirportRec | undefined` — FAA id (`DFW`) or ICAO (`KDFW`)
    - `point(id: string, ref?: LatLon): PointHit | undefined` — fix/navaid nearest `ref`, falling back to an airport
    - `navaid(id: string, ref?: LatLon): NavaidRec | undefined`
    - `airway(id: string): AirwayRec | undefined` — contiguous-US (`loc 'C'`) wins
    - `procedure(token: string, kind: 'SID' | 'STAR'): ProcRec | undefined` — exact name, else same base name with another version digit; tokens not ending in a digit never match
    - `prefRoutes(orig: string, dest: string): PrefRouteRec[]`
    - `allPrefRoutes(): PrefRouteRec[]`

- [ ] **Step 1: Write the failing test**

`navdata/navdb.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { NavDb } from './navdb.ts';
import type { NavDataFile } from './types.ts';

const data: NavDataFile = {
  cycle: '2026-10-01',
  airports: [{ id: 'DFW', icao: 'KDFW', name: 'DALLAS-FORT WORTH INTL', lat: 32.897, lon: -97.038, rwyFt: 13401, pub: true }],
  navaids: [
    { id: 'AA', type: 'NDB', name: 'KENIE', lat: 47.0, lon: -96.8, varDeg: 4 },
    { id: 'AA', type: 'NDB', name: 'CEDAR', lat: 33.5, lon: -82.6, varDeg: -4 },
  ],
  fixes: [{ id: 'ZEMMA', lat: 33.0, lon: -110.0 }],
  airways: [
    { id: 'J1', loc: 'A', pts: ['X', 'Y'] },
    { id: 'J1', loc: 'C', pts: ['P', 'Q'] },
  ],
  procs: [{ name: 'AKUNA9', kind: 'SID', airports: ['DFW'], body: ['AKUNA'], transitions: {} }],
  prefRoutes: [{ orig: 'DFW', dest: 'ORD', type: 'H', route: 'DFW AKUNA9 MLC ORD' }],
};
const db = new NavDb(data);

describe('NavDb', () => {
  it('finds airports by FAA or ICAO id', () => {
    expect(db.airport('DFW')?.name).toBe('DALLAS-FORT WORTH INTL');
    expect(db.airport('KDFW')?.id).toBe('DFW');
    expect(db.airport('XXXX')).toBeUndefined();
  });

  it('resolves duplicate navaid idents to the one nearest the reference', () => {
    expect(db.point('AA', { lat: 34, lon: -83 })?.lat).toBe(33.5);
    expect(db.point('AA', { lat: 46, lon: -97 })?.lat).toBe(47.0);
    expect(db.navaid('AA', { lat: 34, lon: -83 })?.varDeg).toBe(-4);
  });

  it('returns fixes with their kind and falls back to airports', () => {
    expect(db.point('ZEMMA')).toEqual({ id: 'ZEMMA', lat: 33.0, lon: -110.0, kind: 'fix' });
    expect(db.point('DFW')?.kind).toBe('airport');
    expect(db.point('NOPE')).toBeUndefined();
  });

  it('prefers contiguous-US airways', () => {
    expect(db.airway('J1')?.pts).toEqual(['P', 'Q']);
  });

  it('finds procedures by exact name or by base name with another version', () => {
    expect(db.procedure('AKUNA9', 'SID')?.name).toBe('AKUNA9');
    expect(db.procedure('AKUNA8', 'SID')?.name).toBe('AKUNA9');
    expect(db.procedure('AKUNA', 'SID')).toBeUndefined();
    expect(db.procedure('AKUNA9', 'STAR')).toBeUndefined();
  });

  it('looks up preferred routes by airport pair', () => {
    expect(db.prefRoutes('DFW', 'ORD')).toHaveLength(1);
    expect(db.prefRoutes('ORD', 'DFW')).toHaveLength(0);
    expect(db.allPrefRoutes()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run navdata/navdb.test.ts`
Expected: FAIL — cannot resolve `./navdb.ts`.

- [ ] **Step 3: Write the implementation**

`navdata/navdb.ts`:

```ts
import { distanceNm, type LatLon } from '../shared/geo.ts';
import type { AirportRec, AirwayRec, FixRec, NavaidRec, NavDataFile, PrefRouteRec, ProcRec } from './types.ts';

export interface PointHit {
  id: string;
  lat: number;
  lon: number;
  kind: 'fix' | 'navaid' | 'airport';
}

/** Procedure names end in a version digit; the base name lets "AKUNA8" find the current "AKUNA9". */
const baseName = (name: string) => name.replace(/\d+$/, '');

function nearest<T extends LatLon>(items: T[], ref?: LatLon): T | undefined {
  if (items.length <= 1 || !ref) return items[0];
  let best = items[0];
  let bestD = Infinity;
  for (const it of items) {
    const d = distanceNm(it, ref);
    if (d < bestD) {
      bestD = d;
      best = it;
    }
  }
  return best;
}

export class NavDb {
  readonly cycle: string;
  private readonly airports = new Map<string, AirportRec>();
  private readonly fixes = new Map<string, FixRec>();
  private readonly navaids = new Map<string, NavaidRec[]>();
  private readonly airways = new Map<string, AirwayRec>();
  private readonly procs = { SID: new Map<string, ProcRec>(), STAR: new Map<string, ProcRec>() };
  private readonly procsByBase = { SID: new Map<string, ProcRec>(), STAR: new Map<string, ProcRec>() };
  private readonly pref = new Map<string, PrefRouteRec[]>();

  constructor(data: NavDataFile) {
    this.cycle = data.cycle;
    for (const a of data.airports) {
      this.airports.set(a.id, a);
      if (a.icao) this.airports.set(a.icao, a);
    }
    for (const f of data.fixes) this.fixes.set(f.id, f);
    for (const n of data.navaids) {
      const list = this.navaids.get(n.id) ?? [];
      list.push(n);
      this.navaids.set(n.id, list);
    }
    for (const w of data.airways) {
      // Contiguous-US airways win over Alaska/Hawaii airways that reuse the same id.
      const existing = this.airways.get(w.id);
      if (!existing || (existing.loc !== 'C' && w.loc === 'C')) this.airways.set(w.id, w);
    }
    for (const p of data.procs) {
      this.procs[p.kind].set(p.name, p);
      this.procsByBase[p.kind].set(baseName(p.name), p);
    }
    for (const r of data.prefRoutes) {
      const key = `${r.orig}-${r.dest}`;
      const list = this.pref.get(key) ?? [];
      list.push(r);
      this.pref.set(key, list);
    }
  }

  /** Airport by FAA id ("DFW") or ICAO id ("KDFW"). */
  airport(id: string): AirportRec | undefined {
    return this.airports.get(id);
  }

  /** Fix or navaid with this ident nearest to `ref`; falls back to an airport with that id. */
  point(id: string, ref?: LatLon): PointHit | undefined {
    const hits: PointHit[] = [];
    const fix = this.fixes.get(id);
    if (fix) hits.push({ ...fix, kind: 'fix' });
    for (const n of this.navaids.get(id) ?? []) hits.push({ id: n.id, lat: n.lat, lon: n.lon, kind: 'navaid' });
    if (hits.length === 0) {
      const apt = this.airports.get(id);
      if (apt) hits.push({ id, lat: apt.lat, lon: apt.lon, kind: 'airport' });
    }
    return nearest(hits, ref);
  }

  /** Navaid with this ident nearest to `ref` (needed for its magnetic variation). */
  navaid(id: string, ref?: LatLon): NavaidRec | undefined {
    return nearest(this.navaids.get(id) ?? [], ref);
  }

  airway(id: string): AirwayRec | undefined {
    return this.airways.get(id);
  }

  /** Exact procedure name, else the same procedure with a different version digit. */
  procedure(token: string, kind: 'SID' | 'STAR'): ProcRec | undefined {
    if (!/\d$/.test(token)) return undefined;
    return this.procs[kind].get(token) ?? this.procsByBase[kind].get(baseName(token));
  }

  prefRoutes(orig: string, dest: string): PrefRouteRec[] {
    return this.pref.get(`${orig}-${dest}`) ?? [];
  }

  allPrefRoutes(): PrefRouteRec[] {
    return [...this.pref.values()].flat();
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run navdata/navdb.test.ts && npm run typecheck`
Expected: PASS — 6 tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add navdata/navdb.ts navdata/navdb.test.ts
git commit -m "feat(navdata): add NavDb lookups with nearest-ident resolution" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Cycle math and the NASR build pipeline

**Files:**
- Create: `navdata/cycle.ts`, `navdata/assemble.ts`, `navdata/load.ts`, `navdata/build.ts`
- Test: `navdata/cycle.test.ts`, `navdata/assemble.test.ts`

**Interfaces:**
- Consumes: `readCsv` (Task 2), all `parse*` functions (Task 2), `NavDataFile` (Task 2), `NavDb` (Task 3).
- Produces:
  - `navdata/cycle.ts`: `cycleFor(when: Date): string` (`"YYYY-MM-DD"`), `nextCycle(cycle: string): string`, `csvZipUrl(cycle: string, category: string): string`.
  - `navdata/assemble.ts`: `NASR_FILES` (category → CSV file names), `assembleNavData(cycle: string, csv: Record<string, string>): NavDataFile` — throws `missing NASR file <name>`.
  - `navdata/load.ts`: `navDataFileName(cycle: string): string`, `findLatestNavData(dir: string): string | undefined`, `loadNavDb(path: string): NavDb`.
  - CLI `npm run navdata:build -- [YYYY-MM-DD]` → writes `data/nasr-<cycle>.json.gz`, caching zips in `.cache/nasr/<cycle>/`.

- [ ] **Step 1: Write the failing tests**

`navdata/cycle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { csvZipUrl, cycleFor, nextCycle } from './cycle.ts';

describe('cycleFor', () => {
  it('maps dates to the 28-day cycle in force', () => {
    expect(cycleFor(new Date('2026-10-01T00:00:00Z'))).toBe('2026-10-01');
    expect(cycleFor(new Date('2026-10-10T17:00:00Z'))).toBe('2026-10-01');
    expect(cycleFor(new Date('2026-10-28T23:59:59Z'))).toBe('2026-10-01');
    expect(cycleFor(new Date('2026-10-29T00:00:00Z'))).toBe('2026-10-29');
    expect(cycleFor(new Date('2026-09-30T12:00:00Z'))).toBe('2026-09-03');
  });
});

describe('nextCycle', () => {
  it('adds 28 days', () => {
    expect(nextCycle('2026-10-01')).toBe('2026-10-29');
    expect(nextCycle('2026-12-24')).toBe('2027-01-21');
  });
});

describe('csvZipUrl', () => {
  it('builds the FAA download URL', () => {
    expect(csvZipUrl('2026-10-01', 'APT')).toBe('https://nfdc.faa.gov/webContent/28DaySub/extra/01_Oct_2026_APT_CSV.zip');
  });
});
```

`navdata/assemble.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assembleNavData } from './assemble.ts';

const csv: Record<string, string> = {
  'APT_BASE.csv':
    '"SITE_NO","SITE_TYPE_CODE","ARPT_STATUS","ARPT_ID","ICAO_ID","ARPT_NAME","LAT_DECIMAL","LONG_DECIMAL","FACILITY_USE_CODE"\n' +
    '"23710.6","A","O","DFW","KDFW","DALLAS-FORT WORTH INTL",32.89723305,-97.03769472,"PU"\n',
  'APT_RWY.csv': '"SITE_NO","RWY_LEN"\n"23710.6",13401\n',
  'NAV_BASE.csv':
    '"NAV_ID","NAV_TYPE","NAV_STATUS","NAME","LAT_DECIMAL","LONG_DECIMAL","MAG_VARN","MAG_VARN_HEMIS"\n' +
    '"MLC","TACAN","OPERATIONAL IFR","MC ALESTER",34.85,-95.78,6,"E"\n',
  'FIX_BASE.csv': '"FIX_ID","LAT_DECIMAL","LONG_DECIMAL"\n"AKUNA",33.5,-96.2\n',
  'AWY_BASE.csv': '"AWY_ID","AWY_LOCATION","AIRWAY_STRING"\n"J52","C","AKUNA MLC"\n',
  'DP_RTE.csv':
    '"DP_COMPUTER_CODE","ROUTE_PORTION_TYPE","ROUTE_NAME","BODY_SEQ","TRANSITION_COMPUTER_CODE","POINT_SEQ","POINT","ARPT_RWY_ASSOC"\n' +
    '"AKUNA9.AKUNA","BODY","AKUNA",1,"",10,"AKUNA","DFW/31L"\n',
  'STAR_RTE.csv':
    '"STAR_COMPUTER_CODE","ROUTE_PORTION_TYPE","ROUTE_NAME","BODY_SEQ","TRANSITION_COMPUTER_CODE","POINT_SEQ","POINT","ARPT_RWY_ASSOC"\n',
  'PFR_RMT_FMT.csv': '"Orig","Route String","Dest","Type"\n"DFW","DFW AKUNA9 AKUNA J52 MLC","MLC","H"\n',
};

describe('assembleNavData', () => {
  it('parses every file into one NavDataFile', () => {
    const data = assembleNavData('2026-10-01', csv);
    expect(data.cycle).toBe('2026-10-01');
    expect(data.airports.map((a) => a.icao)).toEqual(['KDFW']);
    expect(data.navaids.map((n) => n.id)).toEqual(['MLC']);
    expect(data.fixes.map((f) => f.id)).toEqual(['AKUNA']);
    expect(data.airways.map((w) => w.id)).toEqual(['J52']);
    expect(data.procs.map((p) => `${p.kind}:${p.name}`)).toEqual(['SID:AKUNA9']);
    expect(data.prefRoutes).toHaveLength(1);
  });

  it('fails loudly when a file is missing', () => {
    const { ['FIX_BASE.csv']: _omit, ...rest } = csv;
    expect(() => assembleNavData('2026-10-01', rest)).toThrow('missing NASR file FIX_BASE.csv');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run navdata/cycle.test.ts navdata/assemble.test.ts`
Expected: FAIL — cannot resolve `./cycle.ts` and `./assemble.ts`.

- [ ] **Step 3: Write the implementation**

`navdata/cycle.ts`:

```ts
const DAY_MS = 86_400_000;
const CYCLE_MS = 28 * DAY_MS;
/** A known NASR effective date; every cycle is a whole number of 28-day steps from it. */
const EPOCH = Date.UTC(2026, 9, 1); // 2026-10-01
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Effective date ("YYYY-MM-DD") of the NASR cycle in force at `when` (UTC date granularity). */
export function cycleFor(when: Date): string {
  const n = Math.floor((when.getTime() - EPOCH) / CYCLE_MS);
  return new Date(EPOCH + n * CYCLE_MS).toISOString().slice(0, 10);
}

/** The cycle after `cycle`. */
export function nextCycle(cycle: string): string {
  return new Date(Date.parse(`${cycle}T00:00:00Z`) + CYCLE_MS).toISOString().slice(0, 10);
}

/** FAA download URL of one CSV category zip, e.g. ("2026-10-01", "APT"). */
export function csvZipUrl(cycle: string, category: string): string {
  const [y, m, d] = cycle.split('-');
  const prefix = `${d}_${MONTHS[Number(m) - 1]}_${y}`;
  return `https://nfdc.faa.gov/webContent/28DaySub/extra/${prefix}_${category}_CSV.zip`;
}
```

`navdata/assemble.ts`:

```ts
import { readCsv } from './csv.ts';
import { parseAirports, parseAirways, parseFixes, parseNavaids, parsePrefRoutes, parseProcedures } from './parse.ts';
import type { NavDataFile } from './types.ts';

/** NASR CSV categories to download, and the files used from each zip. */
export const NASR_FILES = {
  APT: ['APT_BASE.csv', 'APT_RWY.csv'],
  NAV: ['NAV_BASE.csv'],
  FIX: ['FIX_BASE.csv'],
  AWY: ['AWY_BASE.csv'],
  DP: ['DP_RTE.csv'],
  STAR: ['STAR_RTE.csv'],
  PFR: ['PFR_RMT_FMT.csv'],
} as const;

/** Turn the raw CSV texts (keyed by file name) into one NavDataFile. */
export function assembleNavData(cycle: string, csv: Record<string, string>): NavDataFile {
  const rows = (name: string) => {
    const text = csv[name];
    if (text === undefined) throw new Error(`missing NASR file ${name}`);
    return readCsv(text);
  };
  return {
    cycle,
    airports: parseAirports(rows('APT_BASE.csv'), rows('APT_RWY.csv')),
    navaids: parseNavaids(rows('NAV_BASE.csv')),
    fixes: parseFixes(rows('FIX_BASE.csv')),
    airways: parseAirways(rows('AWY_BASE.csv')),
    procs: [...parseProcedures(rows('DP_RTE.csv'), 'SID'), ...parseProcedures(rows('STAR_RTE.csv'), 'STAR')],
    prefRoutes: parsePrefRoutes(rows('PFR_RMT_FMT.csv')),
  };
}
```

`navdata/load.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { NavDb } from './navdb.ts';
import type { NavDataFile } from './types.ts';

export const navDataFileName = (cycle: string) => `nasr-${cycle}.json.gz`;

/** Path of the newest nasr-YYYY-MM-DD.json.gz in `dir`, or undefined. */
export function findLatestNavData(dir: string): string | undefined {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return undefined;
  }
  const latest = names.filter((n) => /^nasr-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(n)).sort().at(-1);
  return latest ? join(dir, latest) : undefined;
}

export function loadNavDb(path: string): NavDb {
  const data = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as NavDataFile;
  return new NavDb(data);
}
```

`navdata/build.ts`:

```ts
// Usage: npm run navdata:build -- [YYYY-MM-DD]   (defaults to the cycle in force today)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import { assembleNavData, NASR_FILES } from './assemble.ts';
import { csvZipUrl, cycleFor } from './cycle.ts';
import { navDataFileName } from './load.ts';

const cycle = process.argv[2] ?? cycleFor(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(cycle)) throw new Error(`bad cycle "${cycle}", expected YYYY-MM-DD`);

const cacheDir = join('.cache', 'nasr', cycle);
const outDir = 'data';
mkdirSync(cacheDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

async function download(category: string): Promise<Uint8Array> {
  const file = join(cacheDir, `${category}.zip`);
  if (existsSync(file)) return readFileSync(file);
  const url = csvZipUrl(cycle, category);
  console.log(`downloading ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': 'webfly-navdata-build' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  writeFileSync(file, bytes);
  return bytes;
}

const csv: Record<string, string> = {};
for (const [category, wanted] of Object.entries(NASR_FILES)) {
  const entries = unzipSync(await download(category), { filter: (f) => (wanted as readonly string[]).includes(f.name) });
  for (const name of wanted) {
    const bytes = entries[name];
    if (!bytes) throw new Error(`${category}.zip has no ${name}`);
    csv[name] = Buffer.from(bytes).toString('utf8');
  }
}

const data = assembleNavData(cycle, csv);
const out = join(outDir, navDataFileName(cycle));
writeFileSync(out, gzipSync(JSON.stringify(data)));
console.log(
  `wrote ${out}: ${data.airports.length} airports, ${data.navaids.length} navaids, ${data.fixes.length} fixes, ` +
    `${data.airways.length} airways, ${data.procs.length} procedures, ${data.prefRoutes.length} preferred routes`,
);
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run navdata && npm run typecheck`
Expected: PASS — all navdata tests pass (cycle 3, assemble 2, plus Tasks 2–3); typecheck clean.

- [ ] **Step 5: Build the real nav data (network, ~15 MB download)**

Run: `npm run navdata:build -- 2026-10-01`
Expected: seven `downloading https://nfdc.faa.gov/...` lines, then approximately:
`wrote data/nasr-2026-10-01.json.gz: 12726 airports, 1523 navaids, 70129 fixes, 1553 airways, 1733 procedures, 13199 preferred routes`
(counts vary slightly by cycle; the file is ~1.7 MB). Re-running uses the cached zips in `.cache/`.

- [ ] **Step 6: Commit** (the built `data/` file is git-ignored)

```bash
git add navdata/cycle.ts navdata/cycle.test.ts navdata/assemble.ts navdata/assemble.test.ts navdata/load.ts navdata/build.ts
git commit -m "feat(navdata): build compact nav data from FAA NASR cycle" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Route tokenizer

**Files:**
- Create: `server/route/tokenize.ts`
- Test: `server/route/tokenize.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (`server/route/tokenize.ts`): `LATLON_RE: RegExp` (NAS `3530N/09720W` and ICAO `3530N09720W`), `LATLON_DEG_RE: RegExp` (`35N097W`), `tokenizeRoute(text: string): string[]`.

Rules: uppercase; `..` and `.` are separators; drop `DCT`, `IFR`, `VFR` and ICAO speed/level groups (`N0450F350`); for any token containing `/` that is not a lat/lon, keep only the part before `/`; strip `-STAR`/`-DP` suffixes (Canadian pseudo-procedures in FAA preferred routes).

- [ ] **Step 1: Write the failing test**

`server/route/tokenize.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { tokenizeRoute } from './tokenize.ts';

describe('tokenizeRoute', () => {
  it('splits NAS dot format', () => {
    expect(tokenizeRoute('KDFW.AKUNA9.MLC..SGF.WELTS.TRTLL6.KORD')).toEqual(['KDFW', 'AKUNA9', 'MLC', 'SGF', 'WELTS', 'TRTLL6', 'KORD']);
  });

  it('drops DCT, speed/level groups and slash suffixes in ICAO format', () => {
    expect(tokenizeRoute('KDFW DCT ABI/N0450F350 J52 TXO DCT KLAX')).toEqual(['KDFW', 'ABI', 'J52', 'TXO', 'KLAX']);
  });

  it('keeps NAS lat/lon tokens intact', () => {
    expect(tokenizeRoute('KAAA..3530N/09720W..KBBB')).toEqual(['KAAA', '3530N/09720W', 'KBBB']);
  });

  it('strips -STAR/-DP suffixes and radar-vector slashes, and uppercases', () => {
    expect(tokenizeRoute('CYYZ BETES-DP FOXEE')).toEqual(['CYYZ', 'BETES', 'FOXEE']);
    expect(tokenizeRoute('kdfw./.abi')).toEqual(['KDFW', 'ABI']);
  });

  it('returns nothing for noise-only input', () => {
    expect(tokenizeRoute('  N0450F350 IFR VFR  ')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/route/tokenize.test.ts`
Expected: FAIL — cannot resolve `./tokenize.ts`.

- [ ] **Step 3: Write the implementation**

`server/route/tokenize.ts`:

```ts
/** NAS "3530N/09720W" or ICAO "3530N09720W" (degrees + minutes). */
export const LATLON_RE = /^(\d{2})(\d{2})([NS])\/?(\d{3})(\d{2})([EW])$/;
/** ICAO whole-degree form "35N097W". */
export const LATLON_DEG_RE = /^(\d{2})([NS])(\d{3})([EW])$/;
/** ICAO speed/level groups like N0450F350, M082F370, K0830S1130. */
const SPEED_LEVEL_RE = /^[NKM]\d{3,4}([FAMS]\d{3,4}|VFR)$/;
const NOISE = new Set(['DCT', 'IFR', 'VFR']);

/**
 * Split a route string into meaningful tokens. Accepts NAS format (KDFW.AKUNA9.MLC..SGF),
 * ICAO format (KDFW DCT ABI/N0450F350 J52 TXO) and FAA preferred-route format (DFW AKUNA9 MLC).
 */
export function tokenizeRoute(text: string): string[] {
  const tokens: string[] = [];
  for (const raw of text.toUpperCase().replace(/\.\./g, ' ').replace(/\./g, ' ').split(/\s+/)) {
    let tok = raw;
    if (tok.includes('/') && !LATLON_RE.test(tok)) tok = tok.slice(0, tok.indexOf('/'));
    tok = tok.replace(/-(STAR|DP)$/, '');
    if (!tok || NOISE.has(tok) || SPEED_LEVEL_RE.test(tok)) continue;
    tokens.push(tok);
  }
  return tokens;
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run server/route/tokenize.test.ts && npm run typecheck`
Expected: PASS — 5 tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add server/route/tokenize.ts server/route/tokenize.test.ts
git commit -m "feat(route): tokenize NAS, ICAO and preferred-route strings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Route decoder

**Files:**
- Create: `shared/types.ts`, `server/route/decode.ts`
- Test: `server/route/decode.test.ts`

**Interfaces:**
- Consumes: `crossTrackNm`, `destinationPoint`, `distanceNm`, `normalizeDeg` (Task 1); `NavDb` and its methods (Task 3); `NavDataFile` (Task 2, test only); `tokenizeRoute`, `LATLON_RE`, `LATLON_DEG_RE` (Task 5).
- Produces:
  - `shared/types.ts`: `type RoutePointKind`, `interface RoutePoint` (spec §8).
  - `server/route/decode.ts`: `interface DecodedRoute { points: RoutePoint[]; partial: boolean; unresolved: string[]; dropped: string[] }`, `interface DecodeOptions { origin?: string; dest?: string }`, `decodeRoute(text: string, db: NavDb, opts?: DecodeOptions): DecodedRoute`.

Decoding order for each token (first match wins):
1. First/last token that is an airport → airport point.
2. Lat/lon → `latlon` point.
3. Airway (needs a previous point and a next token) → the airway's points strictly between entry and exit, in either direction, `via` = airway. If the previous point is not on the airway, snap to the airway point nearest it (≤ 60 nm). If the next token is another airway, insert their shared point nearest the entry as the exit. If entry or exit still isn't on the airway → unresolved.
4. Fix-radial-distance (`ABI270015`) → `frd` point; radials are magnetic, true = radial + east variation of that navaid.
5. Radial only (`PUT105`) → skipped (a direction, not a point).
6. SID → body points, plus the transition named by the next token if it exists. `via` = SID name.
7. STAR → the transition named by the previous point if it exists, then the body. `via` = STAR name.
8. Fix/navaid/airport ident nearest the previous point → point; otherwise unresolved.

Consecutive duplicate idents are collapsed. After decoding, the zig-zag guard repeatedly removes any interior point more than 300 nm from the great circle through its neighbors.

- [ ] **Step 1: Write the shared type**

`shared/types.ts`:

```ts
export type RoutePointKind = 'airport' | 'navaid' | 'fix' | 'latlon' | 'frd';

export interface RoutePoint {
  ident: string; // "ZEMMA", "ABI", "KDFW", "3530N/09720W", "ABI270015"
  lat: number;
  lon: number;
  kind: RoutePointKind;
  via?: string; // airway or procedure that produced it, e.g. "J52", "ANJLL4"
}
```

- [ ] **Step 2: Write the failing test**

`server/route/decode.test.ts` (the last four `it` blocks before the empty-text case are the Review Focus pins):

```ts
import { describe, expect, it } from 'vitest';
import { destinationPoint } from '../../shared/geo.ts';
import { NavDb } from '../../navdata/navdb.ts';
import type { NavDataFile } from '../../navdata/types.ts';
import { decodeRoute } from './decode.ts';

// A synthetic world laid out west-to-east along 30N so expectations are easy to reason about.
const data: NavDataFile = {
  cycle: '2026-10-01',
  airports: [
    { id: 'AAA', icao: 'KAAA', name: 'ORIGIN', lat: 30.0, lon: -100.0, rwyFt: 10000, pub: true },
    { id: 'BBB', icao: 'KBBB', name: 'DEST', lat: 30.0, lon: -90.0, rwyFt: 10000, pub: true },
    { id: 'CCC', name: 'BESIDE J1', lat: 30.05, lon: -97.0, rwyFt: 6000, pub: true },
  ],
  navaids: [
    { id: 'VRA', type: 'VORTAC', name: 'ALPHA', lat: 30.0, lon: -98.0, varDeg: 5 },
    { id: 'VRA', type: 'VOR', name: 'FAR ALPHA', lat: 45.0, lon: -70.0, varDeg: -15 },
    { id: 'VRB', type: 'VORTAC', name: 'BRAVO', lat: 30.0, lon: -95.0, varDeg: 3 },
    { id: 'VRC', type: 'VOR/DME', name: 'CHARLIE', lat: 31.0, lon: -96.0, varDeg: 4 },
  ],
  fixes: [
    { id: 'SIDFX', lat: 30.0, lon: -99.5 },
    { id: 'TFIX1', lat: 30.0, lon: -98.8 },
    { id: 'WPT1', lat: 30.0, lon: -97.0 },
    { id: 'WPT2', lat: 30.0, lon: -96.0 },
    { id: 'WPT3', lat: 29.5, lon: -95.5 },
    { id: 'STRT1', lat: 30.0, lon: -93.0 },
    { id: 'STRFX', lat: 30.0, lon: -92.0 },
    { id: 'FINAL', lat: 30.0, lon: -91.0 },
    { id: 'FARAWY', lat: 45.0, lon: -96.0 },
  ],
  airways: [
    { id: 'J1', loc: 'C', pts: ['VRA', 'WPT1', 'WPT2', 'VRB'] },
    { id: 'J2', loc: 'C', pts: ['VRC', 'WPT2', 'WPT3'] },
  ],
  procs: [
    { name: 'DEPRT1', kind: 'SID', airports: ['AAA'], body: ['SIDFX'], transitions: { VRA: ['SIDFX', 'TFIX1', 'VRA'] } },
    { name: 'ARRVL2', kind: 'STAR', airports: ['BBB'], body: ['STRFX', 'FINAL'], transitions: { VRB: ['VRB', 'STRT1', 'STRFX'] } },
  ],
  prefRoutes: [],
};
const db = new NavDb(data);
const idents = (text: string, opts = {}) => decodeRoute(text, db, opts).points.map((p) => p.ident);

describe('decodeRoute', () => {
  it('expands SID, airway and STAR in NAS format', () => {
    const r = decodeRoute('KAAA.DEPRT1.VRA.J1.VRB.ARRVL2.KBBB', db);
    expect(r.points.map((p) => p.ident)).toEqual(['KAAA', 'SIDFX', 'TFIX1', 'VRA', 'WPT1', 'WPT2', 'VRB', 'STRT1', 'STRFX', 'FINAL', 'KBBB']);
    expect(r.points.map((p) => p.via ?? '-')).toEqual(['-', 'DEPRT1', 'DEPRT1', 'DEPRT1', 'J1', 'J1', '-', 'ARRVL2', 'ARRVL2', 'ARRVL2', '-']);
    expect(r.points.map((p) => p.kind)).toEqual(['airport', 'fix', 'fix', 'navaid', 'fix', 'fix', 'navaid', 'fix', 'fix', 'fix', 'airport']);
    expect(r.partial).toBe(false);
  });

  it('picks the duplicate navaid nearest the route', () => {
    const vra = decodeRoute('KAAA.DEPRT1.VRA.J1.VRB.ARRVL2.KBBB', db).points.find((p) => p.ident === 'VRA');
    expect(vra?.lat).toBe(30.0);
  });

  it('handles ICAO format with DCT and speed/level groups', () => {
    expect(idents('KAAA DCT VRA/N0450F350 J1 VRB DCT KBBB')).toEqual(['KAAA', 'VRA', 'WPT1', 'WPT2', 'VRB', 'KBBB']);
  });

  it('flies airways in reverse', () => {
    expect(idents('KBBB VRB J1 VRA KAAA')).toEqual(['KBBB', 'VRB', 'WPT2', 'WPT1', 'VRA', 'KAAA']);
  });

  it('joins an airway from an airport beside it', () => {
    expect(idents('CCC J1 VRB KBBB')).toEqual(['CCC', 'WPT1', 'WPT2', 'VRB', 'KBBB']);
  });

  it('leaves one airway for another at their junction', () => {
    expect(idents('KAAA VRA J1 J2 WPT3 KBBB')).toEqual(['KAAA', 'VRA', 'WPT1', 'WPT2', 'WPT3', 'KBBB']);
  });

  it('accepts a procedure filed with an outdated version number', () => {
    const r = decodeRoute('KAAA.DEPRT2.VRA..KBBB', db);
    expect(r.points.map((p) => p.ident)).toEqual(['KAAA', 'SIDFX', 'TFIX1', 'VRA', 'KBBB']);
    expect(r.points[1]?.via).toBe('DEPRT1');
  });

  it('computes fix-radial-distance points from the magnetic radial', () => {
    const r = decodeRoute('KAAA VRA090060 KBBB', db);
    const frd = r.points[1];
    const expected = destinationPoint({ lat: 30.0, lon: -98.0 }, 95, 60);
    expect(frd?.kind).toBe('frd');
    expect(frd?.lat).toBeCloseTo(expected.lat, 6);
    expect(frd?.lon).toBeCloseTo(expected.lon, 6);
  });

  it('skips radial-only tokens', () => {
    expect(idents('KAAA VRA270 WPT1 KBBB')).toEqual(['KAAA', 'WPT1', 'KBBB']);
  });

  it('decodes lat/lon tokens in NAS, ICAO and whole-degree forms', () => {
    const r = decodeRoute('KAAA 3030N/09700W 3100N09600W 31N094W KBBB', db);
    expect(r.points.slice(1, 4).map((p) => [p.kind, p.lat, p.lon])).toEqual([
      ['latlon', 30.5, -97.0],
      ['latlon', 31.0, -96.0],
      ['latlon', 31.0, -94.0],
    ]);
  });

  it('reports unknown tokens and marks the route partial', () => {
    const r = decodeRoute('KAAA VRA NOSUCH KBBB', db);
    expect(r.points.map((p) => p.ident)).toEqual(['KAAA', 'VRA', 'KBBB']);
    expect(r.unresolved).toEqual(['NOSUCH']);
    expect(r.partial).toBe(true);
  });

  it('drops a point that zig-zags far off the route', () => {
    const r = decodeRoute('KAAA VRA FARAWY VRB KBBB', db);
    expect(r.points.map((p) => p.ident)).toEqual(['KAAA', 'VRA', 'VRB', 'KBBB']);
    expect(r.dropped).toEqual(['FARAWY']);
    expect(r.partial).toBe(true);
  });

  it('adds origin and destination when the text omits them, without duplicating them', () => {
    expect(idents('VRA J1 VRB', { origin: 'KAAA', dest: 'KBBB' })).toEqual(['KAAA', 'VRA', 'WPT1', 'WPT2', 'VRB', 'KBBB']);
    expect(idents('AAA VRA BBB', { origin: 'KAAA', dest: 'KBBB' })).toEqual(['AAA', 'VRA', 'BBB']);
  });

  it('flies only the SID body when the next fix is not one of its transitions', () => {
    expect(idents('KAAA DEPRT1 WPT1 KBBB')).toEqual(['KAAA', 'SIDFX', 'WPT1', 'KBBB']);
  });

  it('flies only the STAR body when entered from a fix that is not one of its transitions', () => {
    expect(idents('KAAA WPT2 ARRVL2 KBBB')).toEqual(['KAAA', 'WPT2', 'STRFX', 'FINAL', 'KBBB']);
  });

  it('reports an airway whose exit fix is not on it, then continues direct', () => {
    const r = decodeRoute('KAAA VRA J1 STRT1 KBBB', db);
    expect(r.points.map((p) => p.ident)).toEqual(['KAAA', 'VRA', 'STRT1', 'KBBB']);
    expect(r.unresolved).toEqual(['J1']);
  });

  it('treats an airway token at the very end as unresolved instead of crashing', () => {
    expect(decodeRoute('KAAA VRA J1', db).unresolved).toEqual(['J1']);
  });

  it('returns an empty route for empty text', () => {
    expect(decodeRoute('', db)).toEqual({ points: [], partial: false, unresolved: [], dropped: [] });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run server/route/decode.test.ts`
Expected: FAIL — cannot resolve `./decode.ts`.

- [ ] **Step 4: Write the implementation**

`server/route/decode.ts`:

```ts
import { crossTrackNm, destinationPoint, distanceNm, normalizeDeg } from '../../shared/geo.ts';
import type { RoutePoint } from '../../shared/types.ts';
import type { NavDb } from '../../navdata/navdb.ts';
import { LATLON_DEG_RE, LATLON_RE, tokenizeRoute } from './tokenize.ts';

export interface DecodedRoute {
  points: RoutePoint[];
  partial: boolean; // true if any token was unresolved or any point was dropped
  unresolved: string[];
  dropped: string[]; // removed by the zig-zag guard
}

export interface DecodeOptions {
  origin?: string; // airport id; prepended if the route text doesn't start with it
  dest?: string; // airport id; appended if the route text doesn't end with it
}

/** Fix-radial-distance, e.g. ABI270015 = 15 nm from ABI on its 270 radial. */
const FRD_RE = /^([A-Z0-9]{2,3})(\d{3})(\d{3})$/;
/** Radial only, e.g. PUT105 = "via PUT's 105 radial"; a direction, not a point. */
const RADIAL_RE = /^([A-Z]{2,3})(\d{3})$/;
/** A point that pulls the route this far sideways from its neighbors is a bad ident match. */
const ZIGZAG_NM = 300;
/** How far from the airway a route may join it "from the side" (e.g. straight from the airport). */
const AIRWAY_ENTRY_SNAP_NM = 60;

function parseLatLon(tok: string): { lat: number; lon: number } | undefined {
  const m = LATLON_RE.exec(tok);
  if (m) {
    const lat = Number(m[1]) + Number(m[2]) / 60;
    const lon = Number(m[4]) + Number(m[5]) / 60;
    return { lat: m[3] === 'S' ? -lat : lat, lon: m[6] === 'W' ? -lon : lon };
  }
  const d = LATLON_DEG_RE.exec(tok);
  if (d) {
    const lat = Number(d[1]);
    const lon = Number(d[3]);
    return { lat: d[2] === 'S' ? -lat : lat, lon: d[4] === 'W' ? -lon : lon };
  }
  return undefined;
}

export function decodeRoute(text: string, db: NavDb, opts: DecodeOptions = {}): DecodedRoute {
  const tokens = tokenizeRoute(text);
  const points: RoutePoint[] = [];
  const unresolved: string[] = [];

  const last = (): RoutePoint | undefined => points[points.length - 1];
  const add = (p: RoutePoint | undefined) => {
    if (p && last()?.ident !== p.ident) points.push(p);
  };
  const resolve = (ident: string, via?: string): RoutePoint | undefined => {
    const hit = db.point(ident, last());
    if (!hit) return undefined;
    const p: RoutePoint = { ident, lat: hit.lat, lon: hit.lon, kind: hit.kind };
    if (via) p.via = via;
    return p;
  };
  const addAll = (idents: string[], via: string) => {
    for (const id of idents) {
      const p = resolve(id, via);
      if (p) add(p);
      else unresolved.push(id);
    }
  };
  const airportPoint = (id: string): RoutePoint | undefined => {
    const a = db.airport(id);
    return a ? { ident: id, lat: a.lat, lon: a.lon, kind: 'airport' } : undefined;
  };
  const sameAirport = (a: string | undefined, b: string) => a !== undefined && db.airport(a) !== undefined && db.airport(a) === db.airport(b);

  if (opts.origin && !sameAirport(tokens[0], opts.origin)) add(airportPoint(opts.origin));

  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k] as string;
    const next = tokens[k + 1];

    if (k === 0 || k === tokens.length - 1) {
      const apt = airportPoint(tok);
      if (apt) {
        add(apt);
        continue;
      }
    }

    const ll = parseLatLon(tok);
    if (ll) {
      add({ ident: tok, ...ll, kind: 'latlon' });
      continue;
    }

    const awy = db.airway(tok);
    const prev = last();
    if (awy && prev && next) {
      const seq = awy.pts;
      let entry = prev.ident;
      if (!seq.includes(entry)) {
        // Joining from beside the airway (typically straight from the departure airport).
        let best: RoutePoint | undefined;
        let bestD = Infinity;
        for (const id of seq) {
          const p = resolve(id, tok);
          const d = p ? distanceNm(p, prev) : Infinity;
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
        if (best && bestD <= AIRWAY_ENTRY_SNAP_NM) {
          add(best);
          entry = best.ident;
        }
      }
      let exit = next;
      const other = db.airway(next);
      if (!seq.includes(exit) && other) {
        // Airway-to-airway junction ("V188 V623"): leave at the shared point nearest the entry.
        const ia = seq.indexOf(entry);
        const shared = seq.filter((id) => other.pts.includes(id));
        if (ia >= 0 && shared.length > 0) {
          exit = shared.reduce((a, b) => (Math.abs(seq.indexOf(b) - ia) < Math.abs(seq.indexOf(a) - ia) ? b : a));
          tokens.splice(k + 1, 0, exit);
        }
      }
      const i = seq.indexOf(entry);
      const j = seq.indexOf(exit);
      if (i < 0 || j < 0) {
        unresolved.push(tok);
        continue;
      }
      addAll(i <= j ? seq.slice(i + 1, j) : seq.slice(j + 1, i).reverse(), tok);
      continue;
    }

    const frd = FRD_RE.exec(tok);
    if (frd) {
      const nav = db.navaid(frd[1] as string, last());
      if (nav) {
        // Radials are magnetic: true bearing = radial + east variation.
        const p = destinationPoint(nav, normalizeDeg(Number(frd[2]) + nav.varDeg), Number(frd[3]));
        add({ ident: tok, lat: p.lat, lon: p.lon, kind: 'frd' });
        continue;
      }
    }
    const radial = RADIAL_RE.exec(tok);
    if (radial && db.navaid(radial[1] as string)) continue;

    const sid = db.procedure(tok, 'SID');
    if (sid) {
      addAll(sid.body, sid.name);
      const trans = next ? sid.transitions[next] : undefined;
      if (trans) addAll(trans, sid.name);
      continue;
    }

    const star = db.procedure(tok, 'STAR');
    if (star) {
      const entry = last()?.ident;
      const trans = entry ? star.transitions[entry] : undefined;
      if (trans) addAll(trans, star.name);
      addAll(star.body, star.name);
      continue;
    }

    const p = resolve(tok);
    if (p) add(p);
    else unresolved.push(tok);
  }

  if (opts.dest && !sameAirport(tokens[tokens.length - 1], opts.dest)) add(airportPoint(opts.dest));

  const dropped: string[] = [];
  let changed = true;
  while (changed && points.length > 2) {
    changed = false;
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[i - 1] as RoutePoint;
      const p = points[i] as RoutePoint;
      const b = points[i + 1] as RoutePoint;
      if (distanceNm(a, b) > 1 && crossTrackNm(p, a, b) > ZIGZAG_NM) {
        dropped.push(p.ident);
        points.splice(i, 1);
        changed = true;
        break;
      }
    }
  }

  return { points, partial: unresolved.length > 0 || dropped.length > 0, unresolved, dropped };
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run server/route/decode.test.ts && npm run typecheck`
Expected: PASS — 18 tests pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add shared/types.ts server/route/decode.ts server/route/decode.test.ts
git commit -m "feat(route): decode routes with SIDs, airways, STARs and zig-zag guard" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Corpus test, decode CLI and README

**Files:**
- Create: `server/route/corpus.test.ts`, `scripts/decode.ts`, `README.md`

**Interfaces:**
- Consumes: `findLatestNavData`, `loadNavDb` (Task 4); `NavDb.allPrefRoutes`, `NavDb.airport` (Task 3); `decodeRoute` (Task 6).
- Produces: CLI `npm run decode -- "<route>"`; the corpus regression test (skipped automatically when `data/` has no built cycle).

- [ ] **Step 1: Write the corpus test**

`server/route/corpus.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findLatestNavData, loadNavDb } from '../../navdata/load.ts';
import { decodeRoute } from './decode.ts';

// Decodes every FAA preferred route in the built NASR cycle. Run `npm run navdata:build` first.
const path = findLatestNavData('data');

describe.skipIf(!path)('route decoder against the FAA preferred-route corpus', () => {
  it('fully decodes at least 99% of routes between known airports', () => {
    const db = loadNavDb(path as string);
    let total = 0;
    let clean = 0;
    const misses = new Map<string, number>();
    for (const r of db.allPrefRoutes()) {
      if (!db.airport(r.orig) || !db.airport(r.dest)) continue;
      total++;
      const d = decodeRoute(r.route, db);
      if (!d.partial) clean++;
      for (const t of [...d.unresolved, ...d.dropped]) misses.set(t, (misses.get(t) ?? 0) + 1);
    }
    const top = [...misses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    console.log(`decoded ${clean}/${total} (${((100 * clean) / total).toFixed(2)}%); top misses:`, top);
    expect(total).toBeGreaterThan(5000);
    expect(clean / total).toBeGreaterThanOrEqual(0.99);
  });
});
```

- [ ] **Step 2: Run it against the cycle built in Task 4**

Run: `npx vitest run server/route/corpus.test.ts --reporter=verbose`
Expected: PASS, with a log line like `decoded 10726/10793 (99.38%); top misses: [ [ 'LINNG', 24 ], [ 'BETES', 11 ], ...`. The top misses should be mostly Canadian fixes (absent from FAA data). If the rate is below 99%, a decoder rule is broken: inspect the top misses with the CLI from Step 3 before changing anything. Do not lower the threshold.

- [ ] **Step 3: Write the decode CLI**

`scripts/decode.ts`:

```ts
// Usage: npm run decode -- "KDFW.AKUNA9.MLC..SGF.WELTS.TRTLL6.KORD"
import { findLatestNavData, loadNavDb } from '../navdata/load.ts';
import { decodeRoute } from '../server/route/decode.ts';

const path = findLatestNavData('data');
if (!path) {
  console.error('No nav data found in data/. Run: npm run navdata:build');
  process.exit(1);
}
const db = loadNavDb(path);
const result = decodeRoute(process.argv.slice(2).join(' '), db);
console.log(`NASR cycle ${db.cycle}`);
console.table(
  result.points.map((p) => ({ ident: p.ident, kind: p.kind, via: p.via ?? '', lat: p.lat.toFixed(4), lon: p.lon.toFixed(4) })),
);
if (result.unresolved.length) console.log('unresolved:', result.unresolved.join(' '));
if (result.dropped.length) console.log('dropped (zig-zag guard):', result.dropped.join(' '));
```

Run: `npm run decode -- "KDFW.AKUNA9.MLC..SGF.WELTS.TRTLL6.KORD"`
Expected: `NASR cycle 2026-10-01` and a 15-row table: `KDFW` (airport), `AKUNA`, `TIKYS`, `MLC` (via `AKUNA9`), `SGF`, `WELTS`, then `MCDEE` … `RINNO` (via `TRTLL6`), `KORD` (airport). No `unresolved:` line.

- [ ] **Step 4: Write the README**

`README.md`:

```markdown
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

## Data sources

- FAA NASR 28-day subscription (public domain): airports, navaids, fixes, airways, SIDs/STARs, preferred routes.
```

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS — 9 test files, 50 tests pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add server/route/corpus.test.ts scripts/decode.ts README.md
git commit -m "test(route): add FAA preferred-route corpus test and decode CLI" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
