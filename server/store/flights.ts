import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export type StoredStatus = 'filed' | 'active' | 'arrived' | 'cancelled';

/** One flight plan, keyed by its GUFI. Times are epoch seconds UTC. */
export interface FlightRecord {
  gufi: string;
  callsign: string;
  origin?: string; // ICAO, e.g. "KDFW"
  dest?: string;
  routeText?: string;
  acType?: string;
  etd?: number;
  atd?: number;
  eta?: number;
  ata?: number;
  status: StoredStatus;
  amendedAt?: number;
  updatedAt: number;
}

// Spec §6.2.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS flights (
  gufi        TEXT PRIMARY KEY,
  callsign    TEXT NOT NULL,
  origin      TEXT,
  dest        TEXT,
  route_text  TEXT,
  ac_type     TEXT,
  etd INTEGER, atd INTEGER, eta INTEGER, ata INTEGER,
  status      TEXT NOT NULL,
  amended_at  INTEGER,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS flights_callsign ON flights(callsign);
`;

// Messages often carry only some fields (a departure message has the ATD but no route),
// so an update never erases a value it doesn't mention.
const UPSERT = `
INSERT INTO flights (gufi, callsign, origin, dest, route_text, ac_type, etd, atd, eta, ata, status, amended_at, updated_at)
VALUES (:gufi, :callsign, :origin, :dest, :route_text, :ac_type, :etd, :atd, :eta, :ata, :status, :amended_at, :updated_at)
ON CONFLICT(gufi) DO UPDATE SET
  callsign   = excluded.callsign,
  origin     = COALESCE(excluded.origin, flights.origin),
  dest       = COALESCE(excluded.dest, flights.dest),
  route_text = COALESCE(excluded.route_text, flights.route_text),
  ac_type    = COALESCE(excluded.ac_type, flights.ac_type),
  etd        = COALESCE(excluded.etd, flights.etd),
  atd        = COALESCE(excluded.atd, flights.atd),
  eta        = COALESCE(excluded.eta, flights.eta),
  ata        = COALESCE(excluded.ata, flights.ata),
  status     = excluded.status,
  amended_at = COALESCE(excluded.amended_at, flights.amended_at),
  updated_at = excluded.updated_at
`;

interface Row {
  gufi: string;
  callsign: string;
  origin: string | null;
  dest: string | null;
  route_text: string | null;
  ac_type: string | null;
  etd: number | null;
  atd: number | null;
  eta: number | null;
  ata: number | null;
  status: StoredStatus;
  amended_at: number | null;
  updated_at: number;
}

function toRecord(r: Row): FlightRecord {
  const rec: FlightRecord = { gufi: r.gufi, callsign: r.callsign, status: r.status, updatedAt: r.updated_at };
  if (r.origin !== null) rec.origin = r.origin;
  if (r.dest !== null) rec.dest = r.dest;
  if (r.route_text !== null) rec.routeText = r.route_text;
  if (r.ac_type !== null) rec.acType = r.ac_type;
  if (r.etd !== null) rec.etd = r.etd;
  if (r.atd !== null) rec.atd = r.atd;
  if (r.eta !== null) rec.eta = r.eta;
  if (r.ata !== null) rec.ata = r.ata;
  if (r.amended_at !== null) rec.amendedAt = r.amended_at;
  return rec;
}

/** SQLite store of flight plans (spec §6.2). Pass ":memory:" for tests. */
export class FlightStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.db.exec(SCHEMA);
  }

  upsert(rec: FlightRecord): void {
    const params: Record<string, SQLInputValue> = {
      gufi: rec.gufi,
      callsign: rec.callsign,
      origin: rec.origin ?? null,
      dest: rec.dest ?? null,
      route_text: rec.routeText ?? null,
      ac_type: rec.acType ?? null,
      etd: rec.etd ?? null,
      atd: rec.atd ?? null,
      eta: rec.eta ?? null,
      ata: rec.ata ?? null,
      status: rec.status,
      amended_at: rec.amendedAt ?? null,
      updated_at: rec.updatedAt,
    };
    this.db.prepare(UPSERT).run(params);
  }

  get(gufi: string): FlightRecord | undefined {
    const row = this.db.prepare('SELECT * FROM flights WHERE gufi = ?').get(gufi) as Row | undefined;
    return row && toRecord(row);
  }

  byCallsigns(callsigns: string[]): FlightRecord[] {
    if (callsigns.length === 0) return [];
    const marks = callsigns.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT * FROM flights WHERE callsign IN (${marks})`).all(...callsigns) as unknown as Row[];
    return rows.map(toRecord);
  }

  /** Delete plans not updated since `cutoffSec` (epoch s); returns the number deleted. */
  purge(cutoffSec: number): number {
    return Number(this.db.prepare('DELETE FROM flights WHERE updated_at < ?').run(cutoffSec).changes);
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM flights').get() as { n: number }).n;
  }

  close(): void {
    this.db.close();
  }
}
