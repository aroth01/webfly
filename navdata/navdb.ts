import { distanceNm, type LatLon } from '../shared/geo.ts';
import type { NavTile } from '../shared/types.ts';
import { airacIdent } from './cycle.ts';
import type { AirportRec, AirwayRec, FixRec, NavaidRec, NavDataFile, PrefRouteRec, ProcRec } from './types.ts';

export interface PointHit {
  id: string;
  lat: number;
  lon: number;
  kind: 'fix' | 'navaid' | 'airport';
}

/** Nav tiles are 2x2 degree cells keyed by their even-integer south-west corner. */
export const TILE_DEG = 2;
/** Airports shorter than this are left off the ND (spec §8). */
const TILE_MIN_RWY_FT = 4000;
const tileKey = (lat: number, lon: number) =>
  `${Math.floor(lat / TILE_DEG) * TILE_DEG},${Math.floor(lon / TILE_DEG) * TILE_DEG}`;

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
  readonly airac: string;
  private readonly airports = new Map<string, AirportRec>();
  private readonly fixes = new Map<string, FixRec>();
  private readonly navaids = new Map<string, NavaidRec[]>();
  private readonly airways = new Map<string, AirwayRec>();
  private readonly procs = { SID: new Map<string, ProcRec>(), STAR: new Map<string, ProcRec>() };
  private readonly procsByBase = { SID: new Map<string, ProcRec>(), STAR: new Map<string, ProcRec>() };
  private readonly pref = new Map<string, PrefRouteRec[]>();
  private readonly tiles = new Map<string, Omit<NavTile, 'cycle'>>();

  constructor(data: NavDataFile) {
    this.cycle = data.cycle;
    this.airac = airacIdent(data.cycle);
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
    const tileOf = (lat: number, lon: number) => {
      const key = tileKey(lat, lon);
      let t = this.tiles.get(key);
      if (!t) {
        t = { navaids: [], airports: [] };
        this.tiles.set(key, t);
      }
      return t;
    };
    for (const n of data.navaids) tileOf(n.lat, n.lon).navaids.push({ ident: n.id, type: n.type, lat: n.lat, lon: n.lon });
    for (const a of data.airports) {
      if (a.rwyFt >= TILE_MIN_RWY_FT) tileOf(a.lat, a.lon).airports.push({ icao: a.icao ?? a.id, lat: a.lat, lon: a.lon, rwyFt: a.rwyFt });
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

  /** Navaids and long-runway airports in the 2x2 degree cell whose south-west corner is (lat, lon). */
  tile(lat: number, lon: number): Omit<NavTile, 'cycle'> {
    return this.tiles.get(tileKey(lat, lon)) ?? { navaids: [], airports: [] };
  }

  allPrefRoutes(): PrefRouteRec[] {
    return [...this.pref.values()].flat();
  }
}
