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
