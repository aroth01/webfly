import type { Trail } from '../../shared/types.ts';
import type { TraceFull } from './adsb.ts';

/** trace_full flag bit: this point starts a new leg (readsb splits flights between landing and take-off). */
const NEW_LEG = 2;

const round5 = (x: number) => Math.round(x * 1e5) / 1e5;

/**
 * Trim a day's trace to the current leg (spec §6.4): points after the last on-ground point or
 * new-leg marker, keeping only those flown under `callsign` when one is given.
 */
export function trimTrace(raw: TraceFull, callsign?: string): Trail {
  const pts = raw.trace;
  let start = 0;
  pts.forEach((p, i) => {
    if (p[3] === 'ground') start = i + 1;
    else if (p[6] & NEW_LEG) start = i;
  });
  const out: Trail = [];
  let flight: string | undefined; // callsigns are only reported now and then; carry the last one forward
  for (let i = start; i < pts.length; i++) {
    const p = pts[i]!;
    const f = p[8]?.flight?.trim();
    if (f) flight = f;
    if (callsign && flight && flight !== callsign) continue;
    out.push([Math.round(raw.timestamp + p[0]), round5(p[1]), round5(p[2]), typeof p[3] === 'number' ? p[3] : null]);
  }
  return out;
}
