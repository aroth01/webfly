import { useState, type FormEvent } from 'react';
import { cleanQuery } from '../query.ts';
import { loadRecent, saveRecent } from '../recent.ts';

export function InputScreen({ navigate }: { navigate: (path: string) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [recent] = useState(loadRecent);

  const go = (input: string) => {
    const q = cleanQuery(input);
    if (!q) {
      setError('Enter an airline code and flight number, like AA558.');
      return;
    }
    saveRecent(q);
    navigate(`/f/${q}`);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    go(value);
  };

  return (
    <main className="screen input-screen">
      <h1 className="brand">WEBFLY</h1>
      <form className="flt-form" onSubmit={onSubmit} noValidate>
        <label htmlFor="flt" className="flt-label">
          FLT NBR
        </label>
        <div className="flt-row">
          <input
            id="flt"
            className="flt-input"
            value={value}
            onChange={(e) => {
              setValue(e.target.value.toUpperCase());
              setError('');
            }}
            placeholder="AA558"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={10}
            enterKeyHint="go"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'flt-error' : undefined}
            autoFocus
          />
          <button type="submit" className="go-btn">
            GO
          </button>
        </div>
        <p id="flt-error" className="flt-error" role="alert">
          {error}
        </p>
      </form>
      {recent.length > 0 && (
        <section className="recent" aria-label="Recent searches">
          <h2 className="recent-title">RECENT</h2>
          <ul>
            {recent.map((q) => (
              <li key={q}>
                <button type="button" className="recent-btn" onClick={() => go(q)}>
                  {q}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <footer className="attribution">
        Live data <a href="https://adsb.lol">adsb.lol</a> (ODbL) · Nav data FAA NASR
      </footer>
    </main>
  );
}
