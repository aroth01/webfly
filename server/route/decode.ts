import { destinationPoint, distanceNm, distanceToSegmentNm, normalizeDeg } from '../../shared/geo.ts';
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
/** A point this far from the segment between its neighbors is a bad ident match. */
const ZIGZAG_NM = 300;
/** Longest run of consecutive bad points the zig-zag guard removes as a unit. */
const ZIGZAG_MAX_RUN = 4;
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
  // FAA ids of the airports SIDs and STARs must serve: from the options, else the route's own end tokens.
  const airportId = (id: string | undefined) => (id ? db.airport(id)?.id : undefined);
  const originId = airportId(opts.origin || tokens[0]);
  const destId = airportId(opts.dest || tokens[tokens.length - 1]);

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

    const procs = db.procedures(tok);
    if (procs.length > 0) {
      // A SID must serve the origin and a STAR the destination; otherwise the name matched someone else's procedure.
      const proc = procs.find((p) => {
        const apt = p.kind === 'SID' ? originId : destId;
        return p.airports.length === 0 || apt === undefined || p.airports.includes(apt);
      });
      if (!proc) unresolved.push(tok);
      else if (proc.kind === 'SID') {
        addAll(proc.body, proc.name);
        const trans = next ? proc.transitions[next] : undefined;
        if (trans) addAll(trans, proc.name);
      } else {
        const entry = last()?.ident;
        const trans = entry ? proc.transitions[entry] : undefined;
        if (trans) addAll(trans, proc.name);
        addAll(proc.body, proc.name);
      }
      continue;
    }

    const p = resolve(tok);
    if (p) add(p);
    else unresolved.push(tok);
  }

  if (opts.dest && !sameAirport(tokens[tokens.length - 1], opts.dest)) add(airportPoint(opts.dest));

  const dropped = dropZigZags(points);
  return { points, partial: unresolved.length > 0 || dropped.length > 0, unresolved, dropped };
}

/**
 * Zig-zag guard (spec §6.3). Each pass scores every run of 1..ZIGZAG_MAX_RUN consecutive interior points against
 * the segment joining the run's outer neighbours, and removes the one run whose nearest-to-the-route member is
 * farthest from it, provided every member is more than ZIGZAG_NM off. Repeats until nothing is that far off.
 * - Segment (not great-circle) distance catches out-and-back spikes that lie along the line of the route.
 * - Runs catch clusters of wrong points (a wrong SID/STAR's fixes) that would shield each other one at a time.
 * - Removing only the worst run per pass keeps a good point that merely looks off-line next to a far outlier.
 * Mutates `points`; returns the removed idents in removal order.
 */
function dropZigZags(points: RoutePoint[]): string[] {
  const dropped: string[] = [];
  for (;;) {
    let worst: { start: number; len: number; score: number } | undefined;
    for (let len = 1; len <= ZIGZAG_MAX_RUN; len++) {
      for (let start = 1; start + len < points.length; start++) {
        const a = points[start - 1] as RoutePoint;
        const b = points[start + len] as RoutePoint;
        if (distanceNm(a, b) <= 1) continue; // no segment to measure against (e.g. a round trip)
        let score = Infinity;
        for (let i = start; i < start + len; i++) score = Math.min(score, distanceToSegmentNm(points[i] as RoutePoint, a, b));
        if (score > ZIGZAG_NM && (!worst || score > worst.score)) worst = { start, len, score };
      }
    }
    if (!worst) return dropped;
    for (const p of points.splice(worst.start, worst.len)) dropped.push(p.ident);
  }
}
