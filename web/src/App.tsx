import { fixtureSource } from './fixtures.ts';
import { InputScreen } from './screens/InputScreen.tsx';
import { NdScreen } from './screens/NdScreen.tsx';
import { isFixtureMode, useRoute } from './router.ts';
import { apiSource } from './source.ts';

export function App() {
  const route = useRoute();
  const source = isFixtureMode() ? fixtureSource : apiSource;
  return route.name === 'flight' ? <NdScreen key={route.query} query={route.query} source={source} /> : <InputScreen />;
}
