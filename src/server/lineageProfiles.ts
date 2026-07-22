import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  copyFileSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  type Stats,
  writeFileSync,
} from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  lineageProfileAssetsCloneReceiptSchemaVersion,
  lineageProfileCloneReceiptSchemaVersion,
  lineageProfileDoctorSchemaVersion,
  lineageProfileInitSchemaVersion,
  lineageProfileRuntimeRepinReceiptSchemaVersion,
  lineageProfileSchemaVersion,
  type LineageProfileBindResult,
  type LineageProfileAssetsCloneResult,
  type LineageProfileCloneResult,
  type LineageProfileDoctorCheck,
  type LineageProfileDoctorResult,
  type LineageProfileEnvironment,
  type LineageProfileIdentity,
  type LineageProfileInitResult,
  type LineageProfileManifest,
  type LineageProfileRuntimeRepinResult,
  type ResolvedLineageProfile,
} from '../shared/lineageProfileTypes';
import type { LineageRuntimeChannel, LineageRuntimeCodeIdentity, LineageRuntimeInfo } from '../shared/runtimeInfoTypes';
import type { DatabaseSync } from './assetLineageDb';

const require = createRequire(import.meta.url);
const profileIdPattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function lineageDataRoot(): string {
  if (process.env.LINEAGE_HOME) return resolve(process.env.LINEAGE_HOME);
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Lineage');
  if (platform() === 'win32') return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Lineage');
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'lineage');
}

function lineageProfileRoot(): string {
  return resolve(process.env.LINEAGE_PROFILE_ROOT || join(lineageDataRoot(), 'profiles'));
}

function environmentChannel(environment: LineageProfileEnvironment): LineageRuntimeChannel {
  if (environment === 'production') return 'stable';
  if (environment === 'preview') return 'preview';
  return 'dev';
}

function channelEnvironment(channel: LineageRuntimeChannel): LineageProfileEnvironment {
  if (channel === 'stable') return 'production';
  if (channel === 'preview') return 'preview';
  return 'development';
}

function profileManifestPath(selector: string): { manifestPath: string; namedProfileId?: string } {
  const value = selector.trim();
  if (!value) throw new Error('Profile selector must not be empty');
  const looksLikePath = isAbsolute(value) || value.includes('/') || value.includes('\\') || value.endsWith('.json');
  if (looksLikePath) return { manifestPath: resolve(value) };
  if (!profileIdPattern.test(value)) throw new Error(`Invalid profile ID: ${value}`);
  return { manifestPath: join(lineageProfileRoot(), value, 'profile.json'), namedProfileId: value };
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Profile manifest requires a non-empty ${key}`);
  return value.trim();
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Profile manifest ${key} must be a non-empty string`);
  return value.trim();
}

function validateEnvironment(value: string): LineageProfileEnvironment {
  if (value === 'production' || value === 'preview' || value === 'development') return value;
  throw new Error(`Invalid profile environment: ${value}`);
}

function validateChannel(value: unknown): LineageRuntimeChannel | undefined {
  if (value === undefined) return undefined;
  if (value === 'stable' || value === 'preview' || value === 'dev') return value;
  throw new Error(`Invalid expected runtime channel: ${String(value)}`);
}

function validateCodeOrigin(value: unknown): 'checkout' | 'package' | undefined {
  if (value === undefined) return undefined;
  if (value === 'checkout' || value === 'package') return value;
  throw new Error(`Invalid expected runtime code_origin: ${String(value)}`);
}

function validateFingerprint(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`Profile ${field} must be a 64-character SHA-256 fingerprint`);
  return value.toLowerCase();
}

function resolveManifestPath(manifestPath: string, value: string): string {
  return resolve(dirname(manifestPath), value);
}

function validateServiceOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid profile service_origin: ${value}`);
  }
  if (parsed.protocol !== 'http:') throw new Error('Profile service_origin must use http for the local Lineage service');
  if (!parsed.port) throw new Error('Profile service_origin must include an explicit port');
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Profile service_origin must contain only scheme, host, and port');
  }
  return parsed.origin;
}

export function resolveLineageProfile(selector: string): ResolvedLineageProfile {
  const { manifestPath, namedProfileId } = profileManifestPath(selector);
  if (!existsSync(manifestPath)) throw new Error(`Profile manifest does not exist: ${manifestPath}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not parse profile manifest ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Profile manifest must be a JSON object');
  const record = raw as Record<string, unknown>;
  const schemaVersion = requiredString(record, 'schema_version');
  if (schemaVersion !== lineageProfileSchemaVersion) throw new Error(`Unsupported profile schema_version: ${schemaVersion}`);
  const profileId = requiredString(record, 'profile_id');
  if (!profileIdPattern.test(profileId)) throw new Error(`Invalid profile ID: ${profileId}`);
  if (namedProfileId && namedProfileId !== profileId) {
    throw new Error(`Named profile ${namedProfileId} does not match immutable manifest profile_id ${profileId}`);
  }
  const expectedRaw = record.expected_runtime;
  if (expectedRaw !== undefined && (!expectedRaw || typeof expectedRaw !== 'object' || Array.isArray(expectedRaw))) {
    throw new Error('Profile expected_runtime must be an object');
  }
  const expected = expectedRaw as Record<string, unknown> | undefined;
  const expectedGitSha = expected ? optionalString(expected, 'git_sha') : undefined;
  const expectedVersion = expected ? optionalString(expected, 'version') : undefined;
  const expectedCodeFingerprint = validateFingerprint(expected ? optionalString(expected, 'code_fingerprint') : undefined, 'expected_runtime.code_fingerprint');
  const expectedCodeOrigin = validateCodeOrigin(expected?.code_origin);
  const migrationsRaw = record.required_schema_migrations;
  if (migrationsRaw !== undefined && (!Array.isArray(migrationsRaw) || migrationsRaw.some(value => typeof value !== 'string' || !value.trim()))) {
    throw new Error('Profile required_schema_migrations must be an array of non-empty strings');
  }
  const environment = validateEnvironment(requiredString(record, 'environment'));
  const expectedChannel = validateChannel(expected?.channel);
  if (expectedChannel && expectedChannel !== environmentChannel(environment)) {
    throw new Error(`Profile environment ${environment} conflicts with expected runtime channel ${expectedChannel}`);
  }
  const manifest: LineageProfileManifest = {
    asset_root: resolveManifestPath(manifestPath, requiredString(record, 'asset_root')),
    database_path: resolveManifestPath(manifestPath, requiredString(record, 'database_path')),
    environment,
    ...(expected ? {
      expected_runtime: {
        ...(expectedChannel ? { channel: expectedChannel } : {}),
        ...(expectedCodeFingerprint ? { code_fingerprint: expectedCodeFingerprint } : {}),
        ...(expectedCodeOrigin ? { code_origin: expectedCodeOrigin } : {}),
        ...(expectedGitSha ? { git_sha: expectedGitSha } : {}),
        ...(expectedVersion ? { version: expectedVersion } : {}),
      },
    } : {}),
    profile_id: profileId,
    ...(migrationsRaw ? { required_schema_migrations: (migrationsRaw as string[]).map(value => value.trim()) } : {}),
    schema_version: lineageProfileSchemaVersion,
    service_origin: validateServiceOrigin(requiredString(record, 'service_origin')),
  };
  return { ...manifest, manifest_path: manifestPath, profile_fingerprint: lineageProfileFingerprint(manifest) };
}

export function lineageProfileFingerprint(profile: LineageProfileManifest): string {
  return createHash('sha256').update(JSON.stringify({
    asset_root: resolve(profile.asset_root),
    database_path: resolve(profile.database_path),
    environment: profile.environment,
    profile_id: profile.profile_id,
    schema_version: profile.schema_version,
    service_origin: profile.service_origin,
  })).digest('hex');
}

type ProfileRuntime = {
  channel: LineageRuntimeChannel;
  code?: LineageRuntimeCodeIdentity;
  gitSha?: string;
  version: string;
};

type ProfileInitializationLease = (
  profile: ResolvedLineageProfile,
  initialize: () => LineageProfileIdentity,
) => LineageProfileIdentity;

export function initializeLineageProfile(
  profileId: string,
  serviceOrigin: string,
  runtime: ProfileRuntime,
  confirmWrite: boolean,
  withWriterLease: ProfileInitializationLease,
): LineageProfileInitResult {
  if (!confirmWrite) throw new Error('Profile init requires --confirm-write');
  if (!profileIdPattern.test(profileId)) throw new Error(`Invalid profile ID: ${profileId}`);
  if (!runtime.code?.verified) throw new Error('Profile init requires a verified runtime code identity');
  if (runtime.code.origin !== 'checkout' && runtime.code.origin !== 'package') {
    throw new Error(`Profile init requires checkout or package code, not ${runtime.code.origin}`);
  }
  if (!runtime.code.fingerprint || !/^[a-f0-9]{64}$/i.test(runtime.code.fingerprint)) {
    throw new Error('Profile init requires a valid executing code fingerprint');
  }
  const validatedServiceOrigin = validateServiceOrigin(serviceOrigin);

  const root = lineageProfileRoot();
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const profileDirectory = join(root, profileId);
  try {
    mkdirSync(profileDirectory, { mode: 0o700 });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      throw new Error(`Profile already exists or requires manual inspection: ${profileDirectory}`, { cause: error });
    }
    throw error;
  }

  const manifestPath = join(profileDirectory, 'profile.json');
  const databasePath = join(profileDirectory, 'lineage.sqlite');
  const assetRoot = join(profileDirectory, 'media');
  const environment = channelEnvironment(runtime.channel);
  const manifest: LineageProfileManifest = {
    asset_root: assetRoot,
    database_path: databasePath,
    environment,
    expected_runtime: {
      channel: runtime.channel,
      code_fingerprint: runtime.code.fingerprint.toLowerCase(),
      code_origin: runtime.code.origin,
    },
    profile_id: profileId,
    schema_version: lineageProfileSchemaVersion,
    service_origin: validatedServiceOrigin,
  };
  const profile: ResolvedLineageProfile = {
    ...manifest,
    manifest_path: manifestPath,
    profile_fingerprint: lineageProfileFingerprint(manifest),
  };

  try {
    assertProfileChannel(profile, runtime.channel);
    assertProfileRuntimePin(profile, runtime);
    const identity = withWriterLease(profile, () => {
      mkdirSync(assetRoot, { mode: 0o700 });
      const databaseFd = openSync(databasePath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR, 0o600);
      closeSync(databaseFd);
      const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
      const database = new DatabaseSync(databasePath);
      let boundIdentity: LineageProfileIdentity;
      try {
        boundIdentity = bindOpenDatabase(database, profile, false);
      } finally {
        database.close();
      }
      const manifestPayload = {
        asset_root: './media',
        database_path: './lineage.sqlite',
        environment: profile.environment,
        expected_runtime: profile.expected_runtime,
        profile_id: profile.profile_id,
        schema_version: profile.schema_version,
        service_origin: profile.service_origin,
      };
      writeFileSync(manifestPath, `${JSON.stringify(manifestPayload, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      const manifestFd = openSync(manifestPath, 'r');
      try { fsyncSync(manifestFd); } finally { closeSync(manifestFd); }
      const directoryFd = openSync(profileDirectory, 'r');
      try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
      const published = resolveLineageProfile(profileId);
      if (published.profile_fingerprint !== profile.profile_fingerprint) {
        throw new Error('Initialized profile fingerprint does not match its published manifest');
      }
      return boundIdentity;
    });
    return {
      asset_root: profile.asset_root,
      database_path: profile.database_path,
      environment: profile.environment,
      identity,
      manifest_path: profile.manifest_path,
      profile_fingerprint: profile.profile_fingerprint,
      profile_id: profile.profile_id,
      runtime: {
        channel: runtime.channel,
        code_fingerprint: runtime.code.fingerprint,
        code_origin: runtime.code.origin,
      },
      schema_version: lineageProfileInitSchemaVersion,
      service_origin: profile.service_origin,
    };
  } catch (error) {
    rmSync(profileDirectory, { force: true, recursive: true });
    throw error;
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertOwnerOnlyPath(path: string, kind: 'manifest' | 'profile directory'): Stats {
  const stats = lstatSync(path);
  const expectedType = kind === 'manifest' ? stats.isFile() : stats.isDirectory();
  if (!expectedType || stats.isSymbolicLink()) throw new Error(`Profile ${kind} must be a nonsymlink ${kind === 'manifest' ? 'regular file' : 'directory'}: ${path}`);
  if ((stats.mode & 0o077) !== 0) throw new Error(`Profile ${kind} must be owner-only: ${path}`);
  if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) throw new Error(`Profile ${kind} must be owned by the current user: ${path}`);
  return stats;
}

function runtimeRepinInvariant(profile: ResolvedLineageProfile): string {
  return JSON.stringify({
    asset_root: profile.asset_root,
    database_path: profile.database_path,
    environment: profile.environment,
    profile_fingerprint: profile.profile_fingerprint,
    profile_id: profile.profile_id,
    required_schema_migrations: profile.required_schema_migrations || [],
    schema_version: profile.schema_version,
    service_origin: profile.service_origin,
  });
}

function sameFileIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

export function repinLineageDevelopmentProfileRuntime(
  selector: string,
  checkoutRoot: string,
  runtime: ProfileRuntime,
  confirmWrite: boolean,
): LineageProfileRuntimeRepinResult {
  if (!confirmWrite) throw new Error('Profile runtime repin requires --confirm-write');
  if (runtime.channel !== 'dev') throw new Error(`Profile runtime repin requires dev code, not ${runtime.channel}`);
  if (!runtime.code?.verified) throw new Error('Profile runtime repin requires a verified checkout runtime');
  if (runtime.code.origin !== 'checkout') throw new Error(`Profile runtime repin requires checkout code, not ${runtime.code.origin}`);
  if (!runtime.code.fingerprint || !/^[a-f0-9]{64}$/i.test(runtime.code.fingerprint)) {
    throw new Error('Profile runtime repin requires a valid executing code fingerprint');
  }
  if (!checkoutRoot.trim()) throw new Error('Profile runtime repin requires --checkout-root');
  const intendedRoot = realpathSync(resolve(checkoutRoot));
  if (!statSync(intendedRoot).isDirectory()) throw new Error(`Profile runtime repin checkout root is not a directory: ${intendedRoot}`);
  const executingRoot = realpathSync(runtime.code.root);
  if (intendedRoot !== executingRoot) {
    throw new Error(`Profile runtime repin checkout root ${intendedRoot} does not match executing code root ${executingRoot}`);
  }

  const profile = resolveLineageProfile(selector);
  if (profile.environment !== 'development') throw new Error(`Profile runtime repin requires a development profile, not ${profile.environment}`);
  if (profile.expected_runtime?.channel !== 'dev') throw new Error('Development profile runtime repin requires an existing dev channel pin');
  if (profile.expected_runtime.code_origin !== 'checkout') throw new Error('Development profile runtime repin requires an existing checkout origin pin');
  if (!profile.expected_runtime.code_fingerprint) throw new Error('Development profile runtime repin requires an existing code fingerprint pin');

  const manifestPath = profile.manifest_path;
  assertOwnerOnlyPath(dirname(manifestPath), 'profile directory');
  const beforeStats = assertOwnerOnlyPath(manifestPath, 'manifest');
  const beforeText = readFileSync(manifestPath, 'utf8');
  const beforeHash = sha256(beforeText);
  let raw: unknown;
  try {
    raw = JSON.parse(beforeText);
  } catch (error) {
    throw new Error(`Could not parse profile manifest ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Profile manifest must be a JSON object');
  const previousFingerprint = profile.expected_runtime.code_fingerprint;
  const nextExpectedRuntime = {
    channel: 'dev' as const,
    code_fingerprint: runtime.code.fingerprint,
    code_origin: 'checkout' as const,
    ...(runtime.gitSha ? { git_sha: runtime.gitSha } : {}),
    version: runtime.version,
  };
  const updated = { ...(raw as Record<string, unknown>), expected_runtime: nextExpectedRuntime };
  const afterText = `${JSON.stringify(updated, null, 2)}\n`;
  const afterHash = sha256(afterText);
  const result: LineageProfileRuntimeRepinResult = {
    changed: beforeText !== afterText,
    checkout_root: intendedRoot,
    manifest_after_sha256: afterHash,
    manifest_before_sha256: beforeHash,
    manifest_path: manifestPath,
    new_code_fingerprint: runtime.code.fingerprint,
    previous_code_fingerprint: previousFingerprint,
    profile_fingerprint: profile.profile_fingerprint,
    profile_id: profile.profile_id,
    schema_version: lineageProfileRuntimeRepinReceiptSchemaVersion,
  };
  if (!result.changed) return result;

  const temporaryPath = join(dirname(manifestPath), `.profile.runtime-repin-${randomUUID()}.tmp`);
  let temporaryExists = false;
  try {
    writeFileSync(temporaryPath, afterText, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    temporaryExists = true;
    chmodSync(temporaryPath, 0o600);
    const temporaryFd = openSync(temporaryPath, 'r');
    try { fsyncSync(temporaryFd); } finally { closeSync(temporaryFd); }
    const preparedReplacement = resolveLineageProfile(temporaryPath);
    if (runtimeRepinInvariant(preparedReplacement) !== runtimeRepinInvariant(profile)) {
      throw new Error('Profile runtime repin would change immutable profile routing identity');
    }

    const currentStats = assertOwnerOnlyPath(manifestPath, 'manifest');
    const currentText = readFileSync(manifestPath, 'utf8');
    if (!sameFileIdentity(beforeStats, currentStats) || sha256(currentText) !== beforeHash) {
      throw new Error('Profile manifest changed while runtime repin was being prepared; refusing replacement');
    }
    renameSync(temporaryPath, manifestPath);
    temporaryExists = false;
    chmodSync(manifestPath, 0o600);
    const directoryFd = openSync(dirname(manifestPath), 'r');
    try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }

    const replacement = resolveLineageProfile(manifestPath);
    if (runtimeRepinInvariant(replacement) !== runtimeRepinInvariant(profile)) {
      throw new Error('Profile runtime repin changed immutable profile routing identity');
    }
    if (readFileSync(manifestPath, 'utf8') !== afterText) throw new Error('Profile runtime repin replacement bytes do not match the prepared manifest');
    return result;
  } finally {
    if (temporaryExists) rmSync(temporaryPath, { force: true });
  }
}

type ProfileAssetReferenceKind = 'root' | 'scratch';

interface ProfileAssetReference {
  kind: ProfileAssetReferenceKind;
  value: string;
}

function assertProfileRuntimePin(profile: ResolvedLineageProfile, runtime?: ProfileRuntime): void {
  if (!profile.expected_runtime?.code_fingerprint || !profile.expected_runtime.code_origin) {
    throw new Error(`Profile ${profile.profile_id} must pin expected_runtime.code_fingerprint and expected_runtime.code_origin before binding or writing`);
  }
  if (!runtime?.code?.verified) {
    throw new Error(`Profile ${profile.profile_id} requires a verified runtime code identity before binding or writing`);
  }
  if (runtime.code.fingerprint !== profile.expected_runtime.code_fingerprint) {
    throw new Error(`Profile ${profile.profile_id} expects code fingerprint ${profile.expected_runtime.code_fingerprint}, found ${runtime.code.fingerprint}`);
  }
  if (runtime.code.origin !== profile.expected_runtime.code_origin) {
    throw new Error(`Profile ${profile.profile_id} expects code origin ${profile.expected_runtime.code_origin}, found ${runtime.code.origin}`);
  }
}

export function assertProfileChannel(profile: ResolvedLineageProfile, channel: LineageRuntimeChannel): void {
  const requiredChannel = environmentChannel(profile.environment);
  if (channel === requiredChannel) return;
  if (profile.environment === 'production') {
    throw new Error(`Refusing to open production profile ${profile.profile_id} from ${channel} code; use the stable channel`);
  }
  throw new Error(`Profile ${profile.profile_id} requires the ${requiredChannel} channel, not ${channel}`);
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(database.prepare("select name from sqlite_master where type = 'table' and name = ?").get(table));
}

function tableColumns(database: DatabaseSync, table: string): Set<string> {
  if (!tableExists(database, table)) return new Set();
  return new Set((database.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>).map(row => row.name));
}

function inspectDatabase(profile: ResolvedLineageProfile): NonNullable<LineageProfileDoctorResult['database']> {
  const result: NonNullable<LineageProfileDoctorResult['database']> = {
    exists: existsSync(profile.database_path),
    migration_keys: [],
    path: profile.database_path,
  };
  if (!result.exists) return result;
  try {
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const database = new DatabaseSync(profile.database_path, { readOnly: true });
    try {
      if (tableExists(database, 'lineage_profile_identity')) {
        const columns = tableColumns(database, 'lineage_profile_identity');
        const fingerprintExpression = columns.has('profile_fingerprint') ? 'profile_fingerprint' : "'' as profile_fingerprint";
        const rows = database.prepare(`select profile_id, environment, bound_at, ${fingerprintExpression} from lineage_profile_identity`).all() as Array<Record<string, unknown>>;
        if (rows.length === 1) {
          const identity: LineageProfileIdentity = {
            bound_at: typeof rows[0].bound_at === 'string' ? rows[0].bound_at : undefined,
            environment: String(rows[0].environment) as LineageProfileEnvironment,
            profile_fingerprint: typeof rows[0].profile_fingerprint === 'string' ? rows[0].profile_fingerprint : '',
            profile_id: String(rows[0].profile_id),
          };
          result.identity = identity;
        } else {
          result.error = `Expected exactly one lineage_profile_identity row, found ${rows.length}`;
        }
      }
      if (tableExists(database, 'lineage_schema_migrations')) {
        result.migration_keys = (database.prepare('select key from lineage_schema_migrations order by key').all() as Array<{ key: string }>).map(row => row.key);
      }
    } finally {
      database.close();
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  return result;
}

export function doctorLineageProfile(
  selector: string,
  runtime: ProfileRuntime
): LineageProfileDoctorResult {
  const checks: LineageProfileDoctorCheck[] = [];
  const result: LineageProfileDoctorResult = {
    checks,
    ok: false,
    runtime: {
      channel: runtime.channel,
      code_fingerprint: runtime.code?.fingerprint,
      code_origin: runtime.code?.origin,
      code_verified: runtime.code?.verified,
      git_sha: runtime.gitSha,
      version: runtime.version,
    },
    schema_version: lineageProfileDoctorSchemaVersion,
  };
  let profile: ResolvedLineageProfile;
  try {
    profile = resolveLineageProfile(selector);
    result.profile = profile;
    result.manifest_path = profile.manifest_path;
    checks.push({ id: 'manifest', message: `Loaded ${profile.profile_id}`, status: 'pass' });
  } catch (error) {
    checks.push({ id: 'manifest', message: error instanceof Error ? error.message : String(error), status: 'fail' });
    return result;
  }

  try {
    assertProfileChannel(profile, runtime.channel);
    checks.push({ id: 'runtime_channel', message: `${runtime.channel} code matches ${profile.environment}`, status: 'pass' });
  } catch (error) {
    checks.push({ id: 'runtime_channel', message: error instanceof Error ? error.message : String(error), status: 'fail' });
  }
  try {
    assertProfileRuntimePin(profile, runtime);
    checks.push({ id: 'runtime_code', message: `Verified ${runtime.code!.origin} code ${runtime.code!.fingerprint}`, status: 'pass' });
  } catch (error) {
    checks.push({ id: 'runtime_code', message: error instanceof Error ? error.message : String(error), status: 'fail' });
  }
  if (profile.expected_runtime?.version && profile.expected_runtime.version !== runtime.version) {
    checks.push({ id: 'runtime_version', message: `Expected version ${profile.expected_runtime.version}, found ${runtime.version}`, status: 'fail' });
  } else {
    checks.push({ id: 'runtime_version', message: `Runtime version ${runtime.version}`, status: 'pass' });
  }
  if (profile.expected_runtime?.git_sha && profile.expected_runtime.git_sha !== runtime.gitSha) {
    checks.push({ id: 'runtime_git_sha', message: `Expected Git SHA ${profile.expected_runtime.git_sha}, found ${runtime.gitSha || 'unavailable'}`, status: 'fail' });
  } else if (profile.expected_runtime?.git_sha) {
    checks.push({ id: 'runtime_git_sha', message: `Git SHA ${runtime.gitSha}`, status: 'pass' });
  }

  const assetExists = existsSync(profile.asset_root);
  const assetIsDirectory = assetExists && statSync(profile.asset_root).isDirectory();
  result.asset_root = { exists: assetExists, is_directory: assetIsDirectory, path: profile.asset_root };
  checks.push({
    id: 'asset_root',
    message: assetIsDirectory ? `Asset root exists: ${profile.asset_root}` : `Asset root is missing or not a directory: ${profile.asset_root}`,
    status: assetIsDirectory ? 'pass' : 'fail',
  });

  const database = inspectDatabase(profile);
  result.database = database;
  checks.push({
    id: 'database_exists',
    message: database.exists ? `Database exists: ${profile.database_path}` : `Database does not exist: ${profile.database_path}`,
    status: database.exists ? 'pass' : 'fail',
  });
  if (database.error) checks.push({ id: 'database_read', message: database.error, status: 'fail' });
  if (!database.identity) {
    checks.push({ id: 'database_identity', message: 'Database is not bound to a Lineage profile', status: 'fail' });
  } else if (
    database.identity.profile_id !== profile.profile_id
    || database.identity.environment !== profile.environment
    || database.identity.profile_fingerprint !== profile.profile_fingerprint
  ) {
    checks.push({
      id: 'database_identity',
      message: `Database identity ${database.identity.profile_id}/${database.identity.environment}/${database.identity.profile_fingerprint || 'no-fingerprint'} does not match ${profile.profile_id}/${profile.environment}/${profile.profile_fingerprint}`,
      status: 'fail',
    });
  } else {
    checks.push({ id: 'database_identity', message: `Database is bound to ${profile.profile_id}`, status: 'pass' });
  }
  const missingMigrations = (profile.required_schema_migrations || []).filter(key => !database.migration_keys.includes(key));
  checks.push({
    id: 'database_schema',
    message: missingMigrations.length ? `Missing required schema migrations: ${missingMigrations.join(', ')}` : `${database.migration_keys.length} schema migration marker(s) available`,
    status: missingMigrations.length ? 'fail' : 'pass',
  });
  result.ok = checks.every(check => check.status !== 'fail');
  return result;
}

export function runtimeProfileIdentity(channel: LineageRuntimeChannel): {
  bound: boolean;
  environment: LineageProfileEnvironment;
  fingerprint?: string;
  id: string;
  manifest_path?: string;
  service_origin?: string;
  warning?: string;
} {
  const selector = process.env.LINEAGE_PROFILE;
  const id = process.env.LINEAGE_PROFILE_ID;
  const environment = process.env.LINEAGE_PROFILE_ENVIRONMENT as LineageProfileEnvironment | undefined;
  if (selector && id && environment) {
    return {
      bound: true,
      environment,
      fingerprint: process.env.LINEAGE_PROFILE_FINGERPRINT,
      id,
      manifest_path: process.env.LINEAGE_PROFILE_MANIFEST,
      service_origin: process.env.LINEAGE_PROFILE_SERVICE_ORIGIN,
    };
  }
  return {
    bound: false,
    environment: channelEnvironment(channel),
    id: 'legacy-unbound',
    warning: id || environment || process.env.LINEAGE_PROFILE_FINGERPRINT || process.env.LINEAGE_PROFILE_MANIFEST
      ? 'Invalid unbound runtime: derived profile identity was supplied without a resolved LINEAGE_PROFILE selector.'
      : 'Legacy unbound runtime: database and asset paths are not protected by a named profile.',
  };
}

export function assertRuntimeProfileSafety(channel: LineageRuntimeChannel): void {
  const hasDerivedIdentity = Boolean(
    process.env.LINEAGE_PROFILE_ID
    || process.env.LINEAGE_PROFILE_ENVIRONMENT
    || process.env.LINEAGE_PROFILE_FINGERPRINT
    || process.env.LINEAGE_PROFILE_MANIFEST
    || process.env.LINEAGE_PROFILE_SERVICE_ORIGIN
  );
  if (hasDerivedIdentity && !process.env.LINEAGE_PROFILE) {
    throw new Error('Derived Lineage profile identity requires LINEAGE_PROFILE; start through the Lineage CLI with --profile');
  }
  const profile = runtimeProfileIdentity(channel);
  if (profile.bound && profile.environment === 'production' && channel !== 'stable') {
    throw new Error(`Refusing to open production profile ${profile.id} from ${channel} code; use the stable channel`);
  }
}

export function assertUnselectedDatabaseIsUnbound(runtime: LineageRuntimeInfo): void {
  if (!runtime.schema.profile_id) return;
  const environment = runtime.schema.profile_environment || 'unknown';
  throw new Error(
    `Database ${runtime.database.path} is bound to Lineage profile ${runtime.schema.profile_id}/${environment}; select that profile with --profile`
  );
}

export function assertResolvedRuntimeProfileEnvironment(profile: ResolvedLineageProfile): void {
  const serviceUrl = new URL(profile.service_origin);
  const expected = new Map<string, string>([
    ['LINEAGE_PROFILE_ID', profile.profile_id],
    ['LINEAGE_PROFILE_ENVIRONMENT', profile.environment],
    ['LINEAGE_PROFILE_FINGERPRINT', profile.profile_fingerprint],
    ['LINEAGE_PROFILE_MANIFEST', profile.manifest_path],
    ['LINEAGE_PROFILE_SERVICE_ORIGIN', profile.service_origin],
    ['LINEAGE_DB', profile.database_path],
    ['LINEAGE_ASSET_ROOT', profile.asset_root],
    ['HOST', serviceUrl.hostname],
    ['PORT', serviceUrl.port],
  ]);
  const conflicts: string[] = [];
  for (const [key, expectedValue] of expected) {
    const actual = process.env[key];
    const pathValue = key === 'LINEAGE_PROFILE_MANIFEST' || key === 'LINEAGE_DB' || key === 'LINEAGE_ASSET_ROOT';
    const matches = actual && (pathValue ? resolve(actual) === resolve(expectedValue) : actual === expectedValue);
    if (!matches) conflicts.push(`${key}=${actual || '(missing)'}`);
  }
  if (conflicts.length > 0) {
    throw new Error(`Resolved profile environment conflicts with ${profile.profile_id}: ${conflicts.join(', ')}`);
  }
}

function ensureProfileIdentityTable(database: DatabaseSync): void {
  if (!tableExists(database, 'lineage_profile_identity')) {
    database.exec(`
      create table lineage_profile_identity (
        profile_id text primary key,
        environment text not null,
        profile_fingerprint text not null,
        bound_at text not null
      )
    `);
    return;
  }
  const columns = tableColumns(database, 'lineage_profile_identity');
  if (!columns.has('profile_id') || !columns.has('environment') || !columns.has('bound_at')) {
    throw new Error('Existing lineage_profile_identity table has an unsupported shape');
  }
  if (!columns.has('profile_fingerprint')) {
    database.exec("alter table lineage_profile_identity add column profile_fingerprint text not null default ''");
  }
}

function assertRequiredMigrations(database: DatabaseSync, profile: ResolvedLineageProfile): void {
  const required = profile.required_schema_migrations || [];
  if (required.length === 0) return;
  if (!tableExists(database, 'lineage_schema_migrations')) {
    throw new Error(`Database is missing required schema migrations: ${required.join(', ')}`);
  }
  const available = new Set((database.prepare('select key from lineage_schema_migrations').all() as Array<{ key: string }>).map(row => row.key));
  const missing = required.filter(key => !available.has(key));
  if (missing.length > 0) throw new Error(`Database is missing required schema migrations: ${missing.join(', ')}`);
}

function profileIdentity(profile: ResolvedLineageProfile): LineageProfileIdentity {
  return {
    bound_at: new Date().toISOString(),
    environment: profile.environment,
    profile_fingerprint: profile.profile_fingerprint,
    profile_id: profile.profile_id,
  };
}

function bindOpenDatabase(database: DatabaseSync, profile: ResolvedLineageProfile, replace: boolean): LineageProfileIdentity {
  database.exec('begin immediate');
  try {
    ensureProfileIdentityTable(database);
    assertRequiredMigrations(database, profile);
    const rows = database.prepare('select profile_id, environment, profile_fingerprint, bound_at from lineage_profile_identity').all() as unknown as LineageProfileIdentity[];
    if (!replace && rows.length > 0) {
      if (rows.length !== 1) throw new Error(`Expected at most one lineage_profile_identity row, found ${rows.length}`);
      const existing = rows[0];
      const sameBaseIdentity = existing.profile_id === profile.profile_id && existing.environment === profile.environment;
      const migratableLegacyIdentity = sameBaseIdentity && !existing.profile_fingerprint;
      if (!migratableLegacyIdentity && existing.profile_fingerprint !== profile.profile_fingerprint) {
        throw new Error(`Database is already bound to ${existing.profile_id}/${existing.environment}/${existing.profile_fingerprint || 'no-fingerprint'}`);
      }
      if (!migratableLegacyIdentity) {
        database.exec('commit');
        return existing;
      }
    }
    const identity = profileIdentity(profile);
    database.exec('delete from lineage_profile_identity');
    database.prepare('insert into lineage_profile_identity (profile_id, environment, profile_fingerprint, bound_at) values (?, ?, ?, ?)')
      .run(identity.profile_id, identity.environment, identity.profile_fingerprint, identity.bound_at!);
    const integrity = database.prepare('pragma integrity_check').get() as { integrity_check?: string } | undefined;
    if (integrity?.integrity_check !== 'ok') throw new Error(`SQLite integrity check failed: ${integrity?.integrity_check || 'unknown result'}`);
    database.exec('commit');
    return identity;
  } catch (error) {
    try { database.exec('rollback'); } catch { /* best effort */ }
    throw error;
  }
}

export function bindLineageProfileDatabase(
  selector: string,
  runtime: ProfileRuntime,
  confirmWrite: boolean,
): LineageProfileBindResult {
  if (!confirmWrite) throw new Error('Profile bind requires --confirm-write');
  const profile = resolveLineageProfile(selector);
  assertProfileChannel(profile, runtime.channel);
  assertProfileRuntimePin(profile, runtime);
  if (!existsSync(profile.database_path)) throw new Error(`Profile database does not exist: ${profile.database_path}`);
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const database = new DatabaseSync(profile.database_path);
  try {
    const before = inspectDatabase(profile).identity;
    const identity = bindOpenDatabase(database, profile, false);
    return {
      already_bound: Boolean(before?.profile_fingerprint === profile.profile_fingerprint),
      database_path: profile.database_path,
      identity,
      schema_version: 'lineage.profile_bind.v1',
    };
  } finally {
    database.close();
  }
}

export async function cloneLineageProfileDatabase(
  sourceDatabasePath: string,
  targetSelector: string,
  runtime: ProfileRuntime,
  confirmWrite: boolean,
): Promise<LineageProfileCloneResult> {
  if (!confirmWrite) throw new Error('Profile clone requires --confirm-write');
  const profile = resolveLineageProfile(targetSelector);
  assertProfileChannel(profile, runtime.channel);
  assertProfileRuntimePin(profile, runtime);
  if (profile.environment === 'production') throw new Error('Profile clone target must be preview or development, never production');
  const sourcePath = resolve(sourceDatabasePath);
  const targetPath = resolve(profile.database_path);
  if (sourcePath === targetPath) throw new Error('Profile clone source and target database paths must be different');
  if (!existsSync(sourcePath)) throw new Error(`Profile clone source database does not exist: ${sourcePath}`);
  if (existsSync(targetPath)) throw new Error(`Profile clone target database already exists: ${targetPath}`);
  mkdirSync(dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.clone-${randomUUID()}.tmp`;
  const receiptDirectory = join(dirname(profile.manifest_path), 'clone-receipts');
  let targetCreated = false;
  const { DatabaseSync, backup } = require('node:sqlite') as typeof import('node:sqlite');
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    const pagesCopied = await backup(source, temporaryPath);
    chmodSync(temporaryPath, 0o600);
    const cloned = new DatabaseSync(temporaryPath);
    let identity: LineageProfileIdentity;
    try {
      identity = bindOpenDatabase(cloned, profile, true);
    } finally {
      cloned.close();
    }
    // Both paths share a directory. Linking is atomic and fails with EEXIST,
    // unlike rename(), which may silently replace a target created by a racer.
    linkSync(temporaryPath, targetPath);
    targetCreated = true;
    rmSync(temporaryPath, { force: true });
    mkdirSync(receiptDirectory, { recursive: true, mode: 0o700 });
    const receiptPath = join(receiptDirectory, `${Date.now()}-${randomUUID()}.json`);
    const result: LineageProfileCloneResult = {
      database_path: targetPath,
      pages_copied: pagesCopied,
      receipt_path: receiptPath,
      schema_version: lineageProfileCloneReceiptSchemaVersion,
      source_database_path: sourcePath,
      target_identity: identity,
    };
    writeFileSync(receiptPath, `${JSON.stringify({ ...result, created_at: new Date().toISOString() }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return result;
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    if (targetCreated) rmSync(targetPath, { force: true });
    throw error;
  } finally {
    source.close();
  }
}

function pathIsInside(path: string, parent: string): boolean {
  const child = relative(parent, path);
  return child !== '' && !child.startsWith('..') && !isAbsolute(child);
}

function fileSha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function profileAssetReferences(database: DatabaseSync): ProfileAssetReference[] {
  const references: ProfileAssetReference[] = [];
  const addColumn = (table: string, column: string, kind: ProfileAssetReferenceKind) => {
    if (!tableColumns(database, table).has(column)) return;
    const rows = database.prepare(`select ${column} value from ${table} where ${column} is not null and ${column} <> ''`).all() as Array<{ value: string }>;
    for (const row of rows) references.push({ kind, value: row.value });
  };
  addColumn('assets', 'local_path', 'scratch');
  addColumn('asset_attempts', 'file_path', 'scratch');
  addColumn('generation_job_outputs', 'file_path', 'scratch');
  addColumn('asset_ledger_sources', 'local_path', 'scratch');
  addColumn('content_posts', 'source_path', 'root');
  if (tableColumns(database, 'projects').has('id')) {
    const projects = database.prepare("select id from projects where id is not null and id <> ''").all() as Array<{ id: string }>;
    for (const project of projects) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(project.id)) throw new Error('A project ID cannot be mapped safely into the source asset root');
      references.push({ kind: 'root', value: join(project.id, 'assets', 'catalog.json') });
    }
  }
  return references;
}

function resolveProfileAssetReference(sourceRoot: string, reference: ProfileAssetReference): { path: string; relative_path: string } {
  if (reference.value.includes('\0')) throw new Error('A referenced asset path contains a null byte');
  const sourceScratch = join(sourceRoot, '.asset-scratch');
  const base = reference.kind === 'scratch' ? sourceScratch : sourceRoot;
  const value = reference.kind === 'scratch' && reference.value.startsWith('.asset-scratch/')
    ? reference.value.slice('.asset-scratch/'.length)
    : reference.value;
  const candidate = isAbsolute(value) ? resolve(value) : resolve(base, value);
  if (!pathIsInside(candidate, base)) throw new Error('A referenced asset path escapes the declared source asset root');
  return { path: candidate, relative_path: relative(sourceRoot, candidate) };
}

export function cloneLineageProfileAssets(
  sourceAssetRoot: string,
  targetSelector: string,
  runtime: ProfileRuntime,
  confirmWrite: boolean,
): LineageProfileAssetsCloneResult {
  if (!confirmWrite) throw new Error('Profile asset clone requires --confirm-write');
  const profile = resolveLineageProfile(targetSelector);
  assertProfileChannel(profile, runtime.channel);
  assertProfileRuntimePin(profile, runtime);
  if (!existsSync(profile.database_path)) throw new Error(`Profile database does not exist: ${profile.database_path}`);
  const sourceRoot = resolve(sourceAssetRoot);
  const targetRoot = resolve(profile.asset_root);
  if (!existsSync(sourceRoot) || !statSync(sourceRoot).isDirectory()) throw new Error(`Source asset root does not exist: ${sourceRoot}`);
  if (sourceRoot === targetRoot || pathIsInside(targetRoot, sourceRoot) || pathIsInside(sourceRoot, targetRoot)) {
    throw new Error('Source and target asset roots must be disjoint');
  }
  if (pathIsInside(profile.database_path, targetRoot)) throw new Error('Profile database must not be stored inside its asset root');
  if (existsSync(targetRoot)) throw new Error(`Profile asset clone target already exists: ${targetRoot}`);
  const databaseIdentity = inspectDatabase(profile).identity;
  if (databaseIdentity && (
    databaseIdentity.profile_id !== profile.profile_id
    || databaseIdentity.environment !== profile.environment
    || (databaseIdentity.profile_fingerprint && databaseIdentity.profile_fingerprint !== profile.profile_fingerprint)
  )) {
    throw new Error(`Profile database is already bound to ${databaseIdentity.profile_id}/${databaseIdentity.environment}`);
  }

  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const database = new DatabaseSync(profile.database_path, { readOnly: true });
  let references: ProfileAssetReference[];
  try {
    database.exec('begin');
    references = profileAssetReferences(database);
    database.exec('commit');
  } catch (error) {
    try { database.exec('rollback'); } catch { /* best effort */ }
    throw error;
  } finally {
    database.close();
  }

  const sourceRealRoot = realpathSync(sourceRoot);
  const files = new Map<string, string>();
  let missingReferences = 0;
  let duplicateReferences = 0;
  for (const reference of references) {
    const resolved = resolveProfileAssetReference(sourceRoot, reference);
    if (!existsSync(resolved.path)) {
      missingReferences += 1;
      continue;
    }
    const stats = statSync(resolved.path);
    if (!stats.isFile()) {
      missingReferences += 1;
      continue;
    }
    const realSource = realpathSync(resolved.path);
    if (!pathIsInside(realSource, sourceRealRoot)) throw new Error('A referenced asset symlink escapes the declared source asset root');
    const existing = files.get(resolved.relative_path);
    if (existing) {
      if (realpathSync(existing) !== realSource) throw new Error('Two source assets map to the same target path');
      duplicateReferences += 1;
      continue;
    }
    files.set(resolved.relative_path, resolved.path);
  }

  mkdirSync(dirname(targetRoot), { recursive: true, mode: 0o700 });
  mkdirSync(targetRoot, { mode: 0o700 });
  try {
    let bytesCopied = 0;
    const treeHash = createHash('sha256');
    for (const relativePath of [...files.keys()].sort()) {
      const sourcePath = files.get(relativePath)!;
      const destinationPath = join(targetRoot, relativePath);
      mkdirSync(dirname(destinationPath), { recursive: true, mode: 0o700 });
      copyFileSync(sourcePath, destinationPath, fsConstants.COPYFILE_EXCL);
      chmodSync(destinationPath, 0o600);
      const sourceHash = fileSha256(sourcePath);
      const destinationHash = fileSha256(destinationPath);
      if (sourceHash !== destinationHash) throw new Error('A source asset changed or failed checksum verification during clone');
      bytesCopied += statSync(destinationPath).size;
      treeHash.update(relativePath.replaceAll('\\', '/'));
      treeHash.update('\0');
      treeHash.update(destinationHash);
      treeHash.update('\0');
    }
    chmodSync(targetRoot, 0o700);
    const receiptPath = join(targetRoot, '.lineage-profile-assets.json');
    const result: LineageProfileAssetsCloneResult = {
      asset_root: targetRoot,
      bytes_copied: bytesCopied,
      code_fingerprint: runtime.code!.fingerprint,
      database_path: profile.database_path,
      duplicate_references: duplicateReferences,
      files_copied: files.size,
      missing_references: missingReferences,
      profile_fingerprint: profile.profile_fingerprint,
      profile_id: profile.profile_id,
      receipt_path: receiptPath,
      references_discovered: references.length,
      runtime_channel: runtime.channel,
      schema_version: lineageProfileAssetsCloneReceiptSchemaVersion,
      source_asset_root: sourceRoot,
      tree_sha256: treeHash.digest('hex'),
    };
    writeFileSync(receiptPath, `${JSON.stringify({ ...result, created_at: new Date().toISOString() }, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    return result;
  } catch (error) {
    rmSync(targetRoot, { force: true, recursive: true });
    throw error;
  }
}
