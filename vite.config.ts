import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import config from './config/default.json' with { type: 'json' };

export default defineConfig({
  plugins: [react()],
  root: fileURLToPath(new URL('./web', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('./dist/web', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': `http://${config.server.host}:${config.server.port}`,
    },
  },
});
