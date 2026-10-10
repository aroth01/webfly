import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlightChoice, FlightView } from '../../../shared/types.ts';
import { api, ApiError } from '../api.ts';
import { useVisible } from './useVisible.ts';

export type FlightState =
  | { kind: 'loading' }
  | { kind: 'flight'; view: FlightView }
  | { kind: 'choices'; choices: FlightChoice[] }
  | { kind: 'error'; error: ApiError };

/** Re-fetch the flight every 2 min (spec §8) to pick up amendments and status changes. */
export const FLIGHT_POLL_MS = 120_000;

export function useFlight(query: string): { state: FlightState; refresh: () => void } {
  const [state, setState] = useState<FlightState>({ kind: 'loading' });
  const visible = useVisible();
  const lastFetch = useRef(0);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    setState({ kind: 'loading' });
    lastFetch.current = 0;
  }, [query]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      lastFetch.current = Date.now();
      try {
        const res = await api.flight(query);
        if (cancelled) return;
        setState('choices' in res ? { kind: 'choices', choices: res.choices } : { kind: 'flight', view: res });
      } catch (err) {
        if (cancelled) return;
        // Keep showing a flight we already have when a refresh fails.
        setState((prev) => (prev.kind === 'flight' && (err as ApiError).status !== 404 ? prev : { kind: 'error', error: err as ApiError }));
      }
      if (!cancelled) timer = setTimeout(load, FLIGHT_POLL_MS);
    };
    const due = lastFetch.current + FLIGHT_POLL_MS - Date.now();
    timer = setTimeout(load, lastFetch.current === 0 ? 0 : Math.max(0, due));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, visible, tick]);

  return { state, refresh };
}
