#!/usr/bin/env node

import { randomUUID, createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = [resolve(scriptDirectory, '../..'), resolve(scriptDirectory, '..')].find(candidate => {
  try {
    const packageInfo = JSON.parse(readFileSync(join(candidate, 'package.json'), 'utf8'));
    return packageInfo.name === '@mean-weasel/lineage';
  } catch {
    return false;
  }
});
if (!root) throw new Error('Unable to locate the Lineage package root for managed service control');
const receiptSchema = 'lineage.managed_service.v1';

function packageTreeSha256(packageRoot) {
  const hash = createHash('sha256');
  const visit = (directory, relativeDirectory = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = relativeDirectory ? join(relativeDirectory, entry.name) : entry.name;
      const path = join(directory, entry.name);
      hash.update(relativePath.replaceAll('\\', '/'));
      hash.update('\0');
      if (entry.isDirectory()) {
        hash.update('directory\0');
        visit(path, relativePath);
      } else if (entry.isSymbolicLink()) {
        hash.update('symlink\0');
        hash.update(readlinkSync(path));
      } else if (entry.isFile()) {
        hash.update('file\0');
        hash.update(readFileSync(path));
      } else {
        hash.update('other\0');
      }
      hash.update('\0');
    }
  };
  visit(packageRoot);
  return hash.digest('hex');
}

function assertServiceManagerOrigin(channel) {
  const checkoutController = resolve(scriptDirectory) === resolve(root, 'scripts');
  if (channel === 'dev') {
    if (!checkoutController) throw new Error('Dev service control is checkout-only; run node scripts/managed-service.mjs from the intended worktree');
    return;
  }
  if (checkoutController) throw new Error(`${channel} service control requires the matching attested packaged manager`);
  const receiptPath = process.env.LINEAGE_RUNTIME_RECEIPT;
  if (!receiptPath || !existsSync(receiptPath)) throw new Error(`${channel} service manager is missing its runtime install receipt`);
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  if (receipt.channel !== channel || process.env.LINEAGE_RELEASE_CHANNEL !== channel) {
    throw new Error(`${channel} service manager receipt channel does not match the requested channel`);
  }
  if (!receipt.package_root || realpathSync(receipt.package_root) !== realpathSync(root)) {
    throw new Error(`${channel} service manager receipt package root ${receipt.package_root || '(missing)'} does not match controller root ${root}`);
  }
  if (packageTreeSha256(root) !== receipt.package_tree_sha256) throw new Error(`${channel} service manager package tree does not match its install receipt`);
}

function readOption(args, name) {
  const inline = args.find(arg => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function serviceRoot() {
  if (process.env.LINEAGE_SERVICE_ROOT) return resolve(process.env.LINEAGE_SERVICE_ROOT);
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Lineage', 'services');
  if (platform() === 'win32') return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Lineage', 'services');
  return join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'lineage', 'services');
}

function defaultLauncher(channel) {
  if (channel === 'dev') return [process.execPath, '--import', 'tsx', join(root, 'src', 'cli', 'lineage-dev.ts')];
  const runtimeRoot = process.env.LINEAGE_RUNTIME_ROOT
    || (platform() === 'darwin'
      ? join(homedir(), 'Library', 'Application Support', 'Lineage', 'runtimes')
      : join(homedir(), '.local', 'share', 'lineage', 'runtimes'));
  const envName = channel === 'stable' ? 'LINEAGE_STABLE_BIN' : 'LINEAGE_PREVIEW_BIN';
  return [process.env[envName]
    || process.env.LINEAGE_CHANNEL_LAUNCHER
    || join(runtimeRoot, 'bin', channel === 'stable' ? 'lineage-stable' : 'lineage-preview')];
}

function launcherFor(channel, args) {
  const explicit = readOption(args, '--launcher');
  return explicit ? [resolve(explicit)] : defaultLauncher(channel);
}

function invoke(launcher, args, options = {}) {
  return spawnSync(launcher[0], [...launcher.slice(1), ...args], {
    cwd: root,
    encoding: 'utf8',
    ...options,
  });
}

function profileDoctor(launcher, selector) {
  const result = invoke(launcher, ['profile', 'doctor', '--profile', selector, '--json']);
  let doctor;
  try {
    doctor = JSON.parse(result.stdout || '{}');
  } catch {
    throw new Error(`Profile doctor did not return JSON: ${(result.stderr || result.stdout).trim()}`);
  }
  if (!doctor.profile) throw new Error(`Profile doctor could not resolve ${selector}: ${(result.stderr || JSON.stringify(doctor)).trim()}`);
  return { doctor, status: result.status ?? 1 };
}

function runtimeDoctor(launcher) {
  const result = invoke(launcher, ['runtime', 'doctor', '--json']);
  let runtime;
  try {
    runtime = JSON.parse(result.stdout || '{}');
  } catch {
    throw new Error(`Runtime doctor did not return JSON: ${(result.stderr || result.stdout).trim()}`);
  }
  if (result.status !== 0 || !runtime.verified) throw new Error(`Runtime doctor failed: ${(result.stderr || JSON.stringify(runtime)).trim()}`);
  return runtime;
}

function statePaths(channel, profile) {
  const digest = createHash('sha256').update(profile.manifest_path).digest('hex').slice(0, 12);
  const key = `${channel}--${profile.profile_id}--${digest}`;
  const directory = join(serviceRoot(), key);
  return {
    directory,
    lock: `${directory}.manager.lock`,
    log: join(directory, 'service.log'),
    receipt: join(directory, 'service.json'),
  };
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function processStartToken(pid) {
  if (platform() === 'win32') return undefined;
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() || undefined : undefined;
}

function processCommand(pid) {
  if (platform() === 'win32') return undefined;
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() || undefined : undefined;
}

function acquireManagerLock(path) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      mkdirSync(path, { mode: 0o700 });
      writeFileSync(join(path, 'owner.json'), `${JSON.stringify({ acquired_at: new Date().toISOString(), pid: process.pid })}\n`, { mode: 0o600 });
      return () => rmSync(path, { force: true, recursive: true });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const owner = JSON.parse(readFileSync(join(path, 'owner.json'), 'utf8'));
        if (Number.isSafeInteger(owner.pid) && processAlive(owner.pid)) {
          throw new Error(`Another service manager operation is active (pid ${owner.pid})`, { cause: error });
        }
      } catch (ownerError) {
        if (ownerError instanceof Error && ownerError.message.startsWith('Another service manager')) throw ownerError;
      }
      rmSync(path, { force: true, recursive: true });
    }
  }
  throw new Error(`Could not acquire service manager lock ${path}`);
}

function readReceipt(path) {
  if (!existsSync(path)) return undefined;
  const receipt = JSON.parse(readFileSync(path, 'utf8'));
  if (
    receipt.schema_version !== receiptSchema
    || !Number.isSafeInteger(receipt.pid)
    || typeof receipt.instance_id !== 'string'
    || typeof receipt.profile_fingerprint !== 'string'
    || !Array.isArray(receipt.launcher)
  ) throw new Error(`Managed service receipt is invalid: ${path}`);
  return receipt;
}

function writeReceipt(path, receipt) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  renameSync(temporary, path);
}

export function managedServiceIdentityErrors(runtime, receipt) {
  const errors = [];
  if (runtime.channel !== receipt.channel) errors.push(`channel ${runtime.channel} != ${receipt.channel}`);
  if (!runtime.code?.verified) errors.push('code identity is not verified');
  if (runtime.code?.fingerprint !== receipt.code_fingerprint) errors.push(`code fingerprint ${runtime.code?.fingerprint || 'missing'} != ${receipt.code_fingerprint}`);
  if (runtime.profile?.id !== receipt.profile_id) errors.push(`profile ${runtime.profile?.id || 'missing'} != ${receipt.profile_id}`);
  if (runtime.profile?.environment !== receipt.environment) errors.push(`environment ${runtime.profile?.environment || 'missing'} != ${receipt.environment}`);
  if (runtime.profile?.fingerprint !== receipt.profile_fingerprint) errors.push(`profile fingerprint ${runtime.profile?.fingerprint || 'missing'} != ${receipt.profile_fingerprint}`);
  if (runtime.schema?.profile_id !== receipt.profile_id) errors.push(`database profile ${runtime.schema?.profile_id || 'missing'} != ${receipt.profile_id}`);
  if (runtime.schema?.profile_fingerprint !== receipt.profile_fingerprint) errors.push(`database fingerprint ${runtime.schema?.profile_fingerprint || 'missing'} != ${receipt.profile_fingerprint}`);
  if (resolve(runtime.database?.path || '') !== resolve(receipt.database_path)) errors.push(`database ${runtime.database?.path || 'missing'} != ${receipt.database_path}`);
  if (runtime.service?.instance_id !== receipt.instance_id) errors.push(`instance ${runtime.service?.instance_id || 'missing'} != ${receipt.instance_id}`);
  if (runtime.service?.launcher_pid !== receipt.pid) errors.push(`launcher pid ${runtime.service?.launcher_pid || 'missing'} != ${receipt.pid}`);
  return errors;
}

function desiredReceiptErrors(channel, doctor, receipt) {
  const errors = [];
  if (receipt.channel !== channel) errors.push(`receipt channel ${receipt.channel} != ${channel}`);
  if (receipt.code_fingerprint !== doctor.runtime?.code_fingerprint) errors.push(`receipt code fingerprint ${receipt.code_fingerprint} != current ${doctor.runtime?.code_fingerprint || 'missing'}`);
  if (receipt.code_origin !== doctor.runtime?.code_origin) errors.push(`receipt code origin ${receipt.code_origin} != current ${doctor.runtime?.code_origin || 'missing'}`);
  if (receipt.profile_id !== doctor.profile.profile_id) errors.push(`receipt profile ${receipt.profile_id} != ${doctor.profile.profile_id}`);
  if (receipt.environment !== doctor.profile.environment) errors.push(`receipt environment ${receipt.environment} != ${doctor.profile.environment}`);
  if (receipt.profile_fingerprint !== doctor.profile.profile_fingerprint) errors.push(`receipt profile fingerprint ${receipt.profile_fingerprint} != current ${doctor.profile.profile_fingerprint}`);
  if (resolve(receipt.database_path) !== resolve(doctor.profile.database_path)) errors.push('receipt database path does not match current profile');
  if (receipt.service_origin !== doctor.profile.service_origin) errors.push('receipt service origin does not match current profile');
  if (receipt.manifest_path !== doctor.profile.manifest_path) errors.push('receipt manifest path does not match current profile');
  return errors;
}

async function fetchRuntime(origin) {
  const response = await fetch(`${origin}/api/runtime`, { signal: AbortSignal.timeout(1_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  if (!body?.runtime) throw new Error('Runtime response is missing runtime identity');
  return body.runtime;
}

async function inspectHealth(receipt) {
  const errors = [];
  if (!processAlive(receipt.pid)) errors.push(`launcher pid ${receipt.pid} is not alive`);
  if (receipt.process_start && processStartToken(receipt.pid) !== receipt.process_start) errors.push(`launcher pid ${receipt.pid} was reused`);
  let runtime;
  try {
    runtime = await fetchRuntime(receipt.service_origin);
    errors.push(...managedServiceIdentityErrors(runtime, receipt));
  } catch (error) {
    errors.push(`runtime health failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { errors, healthy: errors.length === 0, runtime };
}

async function waitForHealthy(receipt, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let health = { errors: ['service did not respond'], healthy: false };
  while (Date.now() < deadline && processAlive(receipt.pid)) {
    health = await inspectHealth(receipt);
    if (health.healthy) return health;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Service failed readiness: ${health.errors.join('; ')}`);
}

function openBrowser(origin) {
  const command = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform() === 'win32' ? ['/c', 'start', '', origin] : [origin];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

function terminate(receipt, force = false) {
  if (!processAlive(receipt.pid)) return;
  const currentStart = processStartToken(receipt.pid);
  const command = processCommand(receipt.pid);
  const processMatches = receipt.process_start
    ? currentStart === receipt.process_start
    : Boolean(command?.includes('start') && command.includes(receipt.manifest_path));
  if (!processMatches && !force) {
    throw new Error(`Refusing to signal pid ${receipt.pid}: process identity no longer matches the service receipt; inspect manually or pass --force`);
  }
  const signalTarget = platform() === 'win32' ? receipt.pid : -receipt.pid;
  try { process.kill(signalTarget, 'SIGTERM'); } catch (error) { if (error?.code !== 'ESRCH') throw error; }
}

async function startManaged(channel, selector, launcher, args) {
  const { doctor, status } = profileDoctor(launcher, selector);
  const runtimeIdentity = runtimeDoctor(launcher);
  if (status !== 0 || !doctor.ok || !doctor.runtime?.code_verified) {
    const failures = (doctor.checks || []).filter(check => check.status === 'fail').map(check => `${check.id}: ${check.message}`);
    throw new Error(`Profile doctor must pass before service start: ${failures.join('; ') || 'unverified runtime'}`);
  }
  if (runtimeIdentity.fingerprint !== doctor.runtime.code_fingerprint || runtimeIdentity.channel !== channel) {
    throw new Error('Runtime doctor identity changed while resolving the service profile');
  }
  const paths = statePaths(channel, doctor.profile);
  const release = acquireManagerLock(paths.lock);
  try {
    const existing = readReceipt(paths.receipt);
    if (existing) {
      const health = await inspectHealth(existing);
      const desiredErrors = desiredReceiptErrors(channel, doctor, existing);
      if (health.healthy && desiredErrors.length === 0) throw new Error(`Managed service is already healthy at ${existing.service_origin}`);
      if (processAlive(existing.pid)) throw new Error(`Managed service pid ${existing.pid} exists but is stale or unhealthy: ${[...desiredErrors, ...health.errors].join('; ')}`);
      rmSync(paths.receipt, { force: true });
    }
    mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
    const logFd = openSync(paths.log, 'a', 0o600);
    const instanceId = randomUUID();
    const startArgs = ['start', '--profile', doctor.profile.manifest_path, '--json'];
    const child = spawn(launcher[0], [...launcher.slice(1), ...startArgs], {
      cwd: root,
      detached: true,
      env: { ...process.env, LINEAGE_SERVICE_INSTANCE_ID: instanceId },
      stdio: ['ignore', logFd, logFd],
    });
    closeSync(logFd);
    child.unref();
    const receipt = {
      channel,
      code_fingerprint: doctor.runtime.code_fingerprint,
      code_origin: doctor.runtime.code_origin,
      code_root: runtimeIdentity.root,
      database_path: doctor.profile.database_path,
      environment: doctor.profile.environment,
      instance_id: instanceId,
      launcher,
      log_path: paths.log,
      manifest_path: doctor.profile.manifest_path,
      pid: child.pid,
      process_start: processStartToken(child.pid),
      profile_fingerprint: doctor.profile.profile_fingerprint,
      profile_id: doctor.profile.profile_id,
      schema_version: receiptSchema,
      service_origin: doctor.profile.service_origin,
      started_at: new Date().toISOString(),
    };
    writeReceipt(paths.receipt, receipt);
    try {
      const health = await waitForHealthy(receipt, Number(readOption(args, '--timeout-ms') || 20_000));
      if (args.includes('--open')) openBrowser(receipt.service_origin);
      return { healthy: true, receipt, runtime: health.runtime, state_path: paths.receipt };
    } catch (error) {
      terminate(receipt, true);
      throw error;
    }
  } finally {
    release();
  }
}

async function statusManaged(channel, selector, launcher) {
  const { doctor, status } = profileDoctor(launcher, selector);
  const paths = statePaths(channel, doctor.profile);
  const receipt = readReceipt(paths.receipt);
  if (!receipt) throw new Error(`No managed service receipt exists for ${channel}/${doctor.profile.profile_id}`);
  const health = await inspectHealth(receipt);
  const doctorFailures = status === 0 && doctor.ok
    ? []
    : (doctor.checks || []).filter(check => check.status === 'fail').map(check => `current doctor ${check.id}: ${check.message}`);
  const errors = [...doctorFailures, ...desiredReceiptErrors(channel, doctor, receipt), ...health.errors];
  if (errors.length > 0) throw new Error(`Managed service is not healthy: ${errors.join('; ')}`);
  return { healthy: true, receipt, runtime: health.runtime, state_path: paths.receipt };
}

async function stopManaged(channel, selector, launcher, force) {
  const { doctor } = profileDoctor(launcher, selector);
  const paths = statePaths(channel, doctor.profile);
  const release = acquireManagerLock(paths.lock);
  try {
    const receipt = readReceipt(paths.receipt);
    if (!receipt) return { already_stopped: true, profile_id: doctor.profile.profile_id };
    if (receipt.manifest_path !== doctor.profile.manifest_path || receipt.profile_id !== doctor.profile.profile_id) {
      throw new Error('Service receipt identity does not match the requested profile');
    }
    terminate(receipt, force);
    const deadline = Date.now() + 5_000;
    while (processAlive(receipt.pid) && Date.now() < deadline) await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
    if (processAlive(receipt.pid) && force) {
      const signalTarget = platform() === 'win32' ? receipt.pid : -receipt.pid;
      try { process.kill(signalTarget, 'SIGKILL'); } catch { /* already exited */ }
    }
    if (processAlive(receipt.pid)) throw new Error(`Service pid ${receipt.pid} did not stop`);
    rmSync(paths.receipt, { force: true });
    return { profile_id: receipt.profile_id, stopped: true };
  } finally {
    release();
  }
}

function logsManaged(channel, selector, launcher, lines) {
  const { doctor } = profileDoctor(launcher, selector);
  const paths = statePaths(channel, doctor.profile);
  const receipt = readReceipt(paths.receipt);
  const logPath = receipt?.log_path || paths.log;
  if (!existsSync(logPath)) throw new Error(`No managed service log exists: ${logPath}`);
  return readFileSync(logPath, 'utf8').split('\n').slice(-lines).join('\n');
}

function usage() {
  return `Usage:
  lineage-service start --channel stable|preview|dev --profile <id-or-manifest> [--open] [--json]
  lineage-service status --channel stable|preview|dev --profile <id-or-manifest> [--json]
  lineage-service stop --channel stable|preview|dev --profile <id-or-manifest> [--force] [--json]
  lineage-service logs --channel stable|preview|dev --profile <id-or-manifest> [--lines 100]

Start writes a profile-scoped receipt, waits for /api/runtime to match the exact
code/profile/database/service instance, and only then opens a browser. Status is
nonzero for a stale PID, failed health request, or any identity mismatch.`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(usage());
    return;
  }
  const command = args[0];
  const channel = readOption(args, '--channel');
  const selector = readOption(args, '--profile');
  if (!['stable', 'preview', 'dev'].includes(channel)) throw new Error('--channel must be stable, preview, or dev');
  if (!selector) throw new Error('--profile is required; managed services never use legacy-unbound data');
  assertServiceManagerOrigin(channel);
  const launcher = launcherFor(channel, args);
  let result;
  if (command === 'start') result = await startManaged(channel, selector, launcher, args);
  else if (command === 'status') result = await statusManaged(channel, selector, launcher);
  else if (command === 'stop') result = await stopManaged(channel, selector, launcher, args.includes('--force'));
  else if (command === 'logs') {
    const output = logsManaged(channel, selector, launcher, Number(readOption(args, '--lines') || 100));
    console.log(output);
    return;
  } else throw new Error(`Unknown managed-service command: ${command}`);
  if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else if (command === 'status' || command === 'start') console.log(`Lineage ${channel}/${result.receipt.profile_id} healthy at ${result.receipt.service_origin}`);
  else console.log(`Lineage ${channel}/${result.profile_id} stopped`);
}

const invokedAs = process.argv[1] ? basename(process.argv[1]) : '';
if (process.argv[1] && (
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  || ['lineage-service', 'lineage-stable-service', 'lineage-preview-service', 'managed-service.js', 'managed-service.mjs'].includes(invokedAs)
)) {
  main().catch(error => {
    console.error(`managed-service: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
