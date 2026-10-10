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

/**
 * A procedure computer code: a 3-5 letter name plus one version digit. Stripping the digit lets an outdated
 * "AKUNA8" find the current "AKUNA9". Other shapes (SIDs like "O431", radials like "DPK282") get no fallback.
 */
const VERSIONED_RE = /^[A-Z]{3,5}\d$/;
const baseName = (name: string) => (VERSIONED_RE.test(name) ? name.slice(0, -1) : undefined);

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
  private readonly airportList: AirportRec[];
  private readonly tiles = new Map<string, NavTile>();

  constructor(data: NavDataFile) {
    this.cycle = data.cycle;
    this.airportList = data.airports;
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
      const base = baseName(p.name);
      if (base) this.procsByBase[p.kind].set(base, p);
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

  /**
   * Procedures this token may name, best first: the exact SID and STAR names; only if neither exists, the
   * SID and STAR with the same base name and another version digit. The caller picks the one that serves
   * its airports.
   */
  procedures(token: string): ProcRec[] {
    const exact = [this.procs.SID.get(token), this.procs.STAR.get(token)].filter((p) => p !== undefined);
    if (exact.length > 0) return exact;
    const base = baseName(token);
    if (!base) return [];
    return [this.procsByBase.SID.get(base), this.procsByBase.STAR.get(base)].filter((p) => p !== undefined);
  }

  /** Preferred routes for the pair, as a fresh array (callers may sort or mutate it). */
  prefRoutes(orig: string, dest: string): PrefRouteRec[] {
    return [...(this.pref.get(`${orig}-${dest}`) ?? [])];
  }

  /** The preferred route to use for a pair: high-altitude (H) or North Atlantic (NAR) first, else the first listed. */
  bestPrefRoute(orig: string, dest: string): PrefRouteRec | undefined {
    const all = this.pref.get(`${orig}-${dest}`) ?? [];
    return all.find((r) => r.type === 'H') ?? all.find((r) => r.type === 'NAR') ?? all[0];
  }

  /** AIRAC ident of this cycle ("2610"). */
  get navCycle(): string {
    return airacIdent(this.cycle);
  }

  /**
   * Navaids and airports in the 2 degree x 2 degree cell whose south-west corner is (lat0, lon0). Airports are
   * limited to public-use runways of at least 4,000 ft (spec section 8). Cells are built once and cached.
   */
  tile(lat0: number, lon0: number): NavTile {
    const key = `${lat0},${lon0}`;
    let t = this.tiles.get(key);
    if (!t) {
      const inCell = (p: { lat: number; lon: number }) => p.lat >= lat0 && p.lat < lat0 + 2 && p.lon >= lon0 && p.lon < lon0 + 2;
      t = {
        cycle: this.navCycle,
        navaids: [...this.navaids.values()].flat().filter(inCell).map((n) => ({ ident: n.id, type: n.type, lat: n.lat, lon: n.lon })),
        airports: this.airportList
          .filter((a) => a.pub && a.rwyFt >= 4000 && inCell(a))
          .map((a) => ({ icao: a.icao ?? a.id, lat: a.lat, lon: a.lon })),
      };
      this.tiles.set(key, t);
    }
    return t;
  }

  allPrefRoutes(): PrefRouteRec[] {
    return [...this.pref.values()].flat();
  }
}
