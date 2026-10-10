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
