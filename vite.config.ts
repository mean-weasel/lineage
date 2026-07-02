import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const e2ePort = process.env.LINEAGE_E2E_PORT ? Number(process.env.LINEAGE_E2E_PORT) : undefined;

export default defineConfig({
  root: new URL('src/web', import.meta.url).pathname,
  plugins: [react()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    ...(e2ePort ? { ws: { port: e2ePort + 1000 } } : {}),
  },
});
