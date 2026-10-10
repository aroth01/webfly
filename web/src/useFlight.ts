import { useEffect, useRef, useState } from 'react';
import type { FlightChoice, FlightView, LiveState, Trail } from '../../shared/types.ts';
import { isChoices } from './api.ts';
import type { DataSource } from './source.ts';

export const FLIGHT_POLL_MS = 120_000;
export const LIVE_POLL_MS = 5_000;
export const BACKOFF_POLL_MS = 15_000;
export const BACKOFF_FOR_MS = 60_000;

export type FlightState =
  | { status: 'loading' }
  | { status: 'error'; code: string; message: string }
  | { status: 'choices'; choices: FlightChoice[] }
  | { status: 'ready'; flight: FlightView; live: LiveState | null; trail: Trail };

/** Poll interval for /api/live: normal, or 15 s for a minute after a 429 (spec section 8). */
export function liveInterval(nowMs: number, backoffUntilMs: number): number {
  return nowMs < backoffUntilMs ? BACKOFF_POLL_MS : LIVE_POLL_MS;
}

/**
 * Loads a flight and keeps it current: /api/flight every 2 min, /api/live every 5 s, /api/trail once per flight.
 * Polling pauses while the tab is hidden and catches up the moment it is visible again.
 */
export function useFlight(query: string, source: DataSource): FlightState {
  const [state, setState] = useState<FlightState>({ status: 'loading' });
  const backoffUntil = useRef(0);

  useEffect(() => {
    const ac = new AbortController();
    let flight: FlightView | undefined;
    let liveTimer: ReturnType<typeof setTimeout> | undefined;
    let flightTimer: ReturnType<typeof setTimeout> | undefined;
    let trailKey = '';
    let live: LiveState | null = null;
    let trail: Trail = [];
    setState({ status: 'loading' });
    backoffUntil.current = 0;

    const publish = () => {
      if (flight && !ac.signal.aborted) setState({ status: 'ready', flight, live, trail });
    };

    const loadTrail = async () => {
      const hex = live?.aircraft?.hex ?? flight?.hex;
      if (!hex || !flight) return;
      const key = `${flight.callsign}|${hex}`;
      if (key === trailKey) return;
      trailKey = key;
      const r = await source.trail(hex, flight.callsign, ac.signal);
      if (r.ok) {
        trail = r.data;
        publish();
      }
    };

    const pollLive = async () => {
      if (!flight) return;
      if (!document.hidden) {
        const r = await source.live(flight.callsign, ac.signal);
        if (ac.signal.aborted) return;
        if (r.ok) {
          live = r.data;
          publish();
          void loadTrail();
        } else if (r.status === 429) backoffUntil.current = Date.now() + BACKOFF_FOR_MS;
      }
      liveTimer = setTimeout(pollLive, liveInterval(Date.now(), backoffUntil.current));
    };

    const pollFlight = async (first: boolean) => {
      if (first || !document.hidden) {
        const r = await source.flight(query, ac.signal);
        if (ac.signal.aborted) return;
        if (r.ok) {
          if (isChoices(r.data)) {
            setState({ status: 'choices', choices: r.data.choices });
            return;
          }
          const firstLoad = flight === undefined;
          flight = r.data;
          publish();
          if (firstLoad) void pollLive();
        } else if (first) {
          setState({ status: 'error', code: r.code, message: r.message });
          return;
        } else if (r.status === 429) backoffUntil.current = Date.now() + BACKOFF_FOR_MS;
      }
      flightTimer = setTimeout(() => void pollFlight(false), FLIGHT_POLL_MS);
    };

    const onVisible = () => {
      if (document.hidden || !flight) return;
      clearTimeout(liveTimer);
      void pollLive();
    };
    document.addEventListener('visibilitychange', onVisible);
    void pollFlight(true);

    return () => {
      ac.abort();
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(liveTimer);
      clearTimeout(flightTimer);
    };
  }, [query, source]);

  return state;
}
