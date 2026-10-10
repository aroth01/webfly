import { useEffect, useMemo, useRef, useState } from 'react';
import { distanceNm, type LatLon } from '../../../shared/geo.ts';
import type { FlightView } from '../../../shared/types.ts';
import { api, ApiError } from '../api.ts';
import { useFlight } from '../hooks/useFlight.ts';
import { useLive } from '../hooks/useLive.ts';
import { NdView, type NavInfo } from '../nd/NdView.tsx';
import { defaultRange } from '../nd/range.ts';
import { TileCache } from '../nd/tiles.ts';
import { FlightStrip } from './FlightStrip.tsx';
import { PickList } from './PickList.tsx';

type Nav = (path: string, replace?: boolean) => void;

const MAX_TRAIL = 6_000;

export function FlightScreen({ query, navigate }: { query: string; navigate: Nav }) {
  const { state, refresh } = useFlight(query);

  useEffect(() => {
    document.title = state.kind === 'flight' ? `WebFly · ${state.view.callsign}` : `WebFly · ${query}`;
  }, [state, query]);

  if (state.kind === 'loading') return <Message text={`Looking up ${query}…`} />;
  if (state.kind === 'choices') return <PickList query={query} choices={state.choices} navigate={navigate} />;
  if (state.kind === 'error') {
    return <Message text={state.error.message} action={state.error.status === 0 ? { label: 'RETRY', onClick: refresh } : undefined} onBack={() => navigate('/')} />;
  }
  return <NdScreen flight={state.view} navigate={navigate} onStaleCycle={refresh} />;
}

function Message({ text, action, onBack }: { text: string; action?: { label: string; onClick: () => void } | undefined; onBack?: () => void }) {
  return (
    <main className="screen message-screen">
      <p className="message" role="status">
        {text}
      </p>
      <div className="message-actions">
        {action && (
          <button type="button" className="go-btn" onClick={action.onClick}>
            {action.label}
          </button>
        )}
        {onBack && (
          <button type="button" className="back-btn" onClick={onBack}>
            ‹ NEW SEARCH
          </button>
        )}
      </div>
    </main>
  );
}

function NdScreen({ flight, navigate, onStaleCycle }: { flight: FlightView; navigate: Nav; onStaleCycle: () => void }) {
  const feed = useLive(flight.callsign);
  const aircraft = feed.state?.aircraft;
  const [range, setRange] = useState<number | null>(null);
  const [nav, setNav] = useState<NavInfo>({});
  const [trail, setTrail] = useState<Array<[number, number, number]>>([]);
  const hex = aircraft?.hex ?? flight.hex;

  const onStaleRef = useRef(onStaleCycle);
  onStaleRef.current = onStaleCycle;
  const tiles = useMemo(() => {
    const cache = new TileCache(api.tile);
    cache.onError = (err) => {
      if (err instanceof ApiError && err.code === 'stale_cycle') onStaleRef.current();
    };
    return cache;
  }, []);

  // The range defaults once, at the first position; after that it belongs to the user.
  useEffect(() => {
    if (range === null && aircraft) setRange(defaultRange(aircraft.onGround ? 0 : aircraft.altBaro));
  }, [aircraft, range]);

  // Backfill the trail once per flight, then extend it with each new position.
  useEffect(() => {
    setTrail([]);
    if (!hex) return;
    let cancelled = false;
    api.trail(hex, flight.callsign).then(
      (t) => !cancelled && setTrail((cur) => [...t.map(([ts, lat, lon]): [number, number, number] => [ts * 1000, lat, lon]), ...cur]),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [hex, flight.callsign]);

  useEffect(() => {
    if (!aircraft || aircraft.onGround) return;
    const t = feed.receivedAt - aircraft.ageSec * 1000;
    setTrail((cur) => {
      const last = cur[cur.length - 1];
      if (last && (t <= last[0] || distanceNm({ lat: last[1], lon: last[2] }, aircraft) < 0.1)) return cur;
      const next = [...cur, [t, aircraft.lat, aircraft.lon] as [number, number, number]];
      return next.length > MAX_TRAIL ? next.slice(-MAX_TRAIL) : next;
    });
  }, [aircraft, feed.receivedAt]);

  const trailPts = useMemo<LatLon[]>(() => trail.map(([, lat, lon]) => ({ lat, lon })), [trail]);

  return (
    <main className="screen nd-screen">
      <NdView
        flight={flight}
        live={feed.state}
        liveReceivedAt={feed.receivedAt}
        trail={trailPts}
        tiles={tiles}
        range={range ?? 80}
        onRange={setRange}
        onNavInfo={setNav}
      />
      <FlightStrip flight={flight} aircraft={aircraft} nav={nav} onBack={() => navigate('/')} />
    </main>
  );
}
