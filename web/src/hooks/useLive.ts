import { useEffect, useState } from 'react';
import type { LiveState } from '../../../shared/types.ts';
import { api, ApiError } from '../api.ts';
import { useVisible } from './useVisible.ts';

export const LIVE_POLL_MS = 5_000;
/** After a 429, poll every 15 s for a minute (spec §10). */
export const LIVE_BACKOFF_MS = 15_000;
const BACKOFF_FOR_MS = 60_000;

export interface LiveFeed {
  state: LiveState | null;
  receivedAt: number; // client epoch ms when `state` arrived
  error: ApiError | null;
}

/** Next poll delay: 15 s while within a minute of the last 429, else 5 s. */
export function liveDelay(now: number, lastRateLimitAt: number): number {
  return now - lastRateLimitAt < BACKOFF_FOR_MS ? LIVE_BACKOFF_MS : LIVE_POLL_MS;
}

export function useLive(callsign: string | undefined): LiveFeed {
  const [feed, setFeed] = useState<LiveFeed>({ state: null, receivedAt: 0, error: null });
  const visible = useVisible();

  useEffect(() => {
    setFeed({ state: null, receivedAt: 0, error: null });
  }, [callsign]);

  useEffect(() => {
    if (!callsign || !visible) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rateLimitedAt = -Infinity;
    const poll = async () => {
      try {
        const state = await api.live(callsign);
        if (!cancelled) setFeed({ state, receivedAt: Date.now(), error: null });
      } catch (err) {
        const e = err as ApiError;
        if (e.status === 429) rateLimitedAt = Date.now();
        if (!cancelled) setFeed((prev) => ({ ...prev, error: e }));
      }
      if (!cancelled) timer = setTimeout(poll, liveDelay(Date.now(), rateLimitedAt));
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [callsign, visible]);

  return feed;
}
