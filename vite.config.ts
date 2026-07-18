import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const e2ePort = process.env.LINEAGE_E2E_PORT ? Number(process.env.LINEAGE_E2E_PORT) : undefined;
const packageInfo = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8')) as { version?: string };
const rawReleaseChannel = process.env.LINEAGE_RELEASE_CHANNEL || process.env.LINEAGE_CHANNEL;
const releaseChannel = rawReleaseChannel === 'preview' || rawReleaseChannel === 'next'
  ? 'preview'
  : rawReleaseChannel === 'stable' || rawReleaseChannel === 'production'
    ? 'stable'
    : 'dev';

export default defineConfig({
  root: new URL('src/web', import.meta.url).pathname,
  plugins: [react()],
  define: {
    __LINEAGE_RELEASE_CHANNEL__: JSON.stringify(releaseChannel),
    __LINEAGE_VERSION__: JSON.stringify(packageInfo.version || '0.0.0'),
  },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: resolve(new URL('src/web/index.html', import.meta.url).pathname),
        landing: resolve(new URL('src/web/landing/index.html', import.meta.url).pathname),
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    ...(e2ePort ? { ws: { port: e2ePort + 1000 } } : {}),
  },
});
