import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8787' } },
  build: { outDir: fileURLToPath(new URL('../dist/web', import.meta.url)), emptyOutDir: true },
});
