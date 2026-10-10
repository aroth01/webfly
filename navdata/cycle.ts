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

/** AIRAC-style ident of a cycle: two-digit year plus its index among the cycles effective that year ("2026-10-01" → "2610"). */
export function airacIdent(cycle: string): string {
  const t = Date.parse(`${cycle}T00:00:00Z`);
  const year = new Date(t).getUTCFullYear();
  const firstOfYear = EPOCH + Math.ceil((Date.UTC(year, 0, 1) - EPOCH) / CYCLE_MS) * CYCLE_MS;
  const index = Math.floor((t - firstOfYear) / CYCLE_MS) + 1;
  return `${String(year % 100).padStart(2, '0')}${String(index).padStart(2, '0')}`;
}
