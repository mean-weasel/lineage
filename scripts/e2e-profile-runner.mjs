#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), 'lineage-e2e-profile-'));
const profileRoot = join(temporary, 'e2e-development');
const manifestPath = join(profileRoot, 'profile.json');
const databasePath = join(profileRoot, 'lineage.sqlite');
const assetRoot = root;
const port = Number(process.env.LINEAGE_E2E_PORT || 5197);
const cli = [process.execPath, '--import', 'tsx', join(root, 'src', 'cli', 'lineage-dev.ts')];

function run(args, options = {}) {
  return spawnSync(cli[0], [...cli.slice(1), ...args], {
    cwd: root,
    encoding: 'utf8',
    ...options,
  });
}

try {
  const runtimeResult = run(['runtime', 'doctor', '--json']);
  if (runtimeResult.status !== 0) throw new Error(`Dev runtime doctor failed: ${runtimeResult.stderr.trim()}`);
  const runtime = JSON.parse(runtimeResult.stdout);
  mkdirSync(profileRoot, { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify({
    asset_root: assetRoot,
    database_path: databasePath,
    environment: 'development',
    expected_runtime: {
      channel: 'dev',
      code_fingerprint: runtime.fingerprint,
      code_origin: runtime.origin,
    },
    profile_id: 'e2e-development',
    schema_version: 'lineage.profile.v1',
    service_origin: `http://127.0.0.1:${port}`,
  }, null, 2)}\n`);
  new DatabaseSync(databasePath).close();
  const bindResult = run(['profile', 'bind', '--profile', manifestPath, '--confirm-write', '--json']);
  if (bindResult.status !== 0) throw new Error(`E2E profile bind failed: ${bindResult.stderr.trim()}`);
  const binding = JSON.parse(bindResult.stdout);
  const playwright = join(root, 'node_modules', '.bin', 'playwright');
  const result = spawnSync(playwright, ['test', '--config', 'playwright.config.ts', ...process.argv.slice(2)], {
    cwd: root,
    env: {
      ...process.env,
      LINEAGE_ASSET_ROOT: assetRoot,
      LINEAGE_DB: databasePath,
      LINEAGE_E2E_DB: databasePath,
      LINEAGE_PROFILE: manifestPath,
      LINEAGE_PROFILE_ENVIRONMENT: 'development',
      LINEAGE_PROFILE_FINGERPRINT: binding.identity.profile_fingerprint,
      LINEAGE_PROFILE_ID: 'e2e-development',
      LINEAGE_PROFILE_MANIFEST: manifestPath,
      LINEAGE_PROFILE_ROOT: temporary,
      LINEAGE_PROFILE_SERVICE_ORIGIN: `http://127.0.0.1:${port}`,
    },
    stdio: 'inherit',
  });
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(`e2e-profile-runner: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  rmSync(temporary, { force: true, recursive: true });
}
