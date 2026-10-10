import { useRouter } from './router.ts';
import { FlightScreen } from './screens/FlightScreen.tsx';
import { InputScreen } from './screens/InputScreen.tsx';

export function App() {
  const { route, navigate } = useRouter();
  return route.name === 'flight' ? <FlightScreen key={route.query} query={route.query} navigate={navigate} /> : <InputScreen navigate={navigate} />;
}
