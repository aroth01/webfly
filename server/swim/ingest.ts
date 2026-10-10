import type { FlightRecord, FlightStore, StoredStatus } from '../store/flights.ts';
import { parseSfdps, type SfdpsFlight } from './parse.ts';
import { KEPT_SOURCES, mayContainKept } from './prefilter.ts';

const FDPS_STATUS: Record<string, StoredStatus> = {
  PROPOSED: 'filed',
  ACTIVE: 'active',
  COMPLETED: 'arrived',
  CANCELLED: 'cancelled',
  // Updates stopped before landing (left FAA airspace, or went VFR). Left "active", the plan would
  // outrank tomorrow's flight with the same callsign until the 36 h purge.
  DROPPED: 'arrived',
};
/** What a message type implies when it carries no status. */
const SOURCE_STATUS: Record<string, StoredStatus> = { DH: 'active', HV: 'arrived', RH: 'arrived', CL: 'cancelled' };
/** Batches can arrive out of order, so a flight's status only moves forward. */
const STATUS_RANK: Record<StoredStatus, number> = { filed: 0, cancelled: 1, active: 2, arrived: 3 };

/** Map one parsed SFDPS flight onto a store record, given the stored row; undefined if it can't be keyed. */
export function toFlightRecord(msg: SfdpsFlight, prev: FlightRecord | undefined, nowSec: number): FlightRecord | undefined {
  const callsign = msg.callsign ?? prev?.callsign;
  if (!msg.gufi || !callsign) return undefined;
  const incoming = (msg.fdpsStatus !== undefined ? FDPS_STATUS[msg.fdpsStatus] : undefined) ?? SOURCE_STATUS[msg.source];
  let status = incoming ?? prev?.status ?? 'filed';
  if (prev && STATUS_RANK[status] < STATUS_RANK[prev.status]) status = prev.status;

  const rec: FlightRecord = { gufi: msg.gufi, callsign, status, updatedAt: nowSec };
  const set = <K extends keyof FlightRecord>(k: K, v: FlightRecord[K] | undefined) => {
    if (v !== undefined) rec[k] = v;
  };
  set('origin', msg.origin);
  set('dest', msg.dest);
  set('routeText', msg.routeText);
  set('acType', msg.acType);
  set('etd', msg.etd);
  set('eta', msg.eta);
  set('atd', msg.atd ?? (msg.source === 'DH' ? msg.timestamp : undefined));
  set('ata', msg.ata ?? (msg.source === 'HV' || msg.source === 'RH' ? msg.timestamp : undefined));
  if (msg.source === 'AH' || msg.source === 'IH') rec.amendedAt = msg.timestamp ?? nowSec;
  return rec;
}

/** Events per minute over a sliding 60 s window, in one-second buckets. */
export class RateCounter {
  private readonly counts = new Array<number>(60).fill(0);
  private readonly seconds = new Array<number>(60).fill(-1);

  add(nowMs: number, n = 1): void {
    const sec = Math.floor(nowMs / 1000);
    const i = sec % 60;
    if (this.seconds[i] !== sec) {
      this.seconds[i] = sec;
      this.counts[i] = 0;
    }
    this.counts[i] = (this.counts[i] as number) + n;
  }

  perMin(nowMs: number): number {
    const sec = Math.floor(nowMs / 1000);
    let sum = 0;
    for (let i = 0; i < 60; i++) {
      const s = this.seconds[i] as number;
      if (s <= sec && sec - s < 60) sum += this.counts[i] as number;
    }
    return sum;
  }
}

export interface IngestResult {
  kept: boolean;
  upserts: number;
  error?: string;
}

/** Prefilter → parse → merge-upsert, with the counters /api/health reports (spec §6.2). */
export class SwimIngest {
  readonly kept = new RateCounter();
  readonly dropped = new RateCounter();
  lastKeptAt: number | null = null; // epoch ms
  upserts = 0;
  parseErrors = 0;
  private readonly store: FlightStore;
  private readonly now: () => number;

  constructor(store: FlightStore, now: () => number = Date.now) {
    this.store = store;
    this.now = now;
  }

  /** Handle one SCDS message payload. Counted as kept when it updated at least one flight. */
  handle(raw: string): IngestResult {
    const now = this.now();
    if (!mayContainKept(raw)) {
      this.dropped.add(now);
      return { kept: false, upserts: 0 };
    }
    let flights: SfdpsFlight[];
    try {
      flights = parseSfdps(raw);
    } catch (err) {
      this.parseErrors++;
      this.dropped.add(now);
      return { kept: false, upserts: 0, error: (err as Error).message };
    }
    let n = 0;
    for (const f of flights) {
      if (!KEPT_SOURCES.has(f.source) || !f.gufi) continue;
      const rec = toFlightRecord(f, this.store.get(f.gufi), Math.floor(now / 1000));
      if (!rec) continue;
      this.store.upsert(rec);
      n++;
    }
    if (n > 0) {
      this.kept.add(now);
      this.lastKeptAt = now;
      this.upserts += n;
    } else {
      this.dropped.add(now);
    }
    return { kept: n > 0, upserts: n };
  }
}
