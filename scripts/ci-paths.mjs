#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const landingOnlyFiles = new Set([
  'LAUNCH_ASSET_PLAN.md',
  'LAUNCH_MESSAGING.md',
  'LAUNCH_RECORDING_RUNBOOK.md',
]);

const sharedFiles = new Set([
  '.github/workflows/ci.yml',
  'eslint.config.js',
  'knip.json',
  'package-lock.json',
  'package.json',
  'scripts/ci-paths.mjs',
  'scripts/ci-paths.test.mjs',
  'scripts/package-smoke.mjs',
  'scripts/public-readiness.mjs',
  'vite.config.ts',
  'vitest.config.ts',
]);

function isLandingOnly(file) {
  return file.startsWith('src/web/landing/') || landingOnlyFiles.has(file);
}

function isShared(file) {
  return sharedFiles.has(file)
    || /^tsconfig(?:\.[^/]+)?\.json$/.test(file)
    || /^vite\.config\.[^/]+$/.test(file)
    || /^vitest\.config\.[^/]+$/.test(file)
    || /^eslint\.config\.[^/]+$/.test(file);
}

export function classifyChangedFiles(files) {
  if (files.includes('__all__')) return { app: true, landing: true };

  let app = false;
  let landing = false;

  for (const file of files) {
    if (isShared(file)) {
      app = true;
      landing = true;
    } else if (isLandingOnly(file)) {
      landing = true;
    } else {
      app = true;
    }
  }

  return { app, landing };
}

function run() {
  const files = JSON.parse(process.env.CHANGED_FILES_JSON || '[]');
  if (!Array.isArray(files) || files.some(file => typeof file !== 'string')) {
    throw new Error('CHANGED_FILES_JSON must be a JSON array of repository paths');
  }

  const routes = classifyChangedFiles(files);
  process.stdout.write(`landing=${routes.landing}\napp=${routes.app}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
