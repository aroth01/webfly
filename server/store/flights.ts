import { DatabaseSync } from 'node:sqlite';

export type FlightStatus = 'filed' | 'active' | 'arrived' | 'cancelled';

export interface FlightRow {
  gufi: string;
  callsign: string;
  origin?: string; // ICAO, e.g. "KDFW"
  dest?: string;
  routeText?: string;
  acType?: string;
  etd?: number; // epoch seconds UTC
  atd?: number;
  eta?: number;
  ata?: number;
  status: FlightStatus;
  amendedAt?: number;
  updatedAt: number;
}

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

type Raw = Record<string, string | number | null>;

function fromRaw(r: Raw): FlightRow {
  const row: FlightRow = {
    gufi: r.gufi as string,
    callsign: r.callsign as string,
    status: r.status as FlightStatus,
    updatedAt: r.updated_at as number,
  };
  if (r.origin !== null) row.origin = r.origin as string;
  if (r.dest !== null) row.dest = r.dest as string;
  if (r.route_text !== null) row.routeText = r.route_text as string;
  if (r.ac_type !== null) row.acType = r.ac_type as string;
  if (r.etd !== null) row.etd = r.etd as number;
  if (r.atd !== null) row.atd = r.atd as number;
  if (r.eta !== null) row.eta = r.eta as number;
  if (r.ata !== null) row.ata = r.ata as number;
  if (r.amended_at !== null) row.amendedAt = r.amended_at as number;
  return row;
}

/** SQLite-backed flight plan store (spec §6.2). `path` defaults to an in-memory database. */
export class FlightStore {
  private readonly db: DatabaseSync;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  upsert(r: FlightRow): void {
    this.db
      .prepare(
        `INSERT INTO flights (gufi, callsign, origin, dest, route_text, ac_type, etd, atd, eta, ata, status, amended_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(gufi) DO UPDATE SET
           callsign=excluded.callsign, origin=excluded.origin, dest=excluded.dest, route_text=excluded.route_text,
           ac_type=excluded.ac_type, etd=excluded.etd, atd=excluded.atd, eta=excluded.eta, ata=excluded.ata,
           status=excluded.status, amended_at=excluded.amended_at, updated_at=excluded.updated_at`,
      )
      .run(
        r.gufi,
        r.callsign,
        r.origin ?? null,
        r.dest ?? null,
        r.routeText ?? null,
        r.acType ?? null,
        r.etd ?? null,
        r.atd ?? null,
        r.eta ?? null,
        r.ata ?? null,
        r.status,
        r.amendedAt ?? null,
        r.updatedAt,
      );
  }

  byCallsigns(callsigns: string[]): FlightRow[] {
    if (callsigns.length === 0) return [];
    const marks = callsigns.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT * FROM flights WHERE callsign IN (${marks})`).all(...callsigns);
    return (rows as Raw[]).map(fromRaw);
  }

  /** Delete rows whose `updated_at` is older than `olderThanSec`; returns how many were removed. */
  purge(olderThanSec: number): number {
    return Number(this.db.prepare('DELETE FROM flights WHERE updated_at < ?').run(olderThanSec).changes);
  }

  count(): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM flights').get() as { n: number }).n);
  }
}
