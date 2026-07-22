#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  lineageRuntimeBuildSchemaVersion,
  lineageRuntimeInstallSchemaVersion,
  type LineageRuntimeBuildIdentity,
  type LineageRuntimeInstallReceipt,
} from '../shared/runtimeInfoTypes';

type PublishedChannel = 'stable' | 'preview';
interface ResolvedPackageSpec {
  expectedVersion?: string;
  installSpec: string;
  integrity: string;
  requestedSpec: string;
  source: LineageRuntimeInstallReceipt['package_source'];
}

interface RegistryPackageMetadata {
  dist?: { integrity?: unknown };
  'dist.integrity'?: unknown;
  version?: unknown;
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const packageInfo = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { name: string; version: string };

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function readOption(args: string[], name: string): string | undefined {
  const inline = args.find(arg => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function runtimeRoot(): string {
  if (process.env.LINEAGE_RUNTIME_ROOT) return resolve(process.env.LINEAGE_RUNTIME_ROOT);
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Lineage', 'runtimes');
  if (platform() === 'win32') return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Lineage', 'runtimes');
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'lineage', 'runtimes');
}

function globalNpmExecutableDirectory(): string {
  let prefix: string;
  try {
    prefix = execFileSync('npm', ['prefix', '--global'], { encoding: 'utf8' }).trim();
  } catch (error) {
    throw new Error('Could not locate the global npm executable directory; pass --shim-dir explicitly', { cause: error });
  }
  if (!prefix) throw new Error('npm returned an empty global prefix; pass --shim-dir explicitly');
  return platform() === 'win32' ? resolve(prefix) : resolve(prefix, 'bin');
}

function shimDirectory(args: string[], root: string): string {
  const explicit = readOption(args, '--shim-dir');
  if (explicit) return resolve(explicit);
  if (readOption(args, '--root') || process.env.LINEAGE_RUNTIME_ROOT) return join(root, 'bin');
  return globalNpmExecutableDirectory();
}

function parseChannel(value?: string): PublishedChannel {
  if (value === 'stable' || value === 'preview') return value;
  throw new Error('Channel must be stable or preview; dev is checkout-only');
}

function packageTreeSha256(root: string): string {
  const hash = createHash('sha256');
  const visit = (directory: string, relativeDirectory = '') => {
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
  visit(root);
  return hash.digest('hex');
}

function expectedBuildFingerprint(build: Omit<LineageRuntimeBuildIdentity, 'build_fingerprint'>): string {
  return sha256(JSON.stringify({
    package_name: build.package_name,
    package_version: build.package_version,
    schema_version: build.schema_version,
    source_dirty: build.source_dirty,
    source_fingerprint: build.source_fingerprint,
    source_git_sha: build.source_git_sha,
  }));
}

function validateBuild(root: string, installed: { name: string; version: string }): LineageRuntimeBuildIdentity {
  const path = join(root, 'dist', 'runtime-build.json');
  const build = JSON.parse(readFileSync(path, 'utf8')) as LineageRuntimeBuildIdentity;
  if (build.schema_version !== lineageRuntimeBuildSchemaVersion) throw new Error(`Unsupported build identity schema in ${path}`);
  if (build.package_name !== installed.name || build.package_version !== installed.version) throw new Error('Embedded build identity does not match installed package.json');
  if (!/^[a-f0-9]{40}$/i.test(build.source_git_sha)) throw new Error('Embedded build Git revision is invalid');
  if (!/^[a-f0-9]{64}$/i.test(build.source_fingerprint)) throw new Error('Embedded source fingerprint is invalid');
  if (build.build_fingerprint !== expectedBuildFingerprint(build)) throw new Error('Embedded build fingerprint does not match its contents');
  if (build.source_dirty) throw new Error('Refusing stable/preview installation of a dirty-source build');
  return build;
}

export function parseRegistryPackageMetadata(value: unknown): { integrity: string; version: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('npm metadata was not a JSON object');
  }
  const metadata = value as RegistryPackageMetadata;
  const nestedIntegrity = metadata.dist?.integrity;
  const flatIntegrity = metadata['dist.integrity'];
  if (
    typeof nestedIntegrity === 'string'
    && typeof flatIntegrity === 'string'
    && nestedIntegrity !== flatIntegrity
  ) {
    throw new Error('npm metadata returned conflicting integrity values');
  }
  const integrity = typeof nestedIntegrity === 'string' ? nestedIntegrity : flatIntegrity;
  if (typeof metadata.version !== 'string' || !metadata.version || typeof integrity !== 'string' || !integrity) {
    throw new Error('npm metadata did not include exact version and integrity');
  }
  return { integrity, version: metadata.version };
}

function resolveSpec(spec: string, allowLocalPackage: boolean): ResolvedPackageSpec {
  const localPath = resolve(spec.replace(/^file:/, ''));
  if (existsSync(localPath)) {
    if (!allowLocalPackage) {
      throw new Error('Local package paths require --allow-local-package; normal stable/preview installs must resolve from the npm registry');
    }
    return {
      installSpec: localPath,
      integrity: `sha512-${createHash('sha512').update(readFileSync(localPath)).digest('base64')}`,
      requestedSpec: spec,
      source: 'local',
    };
  }
  let metadata: { integrity: string; version: string };
  try {
    metadata = parseRegistryPackageMetadata(JSON.parse(execFileSync('npm', ['view', spec, 'version', 'dist.integrity', '--json'], { encoding: 'utf8' })));
  } catch (error) {
    throw new Error(`npm metadata for ${spec} did not include exact version and integrity`, { cause: error });
  }
  const name = spec.startsWith('@') ? spec.slice(0, spec.indexOf('@', 1)) : spec.split('@')[0];
  return {
    installSpec: `${name}@${metadata.version}`,
    integrity: metadata.integrity,
    expectedVersion: metadata.version,
    requestedSpec: spec,
    source: 'registry',
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function writeShim(
  path: string,
  channel: PublishedChannel,
  receiptPath: string,
  entrypoint: string,
  environment: Record<string, string> = {},
): void {
  const tempPath = `${path}.tmp-${process.pid}`;
  const assignments = Object.entries(environment).map(([key, value]) => `${key}=${shellQuote(value)}`).join(' ');
  const script = `#!/bin/sh\nLINEAGE_RUNTIME_RECEIPT=${shellQuote(receiptPath)} LINEAGE_RELEASE_CHANNEL=${shellQuote(channel)}${assignments ? ` ${assignments}` : ''} exec ${shellQuote(process.execPath)} ${shellQuote(entrypoint)} "$@"\n`;
  writeFileSync(tempPath, script, { mode: 0o755 });
  chmodSync(tempPath, 0o755);
  renameSync(tempPath, path);
}

function validateExistingReceipt(
  receiptPath: string,
  channel: PublishedChannel,
  expected?: { build: LineageRuntimeBuildIdentity; integrity: string; packageRoot: string; source: ResolvedPackageSpec['source']; version: string },
): LineageRuntimeInstallReceipt {
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as LineageRuntimeInstallReceipt;
  if (receipt.schema_version !== lineageRuntimeInstallSchemaVersion || receipt.channel !== channel) throw new Error(`Invalid existing ${channel} runtime receipt`);
  const installed = JSON.parse(readFileSync(join(receipt.package_root, 'package.json'), 'utf8')) as { name: string; version: string };
  const build = validateBuild(receipt.package_root, installed);
  if (receipt.package_name !== installed.name || receipt.package_version !== installed.version) throw new Error(`Existing ${channel} receipt does not match package.json`);
  if (receipt.build_fingerprint !== build.build_fingerprint) throw new Error(`Existing ${channel} receipt does not match embedded build identity`);
  if (packageTreeSha256(receipt.package_root) !== receipt.package_tree_sha256) throw new Error(`Existing ${channel} runtime package tree has changed`);
  if (expected && (
    receipt.package_integrity !== expected.integrity
    || receipt.package_root !== expected.packageRoot
    || receipt.package_source !== expected.source
    || receipt.package_version !== expected.version
    || receipt.build_fingerprint !== expected.build.build_fingerprint
  )) {
    throw new Error(`Existing ${channel} runtime receipt does not match the freshly resolved package`);
  }
  return receipt;
}

function install(channel: PublishedChannel, args: string[]): LineageRuntimeInstallReceipt & { receipt_path: string; service_shim: string; shim: string } {
  const root = resolve(readOption(args, '--root') || runtimeRoot());
  const shimDir = shimDirectory(args, root);
  const requestedSpec = readOption(args, '--package') || `${packageInfo.name}@${channel === 'stable' ? 'latest' : 'next'}`;
  const resolvedSpec = resolveSpec(requestedSpec, args.includes('--allow-local-package'));
  const channelRoot = join(root, 'installs', channel);
  mkdirSync(channelRoot, { recursive: true });
  const stagingRoot = mkdtempSync(join(channelRoot, '.staging-'));
  let keepStaging = false;
  try {
    execFileSync('npm', [
      'install', '--prefix', stagingRoot, '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', resolvedSpec.installSpec,
    ], { stdio: 'ignore' });
    const stagingPackageRoot = join(stagingRoot, 'node_modules', ...packageInfo.name.split('/'));
    const installed = JSON.parse(readFileSync(join(stagingPackageRoot, 'package.json'), 'utf8')) as { name: string; version: string };
    if (installed.name !== packageInfo.name) throw new Error(`Installed unexpected package ${installed.name}`);
    if (resolvedSpec.expectedVersion && installed.version !== resolvedSpec.expectedVersion) throw new Error(`Installed ${installed.version}, expected ${resolvedSpec.expectedVersion}`);
    const build = validateBuild(stagingPackageRoot, installed);
    const installId = `${installed.version}-${sha256(resolvedSpec.integrity).slice(0, 16)}`;
    const finalRoot = join(channelRoot, installId);
    const finalPackageRoot = join(finalRoot, 'node_modules', ...packageInfo.name.split('/'));
    const receiptPath = join(finalRoot, 'lineage-runtime-receipt.json');
    let receipt: LineageRuntimeInstallReceipt;
    if (existsSync(finalRoot)) {
      receipt = validateExistingReceipt(receiptPath, channel, {
        build,
        integrity: resolvedSpec.integrity,
        packageRoot: finalPackageRoot,
        source: resolvedSpec.source,
        version: installed.version,
      });
    } else {
      const packageTree = packageTreeSha256(stagingPackageRoot);
      renameSync(stagingRoot, finalRoot);
      keepStaging = true;
      receipt = {
        build_fingerprint: build.build_fingerprint,
        channel,
        installed_at: new Date().toISOString(),
        package_integrity: resolvedSpec.integrity,
        package_name: installed.name,
        package_root: finalPackageRoot,
        package_source: resolvedSpec.source,
        package_spec: resolvedSpec.requestedSpec,
        package_tree_sha256: packageTree,
        package_version: installed.version,
        schema_version: lineageRuntimeInstallSchemaVersion,
      };
      writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    }
    mkdirSync(shimDir, { recursive: true });
    const shim = join(shimDir, channel === 'stable' ? 'lineage-stable' : 'lineage-preview');
    const entrypoint = join(finalPackageRoot, 'dist', 'cli', channel === 'stable' ? 'lineage.js' : 'lineage-preview.js');
    if (!existsSync(entrypoint)) throw new Error(`Installed package is missing ${entrypoint}`);
    writeShim(shim, channel, receiptPath, entrypoint);
    const serviceShim = join(shimDir, channel === 'stable' ? 'lineage-stable-service' : 'lineage-preview-service');
    const serviceEntrypoint = join(finalPackageRoot, 'dist', 'cli', 'managed-service.js');
    if (!existsSync(serviceEntrypoint)) throw new Error(`Installed package is missing ${serviceEntrypoint}`);
    writeShim(serviceShim, channel, receiptPath, serviceEntrypoint, { LINEAGE_CHANNEL_LAUNCHER: shim });
    const pointerDir = join(root, 'channels');
    mkdirSync(pointerDir, { recursive: true });
    writeFileSync(join(pointerDir, `${channel}.json`), `${JSON.stringify({ channel, receipt_path: receiptPath, service_shim: serviceShim, shim }, null, 2)}\n`, { mode: 0o600 });
    return { ...receipt, receipt_path: receiptPath, service_shim: serviceShim, shim };
  } finally {
    if (!keepStaging) rmSync(stagingRoot, { force: true, recursive: true });
  }
}

function status(args: string[]): unknown {
  const root = resolve(readOption(args, '--root') || runtimeRoot());
  return Object.fromEntries((['stable', 'preview'] as const).map(channel => {
    const pointerPath = join(root, 'channels', `${channel}.json`);
    if (!existsSync(pointerPath)) return [channel, { installed: false }];
    try {
      const pointer = JSON.parse(readFileSync(pointerPath, 'utf8')) as { receipt_path: string; service_shim: string; shim: string };
      const receipt = validateExistingReceipt(pointer.receipt_path, channel);
      if (!existsSync(pointer.shim) || !existsSync(pointer.service_shim)) throw new Error(`Existing ${channel} runtime shims are missing`);
      return [channel, { installed: true, receipt, receipt_path: pointer.receipt_path, service_shim: pointer.service_shim, shim: pointer.shim }];
    } catch (error) {
      return [channel, { error: error instanceof Error ? error.message : String(error), installed: false }];
    }
  }));
}

function usage(): string {
  return `lineage-channel ${packageInfo.version}

Usage:
  lineage-channel install stable [--root <path>] [--shim-dir <path>] [--package <npm-spec>] [--json]
  lineage-channel install preview [--root <path>] [--shim-dir <path>] [--package <npm-spec>] [--json]
  lineage-channel status [--root <path>] [--json]

Stable and preview are installed into separate content-addressed roots. Dev is
checkout-only and is started with npm run lineage:dev -- <command>. Local
tarballs are refused unless --allow-local-package is supplied explicitly.
Default installs put launchers in npm's global executable directory, which is
already on PATH when lineage-channel is invoked. A custom --root keeps its
launchers under <root>/bin unless --shim-dir is also supplied.`;
}

function print(value: unknown, json: boolean): void {
  if (json) console.log(JSON.stringify(value, null, 2));
  else if (value && typeof value === 'object' && 'shim' in value) {
    const installed = value as { channel: string; package_version: string; service_shim: string; shim: string };
    console.log(`Installed Lineage ${installed.channel} ${installed.package_version}`);
    console.log(`Launcher: ${installed.shim}`);
    console.log(`Service manager: ${installed.service_shim}`);
  } else console.log(JSON.stringify(value, null, 2));
}

export function runLineageChannel(args = process.argv.slice(2)): void {
  const json = args.includes('--json');
  try {
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
      console.log(usage());
    } else if (args.includes('--version') || args.includes('-v')) {
      console.log(packageInfo.version);
    } else if (args[0] === 'install') {
      print(install(parseChannel(args[1] || readOption(args, '--channel')), args.slice(2)), json);
    } else if (args[0] === 'status') {
      print(status(args.slice(1)), json);
    } else {
      throw new Error(`Unknown lineage-channel command: ${args[0]}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) console.error(JSON.stringify({ error: message, ok: false }, null, 2));
    else console.error(`lineage-channel: ${message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) runLineageChannel();
