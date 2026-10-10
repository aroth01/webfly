import { destinationPoint, normalizeDeg, type LatLon } from '../../../shared/geo.ts';

export interface Fix extends LatLon {
  track?: number;
  gs?: number; // knots
  /** Age of the position when the fix was received, seconds. */
  ageSec?: number;
}

export interface TrackedPosition extends LatLon {
  track?: number;
  gs?: number;
  /** Seconds since the position was true, at the time asked. */
  ageSec: number;
  /** True once dead reckoning has run out (spec: 60 s) and the symbol stops moving. */
  frozen: boolean;
}

const MAX_COAST_MS = 60_000;
const BLEND_MS = 1_000;

function deadReckon(fix: Fix, elapsedMs: number): LatLon {
  if (fix.track === undefined || fix.gs === undefined || fix.gs <= 0 || elapsedMs <= 0) return { lat: fix.lat, lon: fix.lon };
  return destinationPoint(fix, fix.track, (fix.gs * elapsedMs) / 3_600_000);
}

/**
 * Smooths the 5-second position fixes into continuous motion (spec section 9.4): dead-reckon from the last
 * fix using gs and track; when a new fix arrives, bleed the predicted-versus-actual error to zero over 1 s.
 */
export class PositionTracker {
  private fix: Fix | undefined;
  private fixAt = 0; // epoch ms the fix was true
  private pushedAt = 0;
  private errLat = 0;
  private errLon = 0;

  push(fix: Fix, nowMs: number): void {
    const fixAt = nowMs - (fix.ageSec ?? 0) * 1000;
    // Error between where we were drawing the aircraft and where the new fix says it is, both at `nowMs`.
    if (this.fix) {
      const shown = this.at(nowMs);
      const actual = deadReckon(fix, nowMs - fixAt);
      this.errLat = shown.lat - actual.lat;
      this.errLon = shown.lon - actual.lon;
    } else {
      this.errLat = 0;
      this.errLon = 0;
    }
    this.fix = fix;
    this.fixAt = fixAt;
    this.pushedAt = nowMs;
  }

  private rawAt(nowMs: number): LatLon {
    const fix = this.fix as Fix;
    return deadReckon(fix, Math.min(nowMs - this.fixAt, MAX_COAST_MS));
  }

  at(nowMs: number): TrackedPosition {
    const fix = this.fix;
    if (!fix) throw new Error('PositionTracker.at() before push()');
    const elapsed = nowMs - this.fixAt;
    const base = this.rawAt(nowMs);
    const k = Math.max(0, 1 - (nowMs - this.pushedAt) / BLEND_MS);
    const out: TrackedPosition = {
      lat: base.lat + this.errLat * k,
      lon: base.lon + this.errLon * k,
      ageSec: Math.max(0, elapsed / 1000),
      frozen: elapsed > MAX_COAST_MS,
    };
    if (fix.track !== undefined) out.track = fix.track;
    if (fix.gs !== undefined) out.gs = fix.gs;
    return out;
  }

  get hasFix(): boolean {
    return this.fix !== undefined;
  }
}

/** Move `current` toward `target` along the shortest arc with a first-order lag of time constant `tauMs`. */
export function easeAngle(current: number, target: number, dtMs: number, tauMs: number): number {
  const diff = ((((target - current) % 360) + 540) % 360) - 180;
  return normalizeDeg(current + diff * (1 - Math.exp(-dtMs / tauMs)));
}
