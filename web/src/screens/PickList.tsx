import type { FlightChoice } from '../../../shared/types.ts';
import { fmtUtc } from '../nd/format.ts';

export function PickList({ query, choices, navigate }: { query: string; choices: FlightChoice[]; navigate: (path: string, replace?: boolean) => void }) {
  return (
    <main className="screen pick-screen">
      <button type="button" className="back-btn" onClick={() => navigate('/')}>
        ‹ NEW SEARCH
      </button>
      <h1 className="pick-title">{query}: SELECT FLIGHT</h1>
      <p className="pick-hint">More than one operator flies this number right now.</p>
      <ul className="pick-list">
        {choices.map((c) => (
          <li key={c.callsign}>
            <button type="button" className="pick-btn" onClick={() => navigate(`/f/${c.query}`, true)}>
              <span className="pick-cs">{c.callsign}</span>
              <span className="pick-route">
                {c.origin ?? '----'} → {c.dest ?? '----'}
              </span>
              <span className="pick-status">
                {c.status.toUpperCase()}
                {c.etd !== undefined && c.status === 'filed' ? ` · ETD ${fmtUtc(c.etd * 1000)}Z` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
