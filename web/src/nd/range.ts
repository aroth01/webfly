/** Selectable ND ranges in nm (spec §9.4). */
export const RANGES = [10, 20, 40, 80, 160, 320] as const;

export function stepRange(current: number, dir: 1 | -1): number {
  const i = RANGES.findIndex((r) => r >= current);
  const idx = i < 0 ? RANGES.length - 1 : i;
  return RANGES[Math.max(0, Math.min(RANGES.length - 1, idx + dir))] as number;
}

/** 80 nm, or 40 nm when the aircraft is below 10,000 ft. */
export function defaultRange(altFt: number | undefined): number {
  return altFt !== undefined && altFt < 10_000 ? 40 : 80;
}
