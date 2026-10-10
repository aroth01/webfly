/** SWIM consumer state reported by /api/health and used for the "swim_delayed" flag (spec §6.2, §10). */
export interface SwimStatus {
  enabled: boolean;
  startedAt: number | null; // epoch ms the consumer started; grace period before the first message
  connected: boolean;
  lastMessageAt: number | null; // epoch ms of the last kept message
  keptPerMin: number;
  droppedPerMin: number;
  reconnects: number;
}

export const SWIM_DISABLED: SwimStatus = {
  enabled: false,
  startedAt: null,
  connected: false,
  lastMessageAt: null,
  keptPerMin: 0,
  droppedPerMin: 0,
  reconnects: 0,
};

/** No kept message for this long means filed routes may be stale. */
const SWIM_DELAYED_MS = 3 * 60_000;

export function isSwimDelayed(s: SwimStatus, nowMs: number): boolean {
  if (!s.enabled) return false;
  const since = s.lastMessageAt ?? s.startedAt;
  return since === null || nowMs - since > SWIM_DELAYED_MS;
}
