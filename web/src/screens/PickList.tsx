import type { FlightChoice } from '../../../shared/types.ts';
import { formatUtc } from '../nd/draw.ts';
import { navigate } from '../router.ts';

export function PickList({ choices, query }: { choices: FlightChoice[]; query: string }) {
  return (
    <main className="input-screen">
      <h1 className="cyan">{query.toUpperCase()}: SELECT FLIGHT</h1>
      <ul className="picks">
        {choices.map((c) => (
          <li key={`${c.callsign}-${c.origin}-${c.dest}`}>
            <button type="button" onClick={() => navigate(`/f/${encodeURIComponent(c.query)}`)}>
              <strong>{c.callsign}</strong> {c.origin ?? '----'} → {c.dest ?? '----'}
              <span>
                {c.status.toUpperCase()}
                {c.etd !== undefined ? ` · ETD ${formatUtc(c.etd * 1000)}Z` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="back" onClick={() => navigate('/')}>
        ← NEW SEARCH
      </button>
    </main>
  );
}
