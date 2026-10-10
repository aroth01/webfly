import '@fontsource/b612/400.css';
import '@fontsource/b612/700.css';
import '@fontsource/b612-mono/400.css';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './style.css';

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
