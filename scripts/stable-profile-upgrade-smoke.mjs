#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), 'lineage-stable-profile-upgrade-'));
const channelCli = join(root, 'dist', 'cli', 'lineage-channel.js');
const runtimeRoot = join(temporary, 'runtimes');
const shimRoot = join(temporary, 'channel-shims');
const savedShimRoot = join(temporary, 'saved-a-shims');
const profileRoot = join(temporary, 'profiles');
const serviceRoot = join(temporary, 'services');
const homeRoot = join(temporary, 'home');
const npmPrefix = join(temporary, 'npm-prefix');
const npmCache = join(temporary, 'npm-cache');
const profileId = 'stable-upgrade-oracle';
const migrationKey = 'stable_upgrade_oracle_v1';
const databaseSentinel = 'database-content-survived-a-to-b';
const assetSentinel = 'asset-content-survived-a-to-b';
const trackedStateBefore = execFileSync('git', ['status', '--porcelain=v1'], { cwd: root, encoding: 'utf8' });
const controlledEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => (
  !key.startsWith('LINEAGE_')
  && key !== 'HOST'
  && key !== 'PORT'
  && key !== 'XDG_DATA_HOME'
  && key !== 'XDG_STATE_HOME'
)));
Object.assign(controlledEnv, {
  HOME: homeRoot,
  LINEAGE_HOME: join(temporary, 'lineage-home'),
  LINEAGE_PROFILE_ROOT: profileRoot,
  LINEAGE_RUNTIME_ROOT: runtimeRoot,
  LINEAGE_SERVICE_ROOT: serviceRoot,
  npm_config_cache: npmCache,
  npm_config_prefix: npmPrefix,
  XDG_DATA_HOME: join(temporary, 'xdg-data'),
  XDG_STATE_HOME: join(temporary, 'xdg-state'),
});

const recordedPids = new Set();
let manifestPath;
let aInstall;
let bInstall;
let aLauncher;
let aManager;
let bLauncher;
let bManager;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: controlledEnv,
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
}

function attempt(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: controlledEnv,
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
}

function output(result) {
  return `${result.stderr || ''}\n${result.stdout || ''}`.trim();
}

function parseJsonResult(result, label) {
  assert(result.status === 0, `${label} failed: ${output(result)}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label} did not return JSON: ${output(result)}`, { cause: error });
  }
}

function invokeJson(launcher, args, label) {
  return parseJsonResult(attempt(launcher, args), label);
}

function parsePack(outputText) {
  const parsed = JSON.parse(outputText);
  const item = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!item?.filename) throw new Error('npm pack did not return a tarball filename');
  return item.filename;
}

function syntheticPackage(label, version) {
  const fixture = join(temporary, `package-${label}`);
  const packed = join(temporary, `packed-${label}`);
  mkdirSync(fixture, { recursive: true });
  mkdirSync(packed, { recursive: true });
  cpSync(join(root, 'dist'), join(fixture, 'dist'), { recursive: true });
  cpSync(join(root, 'fixtures'), join(fixture, 'fixtures'), { recursive: true });
  for (const file of ['README.md', 'CHANGELOG.md', 'LICENSE', 'package.json']) {
    cpSync(join(root, file), join(fixture, file));
  }

  const packageInfo = JSON.parse(readFileSync(join(fixture, 'package.json'), 'utf8'));
  packageInfo.version = version;
  writeFileSync(join(fixture, 'package.json'), `${JSON.stringify(packageInfo, null, 2)}\n`);
  const build = {
    package_name: packageInfo.name,
    package_version: version,
    schema_version: 'lineage.runtime_build.v1',
    source_dirty: false,
    source_fingerprint: sha256(`clean synthetic stable upgrade package ${label}/${version}`),
    source_git_sha: run('git', ['rev-parse', 'HEAD']).trim(),
  };
  writeFileSync(join(fixture, 'dist', 'runtime-build.json'), `${JSON.stringify({
    build_fingerprint: sha256(JSON.stringify(build)),
    ...build,
  }, null, 2)}\n`);

  return join(packed, parsePack(run('npm', [
    'pack',
    '--json',
    '--pack-destination',
    packed,
  ], { cwd: fixture })));
}

function installStable(tarball) {
  return JSON.parse(run(process.execPath, [
    channelCli,
    'install',
    'stable',
    '--root',
    runtimeRoot,
    '--shim-dir',
    shimRoot,
    '--package',
    tarball,
    '--allow-local-package',
    '--json',
  ]));
}

function saveLauncher(source, name) {
  mkdirSync(savedShimRoot, { recursive: true });
  const target = join(savedShimRoot, name);
  copyFileSync(source, target);
  chmodSync(target, 0o755);
  return target;
}

function managerAttempt(manager, command, launcher, extra = []) {
  return attempt(manager, [
    command,
    '--channel',
    'stable',
    '--profile',
    manifestPath,
    '--launcher',
    launcher,
    ...extra,
    '--json',
  ]);
}

function managerJson(manager, command, launcher, extra = []) {
  const result = managerAttempt(manager, command, launcher, extra);
  const parsed = parseJsonResult(result, `managed ${command}`);
  if (parsed.receipt?.pid) recordedPids.add(parsed.receipt.pid);
  return parsed;
}

function readRoutingSnapshot(path) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  return {
    asset_root: manifest.asset_root,
    database_path: manifest.database_path,
    environment: manifest.environment,
    profile_id: manifest.profile_id,
    required_schema_migrations: manifest.required_schema_migrations || [],
    schema_version: manifest.schema_version,
    service_origin: manifest.service_origin,
  };
}

function seedSentinels(init) {
  const manifest = JSON.parse(readFileSync(init.manifest_path, 'utf8'));
  manifest.required_schema_migrations = [migrationKey];
  writeFileSync(init.manifest_path, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

  const database = new DatabaseSync(init.database_path);
  try {
    database.exec(`
      create table if not exists lineage_schema_migrations (
        key text primary key,
        applied_at text not null
      );
      create table stable_upgrade_oracle_sentinel (
        key text primary key,
        value text not null
      );
    `);
    database.prepare('insert into lineage_schema_migrations (key, applied_at) values (?, ?)').run(migrationKey, new Date().toISOString());
    database.prepare('insert into stable_upgrade_oracle_sentinel (key, value) values (?, ?)').run('sentinel', databaseSentinel);
  } finally {
    database.close();
  }
  writeFileSync(join(init.asset_root, 'stable-upgrade-sentinel.txt'), `${assetSentinel}\n`, { mode: 0o600 });
}

function readDatabaseEvidence(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const sentinel = database.prepare('select value from stable_upgrade_oracle_sentinel where key = ?').get('sentinel');
    const migrations = database.prepare('select key from lineage_schema_migrations order by key').all().map(row => row.key);
    const identity = database.prepare(`
      select profile_id, environment, profile_fingerprint
      from lineage_profile_identity
    `).get();
    return { identity, migrations, sentinel: sentinel?.value };
  } finally {
    database.close();
  }
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : undefined;
  await new Promise(resolveClose => server.close(resolveClose));
  assert(port, 'Could not reserve a local service port');
  return port;
}

function terminateRecordedProcesses() {
  const receipts = [];
  const visit = path => {
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.name === 'service.json') receipts.push(child);
    }
  };
  visit(serviceRoot);
  for (const receiptPath of receipts) {
    try {
      const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
      if (Number.isInteger(receipt.pid) && receipt.pid > 0) recordedPids.add(receipt.pid);
    } catch {
      // A malformed temporary receipt is still removed with the isolated root.
    }
  }
  for (const pid of recordedPids) {
    const target = process.platform === 'win32' ? pid : -pid;
    try { process.kill(target, 'SIGTERM'); } catch { /* already stopped */ }
    try { process.kill(target, 'SIGKILL'); } catch { /* already stopped */ }
  }
}

try {
  for (const required of [
    channelCli,
    join(root, 'dist', 'cli', 'lineage.js'),
    join(root, 'dist', 'cli', 'managed-service.js'),
    join(root, 'dist', 'runtime-build.json'),
    join(root, 'dist', 'server.js'),
  ]) {
    if (!existsSync(required)) throw new Error(`Missing build artifact ${required}; run npm run build first`);
  }

  const packageA = syntheticPackage('a', '1.0.0');
  const packageB = syntheticPackage('b', '1.1.0');
  assert(sha256(readFileSync(packageA)) !== sha256(readFileSync(packageB)), 'Synthetic A and B tarballs have the same integrity');

  aInstall = installStable(packageA);
  aLauncher = saveLauncher(aInstall.shim, 'lineage-stable-a');
  aManager = saveLauncher(aInstall.service_shim, 'lineage-stable-service-a');
  const runtimeA = invokeJson(aLauncher, ['runtime', 'doctor', '--json'], 'A runtime doctor');
  assert(runtimeA.verified && runtimeA.channel === 'stable' && runtimeA.origin === 'package', 'Package A is not verified stable package code');
  assert(runtimeA.package_version === '1.0.0', `Package A reported ${runtimeA.package_version}`);

  const port = await reservePort();
  const initialized = invokeJson(aLauncher, [
    'profile',
    'init',
    '--profile',
    profileId,
    '--service-origin',
    `http://127.0.0.1:${port}`,
    '--confirm-write',
    '--json',
  ], 'A profile init');
  manifestPath = initialized.manifest_path;
  seedSentinels(initialized);

  const doctorA = invokeJson(aLauncher, ['profile', 'doctor', '--profile', manifestPath, '--json'], 'A profile doctor');
  assert(doctorA.ok, 'Package A profile doctor did not pass after sentinel setup');
  const routingBefore = readRoutingSnapshot(manifestPath);
  const databaseBeforeStart = readDatabaseEvidence(initialized.database_path);
  assert(databaseBeforeStart.sentinel === databaseSentinel, 'Database sentinel was not written under A');
  assert(readFileSync(join(initialized.asset_root, 'stable-upgrade-sentinel.txt'), 'utf8').trim() === assetSentinel, 'Asset sentinel was not written under A');

  const startedA = managerJson(aManager, 'start', aLauncher, ['--timeout-ms', '30000']);
  const statusA = managerJson(aManager, 'status', aLauncher);
  assert(startedA.healthy && statusA.healthy, 'Package A did not reach managed readiness');
  assert(statusA.runtime.code.fingerprint === runtimeA.fingerprint, 'Managed A code fingerprint differs from runtime doctor');
  assert(statusA.runtime.profile.fingerprint === doctorA.profile.profile_fingerprint, 'Managed A profile fingerprint differs from profile doctor');

  bInstall = installStable(packageB);
  bLauncher = bInstall.shim;
  bManager = bInstall.service_shim;
  const runtimeB = invokeJson(bLauncher, ['runtime', 'doctor', '--json'], 'B runtime doctor');
  assert(runtimeB.verified && runtimeB.channel === 'stable' && runtimeB.origin === 'package', 'Package B is not verified stable package code');
  assert(runtimeB.package_version === '1.1.0', `Package B reported ${runtimeB.package_version}`);
  assert(aInstall.package_root !== bInstall.package_root, 'Packages A and B share an install root');
  assert(aInstall.receipt_path !== bInstall.receipt_path, 'Packages A and B share an install receipt');
  assert(aInstall.package_integrity !== bInstall.package_integrity, 'Packages A and B share tarball integrity');
  assert(aInstall.build_fingerprint !== bInstall.build_fingerprint, 'Packages A and B share a build fingerprint');
  assert(runtimeA.source_fingerprint !== runtimeB.source_fingerprint, 'Packages A and B share a source fingerprint');
  assert(runtimeA.fingerprint !== runtimeB.fingerprint, 'Packages A and B share a runtime fingerprint');

  const activeWriterRefusal = attempt(bLauncher, [
    'profile',
    'upgrade-runtime',
    '--profile',
    manifestPath,
    '--confirm-write',
    '--json',
  ]);
  assert(activeWriterRefusal.status !== 0, 'Package B upgraded while package A owned the writer lease');
  assert(output(activeWriterRefusal).includes('active service writer'), `Active-writer refusal was not explicit: ${output(activeWriterRefusal)}`);

  managerJson(aManager, 'stop', aLauncher);
  const stoppedAStatus = managerAttempt(aManager, 'status', aLauncher);
  assert(stoppedAStatus.status !== 0 && output(stoppedAStatus).includes('No managed service receipt'), 'Package A still reported a managed service after stop');

  const preUpgradeDoctor = attempt(bLauncher, ['profile', 'doctor', '--profile', manifestPath, '--json']);
  assert(preUpgradeDoctor.status !== 0, 'Package B profile doctor unexpectedly passed before the runtime-pin upgrade');
  const preUpgradeDoctorJson = JSON.parse(preUpgradeDoctor.stdout);
  assert(
    preUpgradeDoctorJson.checks.some(check => check.id === 'runtime_code' && check.status === 'fail'),
    'Pre-upgrade B doctor did not isolate the expected runtime-code mismatch',
  );

  const databaseBeforeUpgrade = readDatabaseEvidence(initialized.database_path);
  const dbInfoBeforeUpgrade = invokeJson(aLauncher, ['db', 'info', '--profile', manifestPath, '--json'], 'A db info');
  const upgrade = invokeJson(bLauncher, [
    'profile',
    'upgrade-runtime',
    '--profile',
    manifestPath,
    '--confirm-write',
    '--json',
  ], 'B profile runtime upgrade');
  assert(upgrade.schema_version === 'lineage.profile_runtime_upgrade_receipt.v1', 'Upgrade returned the wrong receipt schema');
  assert(upgrade.changed && upgrade.post_upgrade_doctor_ok, 'B did not report a completed, doctor-verified upgrade');
  assert(upgrade.previous_runtime.version === '1.0.0' && upgrade.new_runtime.version === '1.1.0', 'Upgrade receipt does not describe A-to-B');
  assert(upgrade.previous_runtime.code_fingerprint === runtimeA.fingerprint, 'Upgrade receipt lost package A fingerprint');
  assert(upgrade.new_runtime.code_fingerprint === runtimeB.fingerprint, 'Upgrade receipt lost package B fingerprint');

  const doctorB = invokeJson(bLauncher, ['profile', 'doctor', '--profile', manifestPath, '--json'], 'B profile doctor');
  const dbInfoB = invokeJson(bLauncher, ['db', 'info', '--profile', manifestPath, '--json'], 'B db info');
  const routingAfter = readRoutingSnapshot(manifestPath);
  const databaseAfter = readDatabaseEvidence(initialized.database_path);
  assert(doctorB.ok, 'Package B profile doctor did not pass after upgrade');
  assert(JSON.stringify(routingAfter) === JSON.stringify(routingBefore), 'Manifest routing fields changed during runtime upgrade');
  assert(doctorB.profile.profile_fingerprint === doctorA.profile.profile_fingerprint, 'Profile fingerprint changed during runtime upgrade');
  assert(doctorB.profile.database_path === initialized.database_path, 'Database path changed during runtime upgrade');
  assert(doctorB.profile.asset_root === initialized.asset_root, 'Asset root changed during runtime upgrade');
  assert(doctorB.profile.service_origin === initialized.service_origin, 'Service origin changed during runtime upgrade');
  assert(JSON.stringify(databaseAfter.identity) === JSON.stringify(databaseBeforeUpgrade.identity), 'Database identity changed during runtime upgrade');
  assert(databaseAfter.sentinel === databaseSentinel, 'Database content sentinel changed during runtime upgrade');
  assert(JSON.stringify(databaseAfter.migrations) === JSON.stringify(databaseBeforeUpgrade.migrations), 'Schema migration markers changed during runtime upgrade');
  assert(databaseAfter.migrations.includes(migrationKey), 'Required migration marker did not survive runtime upgrade');
  assert(readFileSync(join(initialized.asset_root, 'stable-upgrade-sentinel.txt'), 'utf8').trim() === assetSentinel, 'Asset content sentinel changed during runtime upgrade');
  assert(dbInfoB.database.path === dbInfoBeforeUpgrade.database.path, 'db info reports a different database after upgrade');
  assert(dbInfoB.schema.profile_id === dbInfoBeforeUpgrade.schema.profile_id, 'db info reports a different profile identity after upgrade');
  assert(dbInfoB.schema.profile_fingerprint === dbInfoBeforeUpgrade.schema.profile_fingerprint, 'db info reports a different profile fingerprint after upgrade');
  assert(JSON.stringify(dbInfoB.schema.migration_keys) === JSON.stringify(dbInfoBeforeUpgrade.schema.migration_keys), 'db info reports different migrations after upgrade');

  const idempotent = invokeJson(bLauncher, [
    'profile',
    'upgrade-runtime',
    '--profile',
    manifestPath,
    '--confirm-write',
    '--json',
  ], 'B idempotent runtime upgrade');
  assert(!idempotent.changed && idempotent.upgrade_kind === 'idempotent', 'Exact B retry was not idempotent');

  const downgradeRefusal = attempt(aLauncher, [
    'profile',
    'upgrade-runtime',
    '--profile',
    manifestPath,
    '--confirm-write',
    '--json',
  ]);
  assert(downgradeRefusal.status !== 0 && output(downgradeRefusal).includes('downgrade'), `Package A downgrade was not explicitly refused: ${output(downgradeRefusal)}`);

  const startedB = managerJson(bManager, 'start', bLauncher, ['--timeout-ms', '30000']);
  const statusB = managerJson(bManager, 'status', bLauncher);
  assert(startedB.healthy && statusB.healthy, 'Package B did not reach managed readiness');
  assert(statusB.runtime.code.fingerprint === runtimeB.fingerprint, 'Managed B code fingerprint differs from runtime doctor');
  assert(statusB.runtime.profile.fingerprint === doctorB.profile.profile_fingerprint, 'Managed B profile fingerprint differs from profile doctor');
  assert(statusB.runtime.database.path === initialized.database_path, 'Managed B opened the wrong database');
  assert(statusB.runtime.asset_root === initialized.asset_root, 'Managed B exposed the wrong asset root');
  assert(statusB.receipt.service_origin === initialized.service_origin, 'Managed B receipt changed service origin');
  managerJson(bManager, 'stop', bLauncher);

  assert(run('git', ['status', '--porcelain=v1']) === trackedStateBefore, 'Stable upgrade smoke changed tracked checkout state');
  console.log(JSON.stringify({
    ok: true,
    package_transition: {
      from: {
        build_fingerprint: aInstall.build_fingerprint,
        package_integrity: aInstall.package_integrity,
        receipt_path: aInstall.receipt_path,
        root: aInstall.package_root,
        runtime_fingerprint: runtimeA.fingerprint,
        source_fingerprint: runtimeA.source_fingerprint,
        version: runtimeA.package_version,
      },
      to: {
        build_fingerprint: bInstall.build_fingerprint,
        package_integrity: bInstall.package_integrity,
        receipt_path: bInstall.receipt_path,
        root: bInstall.package_root,
        runtime_fingerprint: runtimeB.fingerprint,
        source_fingerprint: runtimeB.source_fingerprint,
        version: runtimeB.package_version,
      },
    },
    preserved: {
      asset_content: true,
      asset_root: true,
      database_content: true,
      database_identity: true,
      database_path: true,
      migrations: true,
      profile_fingerprint: true,
      routing_fields: true,
      service_origin: true,
    },
    proofs: {
      active_writer_refused: true,
      downgrade_refused: true,
      exact_retry_idempotent: true,
      managed_a_ready: true,
      managed_b_ready: true,
      pre_upgrade_doctor_failed_closed: true,
      post_upgrade_identity_gate_passed: true,
    },
    receipt: {
      manifest_after_sha256: upgrade.manifest_after_sha256,
      manifest_before_sha256: upgrade.manifest_before_sha256,
      schema_version: upgrade.schema_version,
      upgrade_kind: upgrade.upgrade_kind,
    },
  }, null, 2));
} finally {
  if (manifestPath) {
    if (bManager && bLauncher) managerAttempt(bManager, 'stop', bLauncher, ['--force']);
    if (aManager && aLauncher) managerAttempt(aManager, 'stop', aLauncher, ['--force']);
  }
  terminateRecordedProcesses();
  rmSync(temporary, { force: true, recursive: true });
}
