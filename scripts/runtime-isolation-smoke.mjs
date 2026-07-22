#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tmp = mkdtempSync(join(tmpdir(), 'lineage-runtime-isolation-'));
const fixtureRoot = join(tmp, 'fixture');
const packRoot = join(tmp, 'packed');
const runtimeRoot = join(tmp, 'runtimes');
const channelCli = join(root, 'dist', 'cli', 'lineage-channel.js');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options });
}

function parsePack(output) {
  const parsed = JSON.parse(output);
  const item = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!item?.filename) throw new Error('npm pack did not return a tarball filename');
  return item.filename;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  for (const path of [
    channelCli,
    join(root, 'dist', 'cli', 'lineage.js'),
    join(root, 'dist', 'cli', 'lineage-dev.js'),
    join(root, 'dist', 'cli', 'managed-service.js'),
    join(root, 'dist', 'cli', 'lineage-preview.js'),
    join(root, 'dist', 'runtime-build.json'),
  ]) {
    if (!existsSync(path)) throw new Error(`Missing build artifact: ${path}; run npm run build first`);
  }

  mkdirSync(fixtureRoot, { recursive: true });
  cpSync(join(root, 'dist'), join(fixtureRoot, 'dist'), { recursive: true });
  cpSync(join(root, 'fixtures'), join(fixtureRoot, 'fixtures'), { recursive: true });
  cpSync(join(root, 'README.md'), join(fixtureRoot, 'README.md'));
  cpSync(join(root, 'LICENSE'), join(fixtureRoot, 'LICENSE'));
  cpSync(join(root, 'package.json'), join(fixtureRoot, 'package.json'));

  const packageInfo = JSON.parse(readFileSync(join(fixtureRoot, 'package.json'), 'utf8'));
  const buildWithoutFingerprint = {
    package_name: packageInfo.name,
    package_version: packageInfo.version,
    schema_version: 'lineage.runtime_build.v1',
    source_dirty: false,
    source_fingerprint: sha256('clean synthetic runtime-isolation package fixture'),
    source_git_sha: run('git', ['rev-parse', 'HEAD'], { cwd: root }).trim(),
  };
  writeFileSync(join(fixtureRoot, 'dist', 'runtime-build.json'), `${JSON.stringify({
    build_fingerprint: sha256(JSON.stringify(buildWithoutFingerprint)),
    ...buildWithoutFingerprint,
  }, null, 2)}\n`);

  mkdirSync(packRoot, { recursive: true });
  const tarball = join(packRoot, parsePack(run('npm', ['pack', '--json', '--pack-destination', packRoot], { cwd: fixtureRoot })));
  const defaultHome = join(tmp, 'default-home');
  const defaultNpmPrefix = join(tmp, 'default-npm-prefix');
  const defaultBin = join(defaultNpmPrefix, 'bin');
  const defaultEnvironment = {
    ...process.env,
    HOME: defaultHome,
    npm_config_prefix: defaultNpmPrefix,
    PATH: `${defaultBin}${delimiter}${process.env.PATH || ''}`,
  };
  const defaultInstall = JSON.parse(run(process.execPath, [
    channelCli,
    'install', 'stable',
    '--package', tarball,
    '--allow-local-package',
    '--json',
  ], { env: defaultEnvironment }));
  assert(defaultInstall.shim === join(defaultBin, 'lineage-stable'), 'Default install did not place its launcher in npm\'s global executable directory');
  const defaultIdentity = JSON.parse(run('lineage-stable', ['runtime', 'doctor', '--json'], { env: defaultEnvironment }));
  assert(defaultIdentity.verified && defaultIdentity.channel === 'stable', 'Default launcher was not immediately executable from PATH');

  const unacknowledgedLocal = spawnSync(process.execPath, [channelCli, 'install', 'stable', '--root', join(tmp, 'refused-local'), '--package', tarball, '--json'], { encoding: 'utf8' });
  assert(unacknowledgedLocal.status !== 0, 'Local tarball install unexpectedly succeeded without explicit acknowledgement');
  assert(unacknowledgedLocal.stderr.includes('--allow-local-package'), 'Local tarball refusal did not name the required acknowledgement');
  const installArgs = channel => [channelCli, 'install', channel, '--root', runtimeRoot, '--package', tarball, '--allow-local-package', '--json'];
  const stable = JSON.parse(run(process.execPath, installArgs('stable')));
  const preview = JSON.parse(run(process.execPath, installArgs('preview')));

  assert(stable.shim === join(runtimeRoot, 'bin', 'lineage-stable'), 'Custom runtime root did not keep its default launcher under <root>/bin');
  assert(stable.channel === 'stable' && preview.channel === 'preview', 'Channel receipts did not retain exact channel identity');
  assert(stable.package_root !== preview.package_root, 'Stable and preview resolved to the same package root');
  assert(stable.receipt_path !== preview.receipt_path, 'Stable and preview resolved to the same install receipt');
  assert(stable.package_integrity === preview.package_integrity, 'Same fixture tarball should retain the same registry-style integrity');
  assert(stable.package_tree_sha256 === preview.package_tree_sha256, 'Same fixture tarball should produce the same package tree hash');
  assert(existsSync(stable.service_shim) && existsSync(preview.service_shim), 'Channel installs did not create service-manager shims');
  assert(stable.service_shim !== preview.service_shim, 'Stable and preview share one service-manager shim');
  const stableServiceHelp = run(stable.service_shim, ['--help']);
  const previewServiceHelp = run(preview.service_shim, ['--help']);
  assert(stableServiceHelp.includes('lineage-service start'), `Stable service-manager shim did not execute packaged controller code: ${stableServiceHelp}`);
  assert(previewServiceHelp.includes('lineage-service start'), `Preview service-manager shim did not execute packaged controller code: ${previewServiceHelp}`);
  const checkoutStableManager = spawnSync(process.execPath, [
    join(root, 'scripts', 'managed-service.mjs'), 'status', '--channel', 'stable', '--profile', 'missing', '--json',
  ], { encoding: 'utf8' });
  assert(checkoutStableManager.status !== 0 && checkoutStableManager.stderr.includes('attested packaged manager'), 'Checkout controller unexpectedly managed stable');
  const packagedDevManager = spawnSync(stable.service_shim, ['status', '--channel', 'dev', '--profile', 'missing', '--json'], { encoding: 'utf8' });
  assert(packagedDevManager.status !== 0 && packagedDevManager.stderr.includes('checkout-only'), 'Packaged controller unexpectedly managed dev');
  const stableManagerEntrypoint = join(stable.package_root, 'dist', 'cli', 'managed-service.js');
  const stableManagerOriginal = readFileSync(stableManagerEntrypoint);
  appendFileSync(stableManagerEntrypoint, '\n// runtime smoke service-manager tamper\n');
  const tamperedManager = spawnSync(stable.service_shim, ['status', '--channel', 'stable', '--profile', 'missing', '--json'], { encoding: 'utf8' });
  assert(tamperedManager.status !== 0 && tamperedManager.stderr.includes('package tree does not match'), `Tampered stable service manager unexpectedly operated: ${tamperedManager.stderr || tamperedManager.stdout}`);
  writeFileSync(stableManagerEntrypoint, stableManagerOriginal);

  const stableIdentity = JSON.parse(run(stable.shim, ['runtime', 'doctor', '--json']));
  const previewIdentity = JSON.parse(run(preview.shim, ['runtime', 'doctor', '--json']));
  assert(stableIdentity.verified && stableIdentity.channel === 'stable' && stableIdentity.origin === 'package', 'Stable launcher did not prove its packaged identity');
  assert(previewIdentity.verified && previewIdentity.channel === 'preview' && previewIdentity.origin === 'package', 'Preview launcher did not prove its packaged identity');
  assert(stableIdentity.root !== previewIdentity.root, 'Runtime identities did not retain distinct code roots');

  const packagedDev = spawnSync(process.execPath, [join(stable.package_root, 'dist', 'cli', 'lineage-dev.js'), '--help'], {
    encoding: 'utf8',
    env: { ...process.env, LINEAGE_ASSET_ROOT: root, LINEAGE_REPO_ROOT: root },
  });
  assert(packagedDev.status !== 0, 'Published package lineage-dev unexpectedly succeeded');
  assert(packagedDev.stderr.includes('published package execution is disabled'), 'Packaged dev rejection did not explain the checkout-only contract');

  const status = JSON.parse(run(process.execPath, [channelCli, 'status', '--root', runtimeRoot, '--json']));
  assert(status.stable?.installed && status.preview?.installed, 'Channel status did not verify both isolated installs');
  assert(status.stable.service_shim === stable.service_shim && status.preview.service_shim === preview.service_shim, 'Channel status lost service-manager shim identity');

  appendFileSync(join(preview.package_root, 'dist', 'cli', 'lineage-preview.js'), '\n// runtime smoke tamper\n');
  const tampered = spawnSync(preview.shim, ['runtime', 'doctor', '--json'], { encoding: 'utf8' });
  assert(tampered.status !== 0, 'Tampered preview package unexpectedly passed runtime doctor');
  assert(tampered.stderr.includes('Installed package tree does not match'), 'Tampered preview failure did not identify package tree drift');

  console.log(JSON.stringify({
    ok: true,
    local_package_requires_acknowledgement: true,
    packaged_dev_failed_closed: true,
    packaged_service_managers: { preview: preview.service_shim, stable: stable.service_shim },
    preview_root: preview.package_root,
    stable_root: stable.package_root,
    tamper_failed_closed: true,
  }, null, 2));
} finally {
  rmSync(tmp, { force: true, recursive: true });
}
