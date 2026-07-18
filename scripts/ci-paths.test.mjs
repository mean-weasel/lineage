import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyChangedFiles } from './ci-paths.mjs';

test('routes landing-only changes to landing CI', () => {
  assert.deepEqual(
    classifyChangedFiles(['src/web/landing/LandingPage.tsx', 'LAUNCH_MESSAGING.md']),
    { app: false, landing: true },
  );
});

test('routes application-only changes to application CI', () => {
  assert.deepEqual(
    classifyChangedFiles(['src/server.ts', 'README.md']),
    { app: true, landing: false },
  );
});

test('routes shared build configuration to both suites', () => {
  assert.deepEqual(
    classifyChangedFiles(['vite.config.ts']),
    { app: true, landing: true },
  );
});

test('routes mixed application and landing changes to both suites', () => {
  assert.deepEqual(
    classifyChangedFiles(['src/server.ts', 'src/web/landing/landing.css']),
    { app: true, landing: true },
  );
});

test('routes non-pull-request events to both suites', () => {
  assert.deepEqual(
    classifyChangedFiles(['__all__']),
    { app: true, landing: true },
  );
});

test('does not invent work for an empty change list', () => {
  assert.deepEqual(classifyChangedFiles([]), { app: false, landing: false });
});
