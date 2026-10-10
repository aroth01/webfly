import { useCallback, useEffect, useState } from 'react';
import { fetchAuth, UNAUTHORIZED_EVENT } from './api.ts';
import { fixtureSource } from './fixtures.ts';
import { InputScreen } from './screens/InputScreen.tsx';
import { LoginScreen } from './screens/LoginScreen.tsx';
import { NdScreen } from './screens/NdScreen.tsx';
import { isFixtureMode, useRoute } from './router.ts';
import { apiSource } from './source.ts';

type Gate = 'checking' | 'locked' | 'open';

/** Asks the server whether an access code is needed; a 401 from any later call sends us back to the code screen. */
function useGate(skip: boolean): [Gate, () => void] {
  const [gate, setGate] = useState<Gate>(skip ? 'open' : 'checking');
  useEffect(() => {
    if (skip) return;
    let live = true;
    void fetchAuth().then((r) => {
      // If the check itself fails (network), let the app load: its own calls report the problem.
      if (live) setGate(r.ok && r.data.required && !r.data.authenticated ? 'locked' : 'open');
    });
    const onUnauthorized = () => setGate('locked');
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => {
      live = false;
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    };
  }, [skip]);
  return [gate, useCallback(() => setGate('open'), [])];
}

export function App() {
  const route = useRoute();
  const fixture = isFixtureMode();
  const [gate, unlock] = useGate(fixture);
  if (gate === 'checking') return null;
  if (gate === 'locked') return <LoginScreen onDone={unlock} />;
  const source = fixture ? fixtureSource : apiSource;
  return route.name === 'flight' ? <NdScreen key={route.query} query={route.query} source={source} /> : <InputScreen />;
}
