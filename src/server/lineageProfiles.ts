import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  lineageProfileDoctorSchemaVersion,
  lineageProfileSchemaVersion,
  type LineageProfileDoctorCheck,
  type LineageProfileDoctorResult,
  type LineageProfileEnvironment,
  type LineageProfileIdentity,
  type LineageProfileManifest,
  type ResolvedLineageProfile,
} from '../shared/lineageProfileTypes';
import type { LineageRuntimeChannel, LineageRuntimeInfo } from '../shared/runtimeInfoTypes';
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
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const isLocal = hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(hostname);
  if (!isLocal) throw new Error('Profile service_origin must use a loopback or localhost host');
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
        ...(expectedGitSha ? { git_sha: expectedGitSha } : {}),
        ...(expectedVersion ? { version: expectedVersion } : {}),
      },
    } : {}),
    profile_id: profileId,
    ...(migrationsRaw ? { required_schema_migrations: (migrationsRaw as string[]).map(value => value.trim()) } : {}),
    schema_version: lineageProfileSchemaVersion,
    service_origin: validateServiceOrigin(requiredString(record, 'service_origin')),
  };
  return { ...manifest, manifest_path: manifestPath };
}

export interface LineageProfileBindResult {
  already_bound?: true;
  bound_at?: string;
  database_path: string;
  dryRun?: true;
  environment: LineageProfileEnvironment;
  ok: true;
  profile_id: string;
  schema_version: 'lineage.profile_bind.v1';
}

export function bindLineageProfileDatabase(profile: ResolvedLineageProfile, confirmWrite: boolean): LineageProfileBindResult {
  const result: LineageProfileBindResult = {
    database_path: profile.database_path,
    environment: profile.environment,
    ok: true,
    profile_id: profile.profile_id,
    schema_version: 'lineage.profile_bind.v1',
  };
  if (!confirmWrite) return { ...result, dryRun: true };
  mkdirSync(dirname(profile.database_path), { recursive: true });
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const database = new DatabaseSync(profile.database_path);
  try {
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(`
        create table if not exists lineage_profile_identity (
          profile_id text primary key,
          environment text not null,
          bound_at text not null
        )
      `);
      const rows = database.prepare('select profile_id, environment, bound_at from lineage_profile_identity').all() as Array<{
        bound_at: string;
        environment: string;
        profile_id: string;
      }>;
      if (rows.length > 0) {
        if (rows.length !== 1 || rows[0].profile_id !== profile.profile_id || rows[0].environment !== profile.environment) {
          throw new Error(`Database ${profile.database_path} is already bound to a different Lineage profile identity`);
        }
        database.exec('COMMIT');
        return { ...result, already_bound: true, bound_at: rows[0].bound_at };
      }
      const boundAt = new Date().toISOString();
      database.prepare('insert into lineage_profile_identity (profile_id, environment, bound_at) values (?, ?, ?)')
        .run(profile.profile_id, profile.environment, boundAt);
      database.exec('COMMIT');
      return { ...result, bound_at: boundAt };
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  } finally {
    database.close();
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

function gitShasMatch(expected: string, actual: string | undefined): boolean {
  if (!actual) return false;
  const normalizedExpected = expected.toLowerCase();
  const normalizedActual = actual.toLowerCase();
  const shorterLength = Math.min(normalizedExpected.length, normalizedActual.length);
  return shorterLength >= 12
    && normalizedExpected.slice(0, shorterLength) === normalizedActual.slice(0, shorterLength);
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
        const rows = database.prepare('select profile_id, environment, bound_at from lineage_profile_identity').all() as Array<Record<string, unknown>>;
        if (rows.length === 1) {
          const identity: LineageProfileIdentity = {
            bound_at: typeof rows[0].bound_at === 'string' ? rows[0].bound_at : undefined,
            environment: String(rows[0].environment) as LineageProfileEnvironment,
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
  runtime: { channel: LineageRuntimeChannel; gitSha?: string; version: string }
): LineageProfileDoctorResult {
  const checks: LineageProfileDoctorCheck[] = [];
  const result: LineageProfileDoctorResult = {
    checks,
    ok: false,
    runtime: { channel: runtime.channel, git_sha: runtime.gitSha, version: runtime.version },
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
  if (profile.expected_runtime?.version && profile.expected_runtime.version !== runtime.version) {
    checks.push({ id: 'runtime_version', message: `Expected version ${profile.expected_runtime.version}, found ${runtime.version}`, status: 'fail' });
  } else {
    checks.push({ id: 'runtime_version', message: `Runtime version ${runtime.version}`, status: 'pass' });
  }
  if (profile.expected_runtime?.git_sha && !gitShasMatch(profile.expected_runtime.git_sha, runtime.gitSha)) {
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
  } else if (database.identity.profile_id !== profile.profile_id || database.identity.environment !== profile.environment) {
    checks.push({
      id: 'database_identity',
      message: `Database identity ${database.identity.profile_id}/${database.identity.environment} does not match ${profile.profile_id}/${profile.environment}`,
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
      id,
      manifest_path: process.env.LINEAGE_PROFILE_MANIFEST,
      service_origin: process.env.LINEAGE_PROFILE_SERVICE_ORIGIN,
    };
  }
  return {
    bound: false,
    environment: channelEnvironment(channel),
    id: 'legacy-unbound',
    warning: id || environment || process.env.LINEAGE_PROFILE_MANIFEST
      ? 'Invalid unbound runtime: derived profile identity was supplied without a resolved LINEAGE_PROFILE selector.'
      : 'Legacy unbound runtime: database and asset paths are not protected by a named profile.',
  };
}

export function assertRuntimeProfileSafety(channel: LineageRuntimeChannel): void {
  const hasDerivedIdentity = Boolean(
    process.env.LINEAGE_PROFILE_ID
    || process.env.LINEAGE_PROFILE_ENVIRONMENT
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
  if (runtime.database.exists && runtime.database.error) {
    throw new Error(
      `Database ${runtime.database.path} identity could not be verified: ${runtime.database.error}; refusing unselected access`
    );
  }
  if (runtime.schema.profile_identity_rows !== undefined && runtime.schema.profile_identity_rows !== 1) {
    throw new Error(
      `Database ${runtime.database.path} has invalid Lineage profile identity row count ${runtime.schema.profile_identity_rows}; refusing unselected access`
    );
  }
  if (!runtime.schema.profile_id) return;
  const environment = runtime.schema.profile_environment || 'unknown';
  throw new Error(
    `Database ${runtime.database.path} is bound to Lineage profile ${runtime.schema.profile_id}/${environment}; select that profile with --profile`
  );
}

export function assertResolvedRuntimeProfileEnvironment(profile: ResolvedLineageProfile): void {
  const serviceUrl = new URL(profile.service_origin);
  const serviceHost = serviceUrl.hostname.startsWith('[') && serviceUrl.hostname.endsWith(']')
    ? serviceUrl.hostname.slice(1, -1)
    : serviceUrl.hostname;
  const expected = new Map<string, string>([
    ['LINEAGE_PROFILE_ID', profile.profile_id],
    ['LINEAGE_PROFILE_ENVIRONMENT', profile.environment],
    ['LINEAGE_PROFILE_MANIFEST', profile.manifest_path],
    ['LINEAGE_PROFILE_SERVICE_ORIGIN', profile.service_origin],
    ['LINEAGE_DB', profile.database_path],
    ['LINEAGE_ASSET_ROOT', profile.asset_root],
    ['HOST', serviceHost],
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
