#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), 'lineage-managed-service-smoke-'));
const manifestPath = join(temporary, 'profile', 'profile.json');
const databasePath = join(temporary, 'profile', 'lineage.sqlite');
const manager = join(root, 'scripts', 'managed-service.mjs');
const cli = [process.execPath, '--import', 'tsx', join(root, 'src', 'cli', 'lineage-dev.ts')];
const environment = { ...process.env, LINEAGE_PROFILE_ROOT: temporary, LINEAGE_SERVICE_ROOT: join(temporary, 'services') };
let started = false;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => address && typeof address === 'object' ? resolvePort(address.port) : reject(new Error('No free port')));
    });
  });
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: root, encoding: 'utf8', env: environment, ...options });
}

function runCli(args) {
  return run(cli[0], [...cli.slice(1), ...args]);
}

function runManager(args) {
  return run(process.execPath, [manager, ...args]);
}

try {
  for (const required of [join(root, 'dist', 'server.js'), manager]) {
    if (!existsSync(required)) throw new Error(`Missing ${required}; run npm run build first`);
  }
  const port = await freePort();
  const runtimeResult = runCli(['runtime', 'doctor', '--json']);
  assert(runtimeResult.status === 0, `Runtime doctor failed: ${runtimeResult.stderr}`);
  const runtime = JSON.parse(runtimeResult.stdout);
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify({
    asset_root: root,
    database_path: databasePath,
    environment: 'development',
    expected_runtime: { channel: 'dev', code_fingerprint: runtime.fingerprint, code_origin: runtime.origin },
    profile_id: 'managed-service-smoke',
    schema_version: 'lineage.profile.v1',
    service_origin: `http://127.0.0.1:${port}`,
  }, null, 2)}\n`);
  new DatabaseSync(databasePath).close();
  const bind = runCli(['profile', 'bind', '--profile', manifestPath, '--confirm-write', '--json']);
  assert(bind.status === 0, `Profile bind failed: ${bind.stderr}`);

  const start = runManager(['start', '--channel', 'dev', '--profile', manifestPath, '--json']);
  assert(start.status === 0, `Managed start failed: ${start.stderr}`);
  started = true;
  const startedResult = JSON.parse(start.stdout);
  assert(startedResult.healthy && startedResult.runtime.service.instance_id === startedResult.receipt.instance_id, 'Managed start did not prove service instance identity');

  const status = runManager(['status', '--channel', 'dev', '--profile', manifestPath, '--json']);
  assert(status.status === 0 && JSON.parse(status.stdout).healthy, `Managed status failed: ${status.stderr}`);

  const receiptPath = startedResult.state_path;
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  writeFileSync(receiptPath, `${JSON.stringify({ ...receipt, code_fingerprint: '0'.repeat(64) }, null, 2)}\n`);
  const mismatch = runManager(['status', '--channel', 'dev', '--profile', manifestPath, '--json']);
  assert(mismatch.status !== 0 && mismatch.stderr.includes('code fingerprint'), 'Managed status accepted a mismatched receipt');
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

  process.kill(-receipt.pid, 'SIGTERM');
  await new Promise(resolveDelay => setTimeout(resolveDelay, 750));
  const unhealthy = runManager(['status', '--channel', 'dev', '--profile', manifestPath, '--json']);
  assert(unhealthy.status !== 0 && /not alive|runtime health failed/.test(unhealthy.stderr), 'Managed status accepted a registered but stopped service');

  const stop = runManager(['stop', '--channel', 'dev', '--profile', manifestPath, '--json', '--force']);
  assert(stop.status === 0 && JSON.parse(stop.stdout).stopped, `Managed stop failed: ${stop.stderr}`);
  started = false;
  console.log('managed service smoke passed');
} finally {
  if (started) runManager(['stop', '--channel', 'dev', '--profile', manifestPath, '--force']);
  rmSync(temporary, { force: true, recursive: true });
}
