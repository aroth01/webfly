const DAY_MS = 86_400_000;
const CYCLE_MS = 28 * DAY_MS;
/** A known NASR effective date; every cycle is a whole number of 28-day steps from it. */
const EPOCH = Date.UTC(2026, 9, 1); // 2026-10-01
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Effective date ("YYYY-MM-DD") of the NASR cycle in force at `when` (UTC date granularity). */
export function cycleFor(when: Date): string {
  const n = Math.floor((when.getTime() - EPOCH) / CYCLE_MS);
  return new Date(EPOCH + n * CYCLE_MS).toISOString().slice(0, 10);
}

/** The cycle after `cycle`. */
export function nextCycle(cycle: string): string {
  return new Date(Date.parse(`${cycle}T00:00:00Z`) + CYCLE_MS).toISOString().slice(0, 10);
}

/** FAA download URL of one CSV category zip, e.g. ("2026-10-01", "APT"). */
export function csvZipUrl(cycle: string, category: string): string {
  const [y, m, d] = cycle.split('-');
  const prefix = `${d}_${MONTHS[Number(m) - 1]}_${y}`;
  return `https://nfdc.faa.gov/webContent/28DaySub/extra/${prefix}_${category}_CSV.zip`;
}

/**
 * AIRAC ident ("2610") of a NASR cycle effective date: two-digit year plus the cycle's 1-based number within
 * that year. Cycle 1 is the one effective in January 1-28, so 2026-10-01 is 2610 and 2026-10-29 is 2611.
 * (Plain YYMM would label both 2610 and poison immutable caches keyed by it.)
 */
export function airacIdent(cycle: string): string {
  const t = Date.parse(`${cycle}T00:00:00Z`);
  const year = new Date(t).getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const first = EPOCH + Math.ceil((jan1 - EPOCH) / CYCLE_MS) * CYCLE_MS; // first cycle starting on/after Jan 1
  const n = Math.round((t - first) / CYCLE_MS) + 1;
  return `${String(year % 100).padStart(2, '0')}${String(n).padStart(2, '0')}`;
}
