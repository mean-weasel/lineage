import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineageDbPath, nowIso, type DatabaseSync } from './assetLineageDb';
import { repoRoot } from './assetCore';
import { runtimeProfileIdentity } from './lineageProfiles';
import {
  lineageRuntimeBuildSchemaVersion,
  lineageRuntimeInstallSchemaVersion,
  type LineageRuntimeBuildIdentity,
  type LineageRuntimeChannel,
  type LineageRuntimeCodeIdentity,
  type LineageRuntimeInfo,
  type LineageRuntimeInstallReceipt,
} from '../shared/runtimeInfoTypes';

const require = createRequire(import.meta.url);
const processStartedAt = new Date().toISOString();

function isLineagePackageRoot(root: string): boolean {
  try {
    const info = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: string };
    return info.name === '@mean-weasel/lineage';
  } catch {
    return false;
  }
}

function executingCodeRoot(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(moduleDirectory, '../..'), resolve(moduleDirectory, '..')];
  const root = candidates.find(isLineagePackageRoot);
  if (!root) throw new Error(`Unable to derive Lineage code root from executing module ${fileURLToPath(import.meta.url)}`);
  return canonicalRoot(root);
}

const codeRoot = executingCodeRoot();

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalRoot(root: string): string {
  try {
    return realpathSync(root);
  } catch {
    return resolve(root);
  }
}

function packageInfo(root = codeRoot): { name: string; version: string } {
  try {
    const info = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: string; version?: string };
    return { name: info.name || '@mean-weasel/lineage', version: info.version || '0.0.0' };
  } catch {
    return { name: '@mean-weasel/lineage', version: '0.0.0' };
  }
}

export function normalizeRuntimeChannel(value?: string): LineageRuntimeChannel {
  if (value === 'stable' || value === 'preview' || value === 'dev') return value;
  if (value === 'production') return 'stable';
  if (value === 'next') return 'preview';
  if (value === 'development') return 'dev';
  return process.env.NODE_ENV === 'production' ? 'stable' : 'dev';
}

function git(root: string, args: string[]): string | undefined {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return result.status === 0 ? result.stdout : undefined;
}

function untrackedFingerprint(root: string, status: string): string {
  const hash = createHash('sha256');
  hash.update(status);
  const listed = git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (listed === undefined) return hash.digest('hex');
  for (const relativePath of listed.split('\0').filter(Boolean).sort()) {
    hash.update('\0');
    hash.update(relativePath);
    const path = join(root, relativePath);
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) hash.update(readlinkSync(path));
      else if (stat.isFile()) hash.update(readFileSync(path));
      else hash.update(`[${stat.mode}:${stat.size}]`);
    } catch (error) {
      hash.update(`[unreadable:${error instanceof Error ? error.message : String(error)}]`);
    }
  }
  return hash.digest('hex');
}

function checkoutCodeIdentity(root: string, channel: LineageRuntimeChannel, version: string): LineageRuntimeCodeIdentity {
  const errors: string[] = [];
  const gitRootRaw = git(root, ['rev-parse', '--show-toplevel'])?.trim();
  const gitSha = git(root, ['rev-parse', 'HEAD'])?.trim();
  const status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const diff = git(root, ['diff', '--binary', 'HEAD', '--']);
  const canonicalGitRoot = gitRootRaw ? canonicalRoot(gitRootRaw) : undefined;
  if (!canonicalGitRoot || canonicalGitRoot !== root) errors.push('Code root is not the canonical root of a Git checkout/worktree');
  if (!gitSha || !/^[a-f0-9]{40}$/i.test(gitSha)) errors.push('Checkout Git revision is unavailable');
  if (status === undefined || diff === undefined) errors.push('Checkout dirty state could not be inspected');
  if (channel !== 'dev') errors.push(`Checkout code may run only as dev, not ${channel}`);
  const dirty = Boolean(status);
  const sourceFingerprint = sha256(`${gitSha || 'unknown'}\0${sha256(diff || '')}\0${untrackedFingerprint(root, status || '')}`);
  return {
    channel,
    dirty,
    errors,
    fingerprint: sha256(JSON.stringify({ channel, dirty, git_sha: gitSha, origin: 'checkout', root, source_fingerprint: sourceFingerprint, version })),
    git_sha: gitSha,
    origin: 'checkout',
    package_version: version,
    root,
    source_fingerprint: sourceFingerprint,
    verified: errors.length === 0,
  };
}

function buildFingerprint(build: Omit<LineageRuntimeBuildIdentity, 'build_fingerprint'>): string {
  return sha256(JSON.stringify({
    package_name: build.package_name,
    package_version: build.package_version,
    schema_version: build.schema_version,
    source_dirty: build.source_dirty,
    source_fingerprint: build.source_fingerprint,
    source_git_sha: build.source_git_sha,
  }));
}

function readBuildIdentity(root: string, errors: string[]): LineageRuntimeBuildIdentity | undefined {
  const path = join(root, 'dist', 'runtime-build.json');
  let build: LineageRuntimeBuildIdentity;
  try {
    build = JSON.parse(readFileSync(path, 'utf8')) as LineageRuntimeBuildIdentity;
  } catch (error) {
    errors.push(`Embedded build identity is missing or unreadable at ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
  if (build.schema_version !== lineageRuntimeBuildSchemaVersion) errors.push(`Unsupported build identity schema: ${String(build.schema_version)}`);
  if (!/^[a-f0-9]{40}$/i.test(build.source_git_sha || '')) errors.push('Embedded build Git revision is invalid');
  if (!/^[a-f0-9]{64}$/i.test(build.source_fingerprint || '')) errors.push('Embedded source fingerprint is invalid');
  const expected = buildFingerprint(build);
  if (build.build_fingerprint !== expected) errors.push('Embedded build fingerprint does not match its contents');
  return build;
}

function readInstallReceipt(path: string | undefined, errors: string[]): (LineageRuntimeInstallReceipt & { receipt_path: string }) | undefined {
  if (!path) {
    errors.push('Packaged runtime was not launched through a channel install receipt');
    return undefined;
  }
  let receipt: LineageRuntimeInstallReceipt;
  const receiptPath = resolve(path);
  try {
    receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as LineageRuntimeInstallReceipt;
  } catch (error) {
    errors.push(`Runtime install receipt is missing or unreadable at ${receiptPath}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
  if (receipt.schema_version !== lineageRuntimeInstallSchemaVersion) errors.push(`Unsupported runtime install receipt schema: ${String(receipt.schema_version)}`);
  if (!isAbsolute(receipt.package_root || '')) errors.push('Runtime install receipt package_root must be absolute');
  if (!receipt.package_integrity?.startsWith('sha512-')) errors.push('Runtime install receipt package integrity is invalid');
  if (receipt.package_source !== 'registry' && receipt.package_source !== 'local') errors.push('Runtime install receipt package source is invalid');
  if (typeof receipt.package_spec !== 'string' || !receipt.package_spec) errors.push('Runtime install receipt package spec is invalid');
  if (!/^[a-f0-9]{64}$/i.test(receipt.package_tree_sha256 || '')) errors.push('Runtime install receipt package tree hash is invalid');
  if (Number.isNaN(Date.parse(receipt.installed_at))) errors.push('Runtime install receipt timestamp is invalid');
  return { ...receipt, receipt_path: receiptPath };
}

export function lineagePackageTreeSha256(root: string): string {
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

function packageCodeIdentity(
  root: string,
  channel: LineageRuntimeChannel,
  info: { name: string; version: string },
  receiptPath?: string,
): LineageRuntimeCodeIdentity {
  const errors: string[] = [];
  const build = readBuildIdentity(root, errors);
  const install = readInstallReceipt(receiptPath, errors);
  if (channel === 'dev') errors.push('Published package code cannot run as dev; use a Git checkout/worktree');
  if (build?.package_name !== info.name || build?.package_version !== info.version) {
    errors.push('Embedded build package identity does not match package.json');
  }
  if (build?.source_dirty) errors.push('Stable and preview package installs require a clean-source build');
  if (install) {
    if (install.channel !== channel) errors.push(`Install receipt channel ${install.channel} does not match requested ${channel}`);
    if (canonicalRoot(install.package_root) !== root) errors.push('Install receipt package root does not match the executing package root');
    if (install.package_name !== info.name || install.package_version !== info.version) errors.push('Install receipt package identity does not match package.json');
    if (build && install.build_fingerprint !== build.build_fingerprint) errors.push('Install receipt build fingerprint does not match the embedded build');
    try {
      if (lineagePackageTreeSha256(root) !== install.package_tree_sha256) errors.push('Installed package tree does not match the channel install receipt');
    } catch (error) {
      errors.push(`Installed package tree could not be verified: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const gitSha = build?.source_git_sha;
  const sourceFingerprint = build?.source_fingerprint;
  return {
    build,
    channel,
    dirty: build?.source_dirty,
    errors,
    fingerprint: sha256(JSON.stringify({
      build_fingerprint: build?.build_fingerprint,
      channel,
      install_integrity: install?.package_integrity,
      origin: 'package',
      root,
      version: info.version,
    })),
    git_sha: gitSha,
    install,
    origin: 'package',
    package_version: info.version,
    root,
    source_fingerprint: sourceFingerprint,
    verified: errors.length === 0,
  };
}

export function getLineageCodeIdentity(
  channel: LineageRuntimeChannel,
  options: { receiptPath?: string; root?: string } = {},
): LineageRuntimeCodeIdentity {
  const root = canonicalRoot(options.root || codeRoot);
  const info = packageInfo(root);
  if (existsSync(join(root, '.git'))) return checkoutCodeIdentity(root, channel, info.version);
  if (existsSync(join(root, 'package.json'))) {
    return packageCodeIdentity(root, channel, info, options.receiptPath ?? process.env.LINEAGE_RUNTIME_RECEIPT);
  }
  const errors = [`Code root has neither checkout metadata nor package.json: ${root}`];
  return {
    channel,
    errors,
    fingerprint: sha256(JSON.stringify({ channel, origin: 'unknown', root, version: info.version })),
    origin: 'unknown',
    package_version: info.version,
    root,
    verified: false,
  };
}

export function assertLineageCodeOrigin(channel: LineageRuntimeChannel): LineageRuntimeCodeIdentity {
  const identity = getLineageCodeIdentity(channel);
  if (!identity.verified) {
    const migration = channel === 'dev'
      ? 'Run dev from a Git checkout with npm run lineage:dev -- <command>.'
      : `Install and launch an isolated ${channel} runtime with lineage-channel install ${channel}.`;
    throw new Error(`Unverified ${channel} code origin: ${identity.errors.join('; ')}. ${migration}`);
  }
  return identity;
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(database.prepare("select name from sqlite_master where type = 'table' and name = ?").get(table));
}

function tableCount(database: DatabaseSync, table: string): number | undefined {
  if (!tableExists(database, table)) return undefined;
  const row = database.prepare(`select count(*) count from ${table}`).get() as { count?: number } | undefined;
  return typeof row?.count === 'number' ? row.count : undefined;
}

function migrationKeys(database: DatabaseSync): string[] {
  if (!tableExists(database, 'lineage_schema_migrations')) return [];
  return (database.prepare('select key from lineage_schema_migrations order by key').all() as Array<{ key: string }>).map(row => row.key);
}

export function getLineageRuntimeInfo(options: { channel?: string; code?: LineageRuntimeCodeIdentity; dbPath?: string } = {}): LineageRuntimeInfo {
  const info = packageInfo();
  const dbPath = options.dbPath || lineageDbPath();
  const channel = normalizeRuntimeChannel(options.channel || process.env.LINEAGE_CHANNEL || process.env.LINEAGE_RELEASE_CHANNEL);
  const code = options.code || getLineageCodeIdentity(channel);
  const databaseInfo: LineageRuntimeInfo['database'] = { exists: existsSync(dbPath), path: dbPath };
  const schema: LineageRuntimeInfo['schema'] = { migration_keys: [] };

  if (databaseInfo.exists) {
    try {
      const stat = statSync(dbPath);
      databaseInfo.modified_at = stat.mtime.toISOString();
      databaseInfo.size_bytes = stat.size;
      const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
      const database = new DatabaseSync(dbPath, { readOnly: true });
      try {
        databaseInfo.projects = tableCount(database, 'projects');
        databaseInfo.workspaces = tableCount(database, 'lineage_workspaces');
        schema.migration_keys = migrationKeys(database);
        if (tableExists(database, 'lineage_profile_identity')) {
          const columns = new Set((database.prepare('pragma table_info(lineage_profile_identity)').all() as Array<{ name: string }>).map(row => row.name));
          const fingerprintExpression = columns.has('profile_fingerprint') ? 'profile_fingerprint' : "null as profile_fingerprint";
          const rows = database.prepare(`select profile_id, environment, ${fingerprintExpression} from lineage_profile_identity`).all() as Array<{
            environment: LineageRuntimeInfo['profile']['environment'];
            profile_fingerprint?: string;
            profile_id: string;
          }>;
          if (rows.length === 1) {
            schema.profile_id = rows[0].profile_id;
            schema.profile_environment = rows[0].environment;
            if (rows[0].profile_fingerprint) schema.profile_fingerprint = rows[0].profile_fingerprint;
          }
        }
      } finally {
        database.close();
      }
    } catch (error) {
      databaseInfo.error = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    asset_root: repoRoot,
    channel,
    code,
    database: databaseInfo,
    fetchedAt: nowIso(),
    git_sha: code.git_sha,
    node_env: process.env.NODE_ENV,
    package_name: info.name,
    profile: runtimeProfileIdentity(channel),
    schema,
    service: {
      instance_id: process.env.LINEAGE_SERVICE_INSTANCE_ID,
      launcher_pid: process.env.LINEAGE_LAUNCHER_PID ? Number(process.env.LINEAGE_LAUNCHER_PID) : undefined,
      pid: process.pid,
      started_at: processStartedAt,
    },
    version: info.version,
  };
}
