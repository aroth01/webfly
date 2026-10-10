import { destinationPoint, normalizeDeg, type LatLon } from '../../../shared/geo.ts';

/** A position report with the client-clock time it was valid at. */
export interface Fix {
  lat: number;
  lon: number;
  gs?: number; // kt
  track?: number; // degrees true
  t: number; // epoch ms (client clock)
}

/** Dead reckoning stops after this long without a new position (spec §10). */
export const MAX_DEAD_RECKON_MS = 60_000;
/** A new fix's disagreement with the shown position is blended away over this long (spec §9.4). */
export const BLEND_MS = 1_000;
/** Time constant for easing the display rotation (spec §9.4). */
export const ROTATION_TAU_MS = 500;

export function deadReckon(fix: Fix, t: number): LatLon {
  if (fix.gs === undefined || fix.track === undefined || fix.gs < 1) return { lat: fix.lat, lon: fix.lon };
  const dt = Math.min(Math.max(0, t - fix.t), MAX_DEAD_RECKON_MS);
  return destinationPoint(fix, fix.track, (fix.gs * dt) / 3_600_000);
}

const wrapLon = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** Smoothly moving aircraft position: dead reckoning from the latest fix, blending out corrections. */
export class Motion {
  private fix: Fix | undefined;
  private err = { lat: 0, lon: 0 };
  private errAt = 0;

  /** Accept a fix; older or repeated fixes are ignored. */
  update(fix: Fix, now: number): void {
    if (this.fix && fix.t <= this.fix.t) return;
    const shown = this.position(now);
    this.fix = fix;
    if (shown) {
      const predicted = deadReckon(fix, now);
      this.err = { lat: shown.lat - predicted.lat, lon: wrapLon(shown.lon - predicted.lon) };
      this.errAt = now;
    }
  }

  position(now: number): LatLon | undefined {
    if (!this.fix) return undefined;
    const p = deadReckon(this.fix, now);
    const k = Math.max(0, 1 - (now - this.errAt) / BLEND_MS);
    return { lat: p.lat + this.err.lat * k, lon: wrapLon(p.lon + this.err.lon * k) };
  }

  /** Age of the latest fix in ms, or undefined before the first one. */
  ageMs(now: number): number | undefined {
    return this.fix && Math.max(0, now - this.fix.t);
  }

  reset(): void {
    this.fix = undefined;
    this.err = { lat: 0, lon: 0 };
  }
}

/** Signed shortest rotation from a to b, in (-180, 180]. */
export function angleDiff(a: number, b: number): number {
  const d = normalizeDeg(b - a);
  return d > 180 ? d - 360 : d;
}

/** An angle that eases toward its target along the shortest path. */
export class EasedAngle {
  value: number | undefined;

  update(target: number, dtMs: number): number {
    if (this.value === undefined || dtMs > 5_000) {
      this.value = normalizeDeg(target);
    } else {
      this.value = normalizeDeg(this.value + angleDiff(this.value, target) * (1 - Math.exp(-dtMs / ROTATION_TAU_MS)));
    }
    return this.value;
  }
}
