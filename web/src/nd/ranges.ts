export const RANGES = [10, 20, 40, 80, 160, 320] as const;

/** 80 nm by default, 40 nm when below 10,000 ft (spec section 9.4). */
export function defaultRange(altFt?: number): number {
  return altFt !== undefined && altFt < 10_000 ? 40 : 80;
}

/** The next range in the ring, clamped at both ends. Any value not on the ring snaps to the nearest step first. */
export function stepRange(range: number, dir: 1 | -1): number {
  let idx = 0;
  for (let i = 0; i < RANGES.length; i++) if (Math.abs(RANGES[i] - range) < Math.abs(RANGES[idx] - range)) idx = i;
  return RANGES[Math.max(0, Math.min(RANGES.length - 1, idx + dir))];
}
