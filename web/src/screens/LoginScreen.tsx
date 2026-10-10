import { useState, type FormEvent } from 'react';
import { login } from '../api.ts';

export function LoginScreen({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await login(code);
    setBusy(false);
    if (r.ok && r.data.authenticated) onDone();
    else setError(r.ok ? 'Wrong access code.' : r.message);
  };

  return (
    <main className="input-screen">
      <form onSubmit={submit}>
        <label htmlFor="code" className="cyan">
          ACCESS CODE
        </label>
        <input
          id="code"
          type="password"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError('');
          }}
          autoFocus
          autoComplete="current-password"
          aria-describedby="code-msg"
        />
        <p id="code-msg" className="amber" role="status">
          {error}
        </p>
        <button type="submit" className="go" disabled={busy || code.trim() === ''}>
          ENTER
        </button>
      </form>
    </main>
  );
}
