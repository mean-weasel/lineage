#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const args = process.argv.slice(2);

function readOption(name, fallback) {
  const prefix = `${name}=`;
  const inline = args.find(arg => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return fallback;
}

const packageSpec = readOption('--package', '@mean-weasel/lineage@latest');
const project = 'demo-project';
const rootAsset = 'demo-meta-short-form-upload-demo-post-static';
const childAsset = 'demo-linkedin-ledger-catalog-shared';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('Unable to allocate a free port'));
      });
    });
  });
}

async function waitForProjects(url) {
  const deadline = Date.now() + 15_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const body = await response.json();
        if (Array.isArray(body.projects) && body.projects.some(item => item.project === project)) return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function postJson(url) {
  const response = await fetch(url, { method: 'POST' });
  if (!response.ok) throw new Error(`POST ${url} failed with ${response.status}`);
  return response.json();
}

async function stopServer(server) {
  if (server.exitCode !== null || server.signalCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => server.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 5_000)),
  ]);
  if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
}

function runJson(command, commandArgs, options) {
  const output = execFileSync(command, commandArgs, { ...options, encoding: 'utf8' });
  return JSON.parse(output);
}

function runExpectFailure(command, commandArgs, options) {
  try {
    execFileSync(command, commandArgs, { ...options, encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    const stderr = error.stderr?.toString() || '';
    try {
      return JSON.parse(stderr);
    } catch {
      throw new Error(`Expected JSON failure from ${commandArgs.join(' ')}, got: ${stderr.trim() || error.message}`);
    }
  }
  throw new Error(`Expected ${commandArgs.join(' ')} to fail`);
}

function assertNoToken(value, token, label) {
  const serialized = JSON.stringify(value);
  if (serialized.includes(token)) throw new Error(`${label} exposed the raw claim token`);
  if (serialized.includes('token_hash')) throw new Error(`${label} exposed token_hash`);
}

const tmpProject = mkdtempSync(join(tmpdir(), 'lineage-release-claim-smoke-'));

try {
  execFileSync('npm', ['init', '-y'], { cwd: tmpProject, stdio: 'ignore' });
  execFileSync('npm', ['install', packageSpec], { cwd: tmpProject, stdio: 'ignore' });

  const bin = join(tmpProject, 'node_modules', '.bin', 'lineage');
  const port = await freePort();
  const dbPath = join(tmpProject, 'claim-smoke.sqlite');
  let stdout = '';
  let stderr = '';
  const server = spawn(bin, ['start', '--host', '127.0.0.1', '--port', String(port), '--db', dbPath, '--json'], {
    cwd: tmpProject,
    env: { ...process.env, LINEAGE_HOME: join(tmpProject, 'lineage-home') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', chunk => { stdout += chunk.toString(); });
  server.stderr?.on('data', chunk => { stderr += chunk.toString(); });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForProjects(`${baseUrl}/api/projects`);
    await postJson(`${baseUrl}/api/index/local?project=${project}`);

    const target = `${project}:lineage-workspace:${rootAsset}`;
    const created = runJson(bin, [
      'agent', 'claim',
      '--project', project,
      '--scope', 'lineage_workspace',
      '--target', target,
      '--target-title', 'Release claim smoke lineage',
      '--agent-name', 'Release claim smoke',
      '--ttl', '20m',
      '--db', dbPath,
      '--json',
    ], { cwd: tmpProject });
    const claimId = created.claim?.id;
    const claimSecret = created.claim_token;
    if (!claimId || !claimSecret) throw new Error('Claim creation did not return an id and creation-only token');

    const denied = runExpectFailure(bin, [
      'link-child',
      '--project', project,
      '--root', rootAsset,
      '--child', childAsset,
      '--confirm-write',
      '--db', dbPath,
      '--json',
    ], { cwd: tmpProject });
    if (denied.error !== 'claim_required') throw new Error(`Expected claim_required denial, got ${denied.error || '(missing)'}`);

    const linked = runJson(bin, [
      'link-child',
      '--project', project,
      '--root', rootAsset,
      '--child', childAsset,
      '--claim-token', claimSecret,
      '--confirm-write',
      '--db', dbPath,
      '--json',
    ], { cwd: tmpProject });
    if (linked.edge?.parent_asset_id !== rootAsset || linked.edge?.child_asset_id !== childAsset || linked.dryRun) {
      throw new Error('Claimed link-child did not write the expected edge');
    }

    const heartbeat = runJson(bin, ['agent', 'heartbeat', '--claim-token', claimSecret, '--db', dbPath, '--json'], { cwd: tmpProject });
    if (heartbeat.claim?.id !== claimId || heartbeat.claim?.status !== 'active') throw new Error('Heartbeat did not keep the claim active');

    const status = runJson(bin, ['agent', 'status', '--project', project, '--db', dbPath, '--json'], { cwd: tmpProject });
    const inspected = runJson(bin, ['agent', 'inspect', '--claim', claimId, '--project', project, '--db', dbPath, '--json'], { cwd: tmpProject });
    assertNoToken(status, claimSecret, 'agent status');
    assertNoToken(inspected, claimSecret, 'agent inspect');
    if (!inspected.events?.some(event => event.event_type === 'write_allowed')) throw new Error('Claim inspect did not include write_allowed history');

    const released = runJson(bin, ['agent', 'release', '--claim-token', claimSecret, '--db', dbPath, '--json'], { cwd: tmpProject });
    if (released.claim?.status !== 'released') throw new Error('Release did not close the claim');

    const afterRelease = runExpectFailure(bin, [
      'link-child',
      '--project', project,
      '--root', rootAsset,
      '--child', childAsset,
      '--claim-token', claimSecret,
      '--confirm-write',
      '--db', dbPath,
      '--json',
    ], { cwd: tmpProject });
    if (afterRelease.error !== 'claim_not_active') throw new Error(`Expected claim_not_active after release, got ${afterRelease.error || '(missing)'}`);
  } catch (error) {
    console.error(`lineage start stdout:\n${stdout.trim() || '(empty)'}`);
    console.error(`lineage start stderr:\n${stderr.trim() || '(empty)'}`);
    throw error;
  } finally {
    await stopServer(server);
  }

  console.log(`release claim smoke passed for ${packageSpec}`);
} finally {
  rmSync(tmpProject, { force: true, recursive: true });
}
