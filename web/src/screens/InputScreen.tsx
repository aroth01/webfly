import { useState, type FormEvent } from 'react';
import { checkQuery } from '../query.ts';
import { addRecent, loadRecent } from '../recent.ts';
import { navigate } from '../router.ts';

export function InputScreen() {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [recent] = useState(() => loadRecent());

  const go = (raw: string) => {
    const c = checkQuery(raw);
    if (!c.ok) {
      setError(c.message);
      return;
    }
    addRecent(c.query);
    navigate(`/f/${encodeURIComponent(c.query)}`);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    go(value);
  };

  return (
    <main className="input-screen">
      <form onSubmit={submit}>
        <label htmlFor="flt" className="cyan">
          FLT NBR
        </label>
        <input
          id="flt"
          value={value}
          onChange={(e) => {
            setValue(e.target.value.toUpperCase());
            setError('');
          }}
          placeholder="AA558"
          autoFocus
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          maxLength={10}
          aria-describedby="flt-msg"
        />
        <p id="flt-msg" className="amber" role="status">
          {error}
        </p>
        <button type="submit" className="go">
          GO
        </button>
      </form>
      {recent.length > 0 && (
        <section aria-label="Recent searches" className="recent">
          <h2>RECENT</h2>
          {recent.map((q) => (
            <button key={q} type="button" onClick={() => go(q)}>
              {q}
            </button>
          ))}
        </section>
      )}
    </main>
  );
}
