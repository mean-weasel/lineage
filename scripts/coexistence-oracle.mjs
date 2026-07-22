#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), 'lineage-coexistence-oracle-'));
const runtimeRoot = join(temporary, 'runtimes');
const shimRoot = join(temporary, 'channel-launchers');
const serviceRoot = join(temporary, 'services');
const profileRoot = join(temporary, 'profiles');
const checkoutManager = join(root, 'scripts', 'managed-service.mjs');
const channelCli = join(root, 'dist', 'cli', 'lineage-channel.js');
const pluginInstaller = join(root, 'packages', 'lineage-plugin-installer', 'bin', 'lineage-plugin-installer.mjs');
const devLauncher = [process.execPath, '--import', 'tsx', join(root, 'src', 'cli', 'lineage-dev.ts')];
const managerLaunchers = new Map([['dev', [process.execPath, checkoutManager]]]);
const controlledEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LINEAGE_') && key !== 'HOST' && key !== 'PORT'));
Object.assign(controlledEnv, {
  LINEAGE_PROFILE_ROOT: profileRoot,
  LINEAGE_RUNTIME_ROOT: runtimeRoot,
  LINEAGE_SERVICE_ROOT: serviceRoot,
});

const started = [];
let previewEntrypoint;
let previewEntrypointOriginal;
let stableReceiptOriginal;
let stableReceiptPath;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', env: controlledEnv, ...options });
}

function attempt(command, args, options = {}) {
  return spawnSync(command, args, { cwd: root, encoding: 'utf8', env: controlledEnv, ...options });
}

function invoke(launcher, args, options = {}) {
  return attempt(launcher[0], [...launcher.slice(1), ...args], options);
}

function invokeJson(launcher, args) {
  const result = invoke(launcher, args);
  assert(result.status === 0, `${launcher.at(-1)} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

function parsePack(output) {
  const parsed = JSON.parse(output);
  const item = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!item?.filename) throw new Error('npm pack did not return a tarball filename');
  return item.filename;
}

function syntheticPackage(label) {
  const fixture = join(temporary, `package-${label}`);
  const packed = join(temporary, `packed-${label}`);
  mkdirSync(fixture, { recursive: true });
  mkdirSync(packed, { recursive: true });
  cpSync(join(root, 'dist'), join(fixture, 'dist'), { recursive: true });
  cpSync(join(root, 'fixtures'), join(fixture, 'fixtures'), { recursive: true });
  for (const file of ['README.md', 'CHANGELOG.md', 'LICENSE', 'package.json']) cpSync(join(root, file), join(fixture, file));
  const packageInfo = JSON.parse(readFileSync(join(fixture, 'package.json'), 'utf8'));
  const build = {
    package_name: packageInfo.name,
    package_version: packageInfo.version,
    schema_version: 'lineage.runtime_build.v1',
    source_dirty: false,
    source_fingerprint: sha256(`clean synthetic ${label} coexistence source`),
    source_git_sha: run('git', ['rev-parse', 'HEAD']).trim(),
  };
  writeFileSync(join(fixture, 'dist', 'runtime-build.json'), `${JSON.stringify({
    build_fingerprint: sha256(JSON.stringify(build)),
    ...build,
  }, null, 2)}\n`);
  return join(packed, parsePack(run('npm', ['pack', '--json', '--pack-destination', packed], { cwd: fixture })));
}

function installChannel(channel, tarball) {
  return JSON.parse(run(process.execPath, [
    channelCli,
    'install', channel,
    '--root', runtimeRoot,
    '--shim-dir', shimRoot,
    '--package', tarball,
    '--allow-local-package',
    '--json',
  ]));
}

function managerArgs(command, profile, launcher, extra = []) {
  return [command, '--channel', profile.channel, '--profile', profile.manifest, ...(launcher ? ['--launcher', launcher[0]] : []), ...extra, '--json'];
}

function invokeManager(command, profile, launcher, extra = [], managerLauncher = managerLaunchers.get(profile.channel)) {
  assert(managerLauncher, `No service manager is configured for ${profile.channel}`);
  return attempt(managerLauncher[0], [...managerLauncher.slice(1), ...managerArgs(command, profile, launcher, extra)]);
}

function tableNames(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database.prepare("select name from sqlite_master where type = 'table' order by name").all().map(row => row.name);
  } finally {
    database.close();
  }
}

function writeProfile({ channel, environment, id, launcher, port }) {
  const code = invokeJson(launcher, ['runtime', 'doctor', '--json']);
  const directory = join(profileRoot, id);
  const database = join(directory, 'lineage.sqlite');
  const manifest = join(directory, 'profile.json');
  const assetRoot = join(directory, 'media');
  mkdirSync(assetRoot, { recursive: true });
  writeFileSync(manifest, `${JSON.stringify({
    asset_root: assetRoot,
    database_path: database,
    environment,
    expected_runtime: { channel, code_fingerprint: code.fingerprint, code_origin: code.origin },
    profile_id: id,
    schema_version: 'lineage.profile.v1',
    service_origin: `http://127.0.0.1:${port}`,
  }, null, 2)}\n`);
  new DatabaseSync(database).close();
  const binding = invokeJson(launcher, ['profile', 'bind', '--profile', manifest, '--confirm-write', '--json']);
  const doctor = invokeJson(launcher, ['profile', 'doctor', '--profile', manifest, '--json']);
  assert(doctor.ok && doctor.profile.profile_fingerprint === binding.identity.profile_fingerprint, `${id} profile did not bind cleanly`);
  return { channel, code, database, doctor, environment, id, manifest, origin: `http://127.0.0.1:${port}` };
}

function provePositiveClaim(profile, launcher) {
  const claim = invokeJson(launcher, [
    'agent', 'claim', '--profile', profile.manifest,
    '--project', 'coexistence-oracle',
    '--scope', 'lineage_workspace',
    '--target', `${profile.id}-workspace`,
    '--agent-name', 'coexistence-oracle',
    '--ttl', '1m', '--json',
  ]);
  assert(claim.claim_token, `${profile.id} did not return a claim token`);
  const released = invokeJson(launcher, ['agent', 'release', '--profile', profile.manifest, '--claim-token', claim.claim_token, '--json']);
  assert(released.claim?.status === 'released', `${profile.id} did not release its positive-write claim`);
}

async function reservePorts(count) {
  const servers = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const server = createServer();
      await new Promise((resolveListen, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolveListen);
      });
      servers.push(server);
    }
    return servers.map(server => server.address().port);
  } finally {
    await Promise.all(servers.map(server => new Promise(resolveClose => server.close(resolveClose))));
  }
}

function statusManager(profile, launcher) {
  const result = invokeManager('status', profile, launcher);
  assert(result.status === 0, `${profile.id} managed status failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

try {
  for (const required of [channelCli, checkoutManager, pluginInstaller, join(root, 'dist', 'server.js'), join(root, 'dist', 'cli', 'managed-service.js')]) {
    if (!existsSync(required)) throw new Error(`Missing ${required}; run npm run build first`);
  }

  const stableTarball = syntheticPackage('stable');
  const previewTarball = syntheticPackage('preview');
  const refusedLocal = attempt(process.execPath, [channelCli, 'install', 'stable', '--root', join(temporary, 'refused-runtime'), '--package', stableTarball, '--json']);
  assert(refusedLocal.status !== 0 && refusedLocal.stderr.includes('--allow-local-package'), 'Local package install did not require explicit acknowledgement');
  const stableInstall = installChannel('stable', stableTarball);
  const previewInstall = installChannel('preview', previewTarball);
  const stableLauncher = [stableInstall.shim];
  const previewLauncher = [previewInstall.shim];
  managerLaunchers.set('stable', [stableInstall.service_shim]);
  managerLaunchers.set('preview', [previewInstall.service_shim]);
  assert(stableInstall.service_shim !== previewInstall.service_shim, 'Stable and preview share one service-manager shim');
  assert(!stableInstall.service_shim.startsWith(root) && !previewInstall.service_shim.startsWith(root), 'Published channel service manager resolves from the checkout');
  const devCode = invokeJson(devLauncher, ['runtime', 'doctor', '--json']);
  assert(new Set([stableInstall.package_root, previewInstall.package_root, devCode.root]).size === 3, 'Code roots are not distinct');

  const [stablePort, previewPort, devPort] = await reservePorts(3);
  const stable = writeProfile({ channel: 'stable', environment: 'production', id: 'oracle-stable', launcher: stableLauncher, port: stablePort });
  const preview = writeProfile({ channel: 'preview', environment: 'preview', id: 'oracle-preview', launcher: previewLauncher, port: previewPort });
  const dev = writeProfile({ channel: 'dev', environment: 'development', id: 'oracle-dev', launcher: devLauncher, port: devPort });
  const profiles = [stable, preview, dev];
  const launchers = new Map([['stable', stableLauncher], ['preview', previewLauncher], ['dev', devLauncher]]);

  assert(new Set(profiles.map(profile => profile.code.fingerprint)).size === 3, 'Code fingerprints are not distinct');
  assert(new Set(profiles.map(profile => profile.doctor.profile.profile_fingerprint)).size === 3, 'Profile fingerprints are not distinct');
  assert(new Set(profiles.map(profile => profile.database)).size === 3, 'Database paths are not distinct');
  for (const profile of profiles) provePositiveClaim(profile, launchers.get(profile.channel));

  const stableAgainstPreview = invoke(stableLauncher, ['profile', 'doctor', '--profile', preview.manifest, '--json']);
  const previewAgainstStable = invoke(previewLauncher, ['profile', 'doctor', '--profile', stable.manifest, '--json']);
  const devAgainstStable = invoke(devLauncher, ['profile', 'doctor', '--profile', stable.manifest, '--json']);
  assert(stableAgainstPreview.status !== 0 && previewAgainstStable.status !== 0 && devAgainstStable.status !== 0, 'Cross-channel profile access unexpectedly succeeded');
  const crossChannelStart = invokeManager('start', preview, stableLauncher, [], managerLaunchers.get('stable'));
  assert(crossChannelStart.status !== 0, 'Stable manager unexpectedly started the preview profile');

  const rawDatabase = join(temporary, 'forbidden-unbound.sqlite');
  const unboundWrite = invoke(devLauncher, [
    'agent', 'claim', '--project', 'coexistence-oracle', '--scope', 'lineage_workspace',
    '--target', 'unbound', '--agent-name', 'oracle', '--ttl', '1m', '--db', rawDatabase, '--json',
  ]);
  assert(unboundWrite.status !== 0 && !existsSync(rawDatabase), 'Legacy-unbound write created a database');

  const stableBefore = sha256(readFileSync(stable.database));
  const stableTables = tableNames(stable.database);
  const rawProductionWrite = invoke(devLauncher, [
    'agent', 'claim', '--project', 'coexistence-oracle', '--scope', 'lineage_workspace',
    '--target', 'raw-production', '--agent-name', 'oracle', '--ttl', '1m', '--db', stable.database, '--json',
  ]);
  assert(rawProductionWrite.status !== 0, 'Dev direct-path write to production data unexpectedly succeeded');
  assert(sha256(readFileSync(stable.database)) === stableBefore && JSON.stringify(tableNames(stable.database)) === JSON.stringify(stableTables), 'Rejected raw production write changed the stable database');

  for (const profile of profiles) {
    const launcher = undefined;
    const result = invokeManager('start', profile, launcher, ['--timeout-ms', '30000']);
    assert(result.status === 0, `${profile.id} managed start failed: ${result.stderr || result.stdout}`);
    const startedResult = JSON.parse(result.stdout);
    started.push({ launcher, profile, receipt: startedResult.receipt });
  }

  const statuses = profiles.map(profile => statusManager(profile, undefined));
  assert(new Set(statuses.map(status => status.runtime.channel)).size === 3, 'Simultaneous services do not expose three channels');
  assert(new Set(statuses.map(status => status.runtime.code.root)).size === 3, 'Simultaneous services do not expose three code roots');
  assert(new Set(statuses.map(status => status.runtime.code.fingerprint)).size === 3, 'Simultaneous services do not expose three code fingerprints');
  assert(new Set(statuses.map(status => status.runtime.profile.fingerprint)).size === 3, 'Simultaneous services do not expose three profile fingerprints');
  assert(new Set(statuses.map(status => status.runtime.database.path)).size === 3, 'Simultaneous services do not expose three database paths');
  assert(new Set(statuses.map(status => status.runtime.service.instance_id)).size === 3, 'Simultaneous services do not expose three instance IDs');

  const routedWriter = invokeJson(stableLauncher, [
    'agent', 'claim', '--profile', stable.manifest, '--project', 'coexistence-oracle',
    '--scope', 'lineage_workspace', '--target', 'managed-writer-route', '--agent-name', 'oracle', '--ttl', '1m', '--json',
  ]);
  assert(routedWriter.claim_token, 'Stable CLI mutation did not route through the managed service');
  invokeJson(stableLauncher, ['agent', 'release', '--profile', stable.manifest, '--claim-token', routedWriter.claim_token, '--json']);

  const stableProfile = stable.doctor.profile;
  const secondWriter = attempt(process.execPath, [join(stableInstall.package_root, 'dist', 'server.js')], {
    env: {
      ...controlledEnv,
      HOST: '127.0.0.1',
      LINEAGE_ASSET_ROOT: stableProfile.asset_root,
      LINEAGE_CHANNEL: 'stable',
      LINEAGE_DB: stableProfile.database_path,
      LINEAGE_PROFILE: stableProfile.manifest_path,
      LINEAGE_PROFILE_ENVIRONMENT: stableProfile.environment,
      LINEAGE_PROFILE_FINGERPRINT: stableProfile.profile_fingerprint,
      LINEAGE_PROFILE_ID: stableProfile.profile_id,
      LINEAGE_PROFILE_MANIFEST: stableProfile.manifest_path,
      LINEAGE_PROFILE_SERVICE_ORIGIN: stableProfile.service_origin,
      LINEAGE_RELEASE_CHANNEL: 'stable',
      LINEAGE_RUNTIME_RECEIPT: stableInstall.receipt_path,
      NODE_ENV: 'production',
      PORT: new URL(stableProfile.service_origin).port,
    },
    timeout: 5_000,
  });
  assert(
    secondWriter.status !== 0 && secondWriter.stderr.includes('active service writer'),
    `A second direct stable service writer was not refused while the managed service owned the lease: ${secondWriter.stderr || secondWriter.stdout || secondWriter.error?.message || 'no diagnostic'}`,
  );

  stableReceiptPath = statuses[0].state_path;
  stableReceiptOriginal = readFileSync(stableReceiptPath);
  const wrongReceipt = JSON.parse(stableReceiptOriginal);
  wrongReceipt.service_origin = preview.origin;
  writeFileSync(stableReceiptPath, `${JSON.stringify(wrongReceipt, null, 2)}\n`);
  const wrongService = invokeManager('status', stable, stableLauncher);
  assert(wrongService.status !== 0 && /channel|profile|database|service origin/.test(wrongService.stderr), 'Wrong-service receipt unexpectedly passed status');
  writeFileSync(stableReceiptPath, stableReceiptOriginal);
  stableReceiptOriginal = undefined;
  assert(statusManager(stable, stableLauncher).healthy, 'Stable status did not recover after restoring the exact receipt');

  previewEntrypoint = join(previewInstall.package_root, 'dist', 'cli', 'lineage-preview.js');
  previewEntrypointOriginal = readFileSync(previewEntrypoint);
  appendFileSync(previewEntrypoint, '\n// coexistence oracle stale-build tamper\n');
  const staleBuild = invokeManager('status', preview, previewLauncher);
  assert(staleBuild.status !== 0, 'Tampered preview package unexpectedly passed managed status');
  writeFileSync(previewEntrypoint, previewEntrypointOriginal);
  previewEntrypointOriginal = undefined;
  assert(statusManager(preview, previewLauncher).healthy, 'Preview status did not recover after restoring package bytes');

  const mismatchedPlugin = join(temporary, 'mismatched-plugin');
  const pluginTarget = join(temporary, 'plugin-target');
  cpSync(join(root, 'plugins', 'lineage-codex-plugin'), mismatchedPlugin, { recursive: true });
  const mismatchManifestPath = join(mismatchedPlugin, '.codex-plugin', 'plugin.json');
  const mismatchManifest = JSON.parse(readFileSync(mismatchManifestPath, 'utf8'));
  mismatchManifest.version = '0.0.0-mismatch';
  mismatchManifest.lineage.version = '0.0.0-mismatch';
  writeFileSync(mismatchManifestPath, `${JSON.stringify(mismatchManifest, null, 2)}\n`);
  const pluginMismatch = attempt(process.execPath, [
    pluginInstaller, 'install', '--plugin', mismatchedPlugin, '--version', stable.code.package_version,
    '--target-dir', pluginTarget, '--json',
  ]);
  assert(pluginMismatch.status !== 0 && !existsSync(join(pluginTarget, 'lineage-codex-plugin')), 'Mismatched plugin unexpectedly installed');

  console.log(JSON.stringify({
    code: Object.fromEntries(profiles.map(profile => [profile.channel, { fingerprint: profile.code.fingerprint, root: profile.code.root }])),
    data: Object.fromEntries(profiles.map(profile => [profile.channel, { database: profile.database, profile_fingerprint: profile.doctor.profile.profile_fingerprint }])),
    service_managers: Object.fromEntries([...managerLaunchers].map(([channel, launcher]) => [channel, launcher.at(-1)])),
    negative_proofs: [
      'cross-channel profile and service start refused',
      'legacy-unbound write refused without database creation',
      'dev raw-path production write refused without database change',
      'stale packaged build failed managed status',
      'wrong service origin failed identity status',
      'CLI mutation routed through authenticated managed writer',
      'second writer refused by stable service lease',
      'mismatched Codex plugin refused before install',
    ],
    ok: true,
    simultaneous_services: statuses.map(status => ({
      channel: status.runtime.channel,
      instance_id: status.runtime.service.instance_id,
      origin: status.receipt.service_origin,
      pid: status.receipt.pid,
      profile: status.runtime.profile.id,
    })),
  }, null, 2));
} finally {
  if (previewEntrypoint && previewEntrypointOriginal) writeFileSync(previewEntrypoint, previewEntrypointOriginal);
  if (stableReceiptPath && stableReceiptOriginal) writeFileSync(stableReceiptPath, stableReceiptOriginal);
  for (const item of started.reverse()) {
    const stopped = invokeManager('stop', item.profile, item.launcher, ['--force']);
    if (stopped.status !== 0) {
      try { process.kill(-item.receipt.pid, 'SIGKILL'); } catch { /* already stopped */ }
    }
  }
  rmSync(temporary, { force: true, recursive: true });
}
