import type { FlightView, LiveAircraft } from '../../../shared/types.ts';
import { fmtAltitude, fmtUtc } from '../nd/format.ts';
import type { NavInfo } from '../nd/NdView.tsx';

function RouteBadge({ route }: { route: FlightView['route'] }) {
  if (route.source === 'none') return <span className="badge badge-amber">NO FILED ROUTE</span>;
  const label = route.source === 'filed' ? 'FILED ROUTE' : 'EXPECTED ROUTE';
  return (
    <>
      <span className={route.source === 'filed' ? 'badge badge-green' : 'badge badge-cyan'}>{label}</span>
      {route.amendedAt !== undefined && <span className="strip-note">amended {fmtUtc(route.amendedAt * 1000)}Z</span>}
      {route.partial && <span className="badge badge-amber">PARTIAL</span>}
    </>
  );
}

function statusText(flight: FlightView, ac: LiveAircraft | null | undefined, nav: NavInfo): string {
  if (ac && !ac.onGround && nav.destEtaMs !== undefined) return `ETA ${fmtUtc(nav.destEtaMs)}Z · ${Math.round(nav.remainingNm ?? 0)} NM`;
  if (flight.status === 'arrived') return 'ARRIVED';
  if (flight.status === 'filed' && flight.etd !== undefined) return `ETD ${fmtUtc(flight.etd * 1000)}Z`;
  if (flight.status === 'active' && flight.eta !== undefined) return `ETA ${fmtUtc(flight.eta * 1000)}Z`;
  return flight.status.toUpperCase();
}

export function FlightStrip({ flight, aircraft, nav, onBack }: { flight: FlightView; aircraft: LiveAircraft | null | undefined; nav: NavInfo; onBack: () => void }) {
  return (
    <section className="strip" aria-label="Flight details">
      <div className="strip-row strip-main">
        <button type="button" className="strip-back" onClick={onBack} aria-label="New search">
          ‹
        </button>
        <span className="strip-cs">{flight.callsign}</span>
        {flight.acType && <span className="strip-type">{flight.acType}</span>}
        <span className="strip-route">
          {flight.origin?.icao ?? '----'} → {flight.dest?.icao ?? '----'}
        </span>
        <span className="strip-alt">{fmtAltitude(aircraft?.altBaro, aircraft?.onGround)}</span>
      </div>
      <div className="strip-row">
        <RouteBadge route={flight.route} />
        <span className="strip-status">{statusText(flight, aircraft, nav)}</span>
      </div>
      {flight.degraded === 'swim_delayed' && <div className="strip-row banner">Filed routes may be delayed</div>}
      <div className="strip-row attribution">
        {flight.operator ? `${flight.operator} · ` : ''}
        <a href="https://adsb.lol">adsb.lol</a> (ODbL) · FAA NASR {flight.navCycle}
      </div>
    </section>
  );
}
