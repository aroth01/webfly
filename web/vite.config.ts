import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:8080' },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
