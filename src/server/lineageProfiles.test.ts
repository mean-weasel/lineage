import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { repoRoot } from './assetCore';
import { assertProfileChannel, assertResolvedRuntimeProfileEnvironment, assertRuntimeProfileSafety, assertUnselectedDatabaseIsUnbound, doctorLineageProfile, resolveLineageProfile, runtimeProfileIdentity } from './lineageProfiles';
import { getLineageRuntimeInfo } from './runtimeInfo';

const originalEnv = { ...process.env };
const scratchRoot = join(repoRoot, '.asset-scratch', 'vitest-lineage-profiles');

beforeEach(() => {
  rmSync(scratchRoot, { force: true, recursive: true });
  mkdirSync(scratchRoot, { recursive: true });
  process.env.LINEAGE_PROFILE_ROOT = scratchRoot;
});

afterEach(() => {
  process.env = { ...originalEnv };
  rmSync(scratchRoot, { force: true, recursive: true });
});

describe('Lineage named profiles', () => {
  it('resolves distinct named profiles to distinct database and media roots', () => {
    writeProfile('production-main', 'production');
    writeProfile('development-main', 'development');

    const production = resolveLineageProfile('production-main');
    const development = resolveLineageProfile('development-main');

    expect(production.profile_id).toBe('production-main');
    expect(development.profile_id).toBe('development-main');
    expect(production.database_path).not.toBe(development.database_path);
    expect(production.asset_root).not.toBe(development.asset_root);
    expect(production.manifest_path).toBe(join(scratchRoot, 'production-main', 'profile.json'));
  });

  it('refuses dev and preview code before a production profile can be opened', () => {
    const manifest = writeProfile('production-main', 'production');
    const profile = resolveLineageProfile(manifest);

    expect(() => assertProfileChannel(profile, 'dev')).toThrow('Refusing to open production profile production-main from dev code');
    expect(() => assertProfileChannel(profile, 'preview')).toThrow('Refusing to open production profile production-main from preview code');

    const result = doctorLineageProfile(manifest, { channel: 'dev', version: '0.1.11' });
    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'runtime_channel', status: 'fail' }));
  });

  it('does not create a missing database, asset root, or any other file during doctor', () => {
    const manifest = writeProfile('development-main', 'development', { createAssetRoot: false });
    const before = treeSnapshot(scratchRoot);

    const result = doctorLineageProfile(manifest, { channel: 'dev', version: '0.1.11' });
    const after = treeSnapshot(scratchRoot);

    expect(result.ok).toBe(false);
    expect(result.database).toMatchObject({ exists: false, path: join(scratchRoot, 'development-main', 'lineage.sqlite') });
    expect(existsSync(join(scratchRoot, 'development-main', 'lineage.sqlite'))).toBe(false);
    expect(existsSync(join(scratchRoot, 'development-main', 'media'))).toBe(false);
    expect(after).toEqual(before);
  });

  it('reports a manifest and embedded database identity mismatch without modifying the database', () => {
    const manifest = writeProfile('development-main', 'development');
    const dbPath = join(scratchRoot, 'development-main', 'lineage.sqlite');
    bindDatabase(dbPath, 'different-profile', 'development');
    const modifiedBefore = statSync(dbPath).mtimeMs;

    const result = doctorLineageProfile(manifest, { channel: 'dev', version: '0.1.11' });

    expect(result.ok).toBe(false);
    expect(result.database?.identity).toMatchObject({ profile_id: 'different-profile', environment: 'development' });
    expect(result.checks).toContainEqual(expect.objectContaining({
      id: 'database_identity',
      message: expect.stringContaining('does not match development-main/development'),
      status: 'fail',
    }));
    expect(statSync(dbPath).mtimeMs).toBe(modifiedBefore);
  });

  it('passes only when manifest, runtime, schema, database binding, and paths agree', () => {
    const manifest = writeProfile('development-main', 'development', { requiredMigrations: ['base-v1'] });
    bindDatabase(join(scratchRoot, 'development-main', 'lineage.sqlite'), 'development-main', 'development', ['base-v1']);

    const result = doctorLineageProfile(manifest, { channel: 'dev', version: '0.1.11' });

    expect(result.ok).toBe(true);
    expect(result.checks.every(check => check.status === 'pass')).toBe(true);
    expect(result.profile).toMatchObject({
      profile_id: 'development-main',
      environment: 'development',
      service_origin: 'http://lineage-dev.localhost:5198',
    });
  });

  it('accepts a full expected Git SHA when the source runtime reports its 12-character prefix', () => {
    const manifest = writeProfile('development-main', 'development', {
      expectedGitSha: '83611577481227393a3835e67919237c208be9a8',
    });
    bindDatabase(join(scratchRoot, 'development-main', 'lineage.sqlite'), 'development-main', 'development');

    const matching = doctorLineageProfile(manifest, { channel: 'dev', gitSha: '836115774812', version: '0.1.12' });
    const mismatching = doctorLineageProfile(manifest, { channel: 'dev', gitSha: 'ffffffffffff', version: '0.1.12' });

    expect(matching.checks).toContainEqual(expect.objectContaining({ id: 'runtime_git_sha', status: 'pass' }));
    expect(mismatching.checks).toContainEqual(expect.objectContaining({ id: 'runtime_git_sha', status: 'fail' }));
  });

  it('rejects a named selector whose manifest tries to change its immutable profile ID', () => {
    const manifest = writeProfile('development-main', 'development');
    const payload = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>;
    payload.profile_id = 'renamed-profile';
    writeFileSync(manifest, `${JSON.stringify(payload, null, 2)}\n`);

    expect(() => resolveLineageProfile('development-main')).toThrow('does not match immutable manifest profile_id');
  });

  it('requires an explicit service port so the manifest origin cannot diverge from start options', () => {
    const manifest = writeProfile('development-main', 'development');
    const payload = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>;
    payload.service_origin = 'http://lineage-dev.localhost';
    writeFileSync(manifest, `${JSON.stringify(payload, null, 2)}\n`);

    expect(() => resolveLineageProfile(manifest)).toThrow('service_origin must include an explicit port');
  });

  it('rejects non-loopback service origins before a writer token could leave the host', () => {
    const manifest = writeProfile('development-main', 'development');
    const payload = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>;
    payload.service_origin = 'http://example.com:5198';
    writeFileSync(manifest, `${JSON.stringify(payload, null, 2)}\n`);

    expect(() => resolveLineageProfile(manifest)).toThrow('must use a loopback or localhost host');
  });

  it('rejects malformed optional runtime pins instead of silently discarding them', () => {
    const manifest = writeProfile('development-main', 'development');
    const payload = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>;
    payload.expected_runtime = { version: 11 };
    writeFileSync(manifest, `${JSON.stringify(payload, null, 2)}\n`);

    expect(() => resolveLineageProfile(manifest)).toThrow('version must be a non-empty string');
  });

  it('rejects derived identity variables that were not resolved from a selected profile', () => {
    process.env.LINEAGE_PROFILE_ID = 'spoofed-profile';
    process.env.LINEAGE_PROFILE_ENVIRONMENT = 'development';
    process.env.LINEAGE_PROFILE_MANIFEST = '/tmp/not-a-resolved-profile.json';
    delete process.env.LINEAGE_PROFILE;

    expect(runtimeProfileIdentity('dev')).toMatchObject({
      bound: false,
      id: 'legacy-unbound',
      warning: expect.stringContaining('derived profile identity'),
    });
    expect(() => assertRuntimeProfileSafety('dev')).toThrow('Derived Lineage profile identity requires LINEAGE_PROFILE');
  });

  it('rejects a selected profile when derived paths or identity do not match its manifest', () => {
    const profile = resolveLineageProfile(writeProfile('development-main', 'development'));
    process.env.LINEAGE_PROFILE = 'development-main';
    process.env.LINEAGE_PROFILE_ID = 'spoofed-profile';
    process.env.LINEAGE_PROFILE_ENVIRONMENT = profile.environment;
    process.env.LINEAGE_PROFILE_MANIFEST = profile.manifest_path;
    process.env.LINEAGE_PROFILE_SERVICE_ORIGIN = profile.service_origin;
    process.env.LINEAGE_DB = join(scratchRoot, 'wrong.sqlite');
    process.env.LINEAGE_ASSET_ROOT = profile.asset_root;
    process.env.HOST = 'lineage-dev.localhost';
    process.env.PORT = '5198';

    expect(() => assertResolvedRuntimeProfileEnvironment(profile)).toThrow(/LINEAGE_PROFILE_ID=spoofed-profile, LINEAGE_DB=.*wrong.sqlite/);
  });

  it('accepts an unbracketed IPv6 socket host for a bracketed profile service origin', () => {
    const manifest = writeProfile('development-ipv6', 'development');
    const payload = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>;
    payload.service_origin = 'http://[::1]:5198';
    writeFileSync(manifest, `${JSON.stringify(payload, null, 2)}\n`);
    const profile = resolveLineageProfile(manifest);
    process.env.LINEAGE_PROFILE = manifest;
    process.env.LINEAGE_PROFILE_ID = profile.profile_id;
    process.env.LINEAGE_PROFILE_ENVIRONMENT = profile.environment;
    process.env.LINEAGE_PROFILE_MANIFEST = profile.manifest_path;
    process.env.LINEAGE_PROFILE_SERVICE_ORIGIN = profile.service_origin;
    process.env.LINEAGE_DB = profile.database_path;
    process.env.LINEAGE_ASSET_ROOT = profile.asset_root;
    process.env.HOST = '::1';
    process.env.PORT = '5198';

    expect(() => assertResolvedRuntimeProfileEnvironment(profile)).not.toThrow();
  });

  it('rejects a profile-bound database when no profile was selected', () => {
    const dbPath = join(scratchRoot, 'bound-production.sqlite');
    bindDatabase(dbPath, 'production-main', 'production');
    const runtime = getLineageRuntimeInfo({ channel: 'dev', dbPath });

    expect(() => assertUnselectedDatabaseIsUnbound(runtime)).toThrow('is bound to Lineage profile production-main/production');
  });

  it.each([0, 2])('fails closed when a profile identity table has %i rows', (rowCount) => {
    const dbPath = join(scratchRoot, `malformed-identity-${rowCount}.sqlite`);
    const database = new DatabaseSync(dbPath);
    database.exec('create table lineage_profile_identity (profile_id text primary key, environment text not null, bound_at text not null)');
    for (let index = 0; index < rowCount; index += 1) {
      database.prepare('insert into lineage_profile_identity (profile_id, environment, bound_at) values (?, ?, ?)')
        .run(`profile-${index}`, 'development', '2026-07-14T00:00:00.000Z');
    }
    database.close();

    const runtime = getLineageRuntimeInfo({ channel: 'dev', dbPath });

    expect(runtime.schema.profile_identity_rows).toBe(rowCount);
    expect(() => assertUnselectedDatabaseIsUnbound(runtime)).toThrow(`invalid Lineage profile identity row count ${rowCount}`);
  });

  it('fails closed when the profile identity table schema cannot be inspected', () => {
    const dbPath = join(scratchRoot, 'malformed-identity-schema.sqlite');
    const database = new DatabaseSync(dbPath);
    database.exec('create table lineage_profile_identity (profile_id text primary key)');
    database.close();

    const runtime = getLineageRuntimeInfo({ channel: 'dev', dbPath });

    expect(runtime.database.error).toMatch(/environment/);
    expect(() => assertUnselectedDatabaseIsUnbound(runtime)).toThrow('identity could not be verified');
  });
});

function writeProfile(
  profileId: string,
  environment: 'production' | 'preview' | 'development',
  options: { createAssetRoot?: boolean; expectedGitSha?: string; requiredMigrations?: string[] } = {}
): string {
  const profileDir = join(scratchRoot, profileId);
  mkdirSync(profileDir, { recursive: true });
  if (options.createAssetRoot !== false) mkdirSync(join(profileDir, 'media'), { recursive: true });
  const channel = environment === 'production' ? 'stable' : environment === 'preview' ? 'preview' : 'dev';
  const port = environment === 'production' ? 5197 : environment === 'preview' ? 5199 : 5198;
  const manifest = join(profileDir, 'profile.json');
  writeFileSync(manifest, `${JSON.stringify({
    schema_version: 'lineage.profile.v1',
    profile_id: profileId,
    environment,
    database_path: './lineage.sqlite',
    asset_root: './media',
    service_origin: `http://lineage-${channel}.localhost:${port}`,
    ...(options.expectedGitSha ? { expected_runtime: { git_sha: options.expectedGitSha } } : {}),
    ...(options.requiredMigrations ? { required_schema_migrations: options.requiredMigrations } : {}),
  }, null, 2)}\n`);
  return manifest;
}

function bindDatabase(
  path: string,
  profileId: string,
  environment: 'production' | 'preview' | 'development',
  migrations: string[] = []
) {
  const database = new DatabaseSync(path);
  database.exec(`
    create table lineage_profile_identity (
      profile_id text primary key,
      environment text not null,
      bound_at text not null
    );
    create table lineage_schema_migrations (
      key text primary key,
      applied_at text not null
    );
  `);
  database.prepare('insert into lineage_profile_identity (profile_id, environment, bound_at) values (?, ?, ?)')
    .run(profileId, environment, '2026-07-14T00:00:00.000Z');
  for (const migration of migrations) {
    database.prepare('insert into lineage_schema_migrations (key, applied_at) values (?, ?)')
      .run(migration, '2026-07-14T00:00:00.000Z');
  }
  database.close();
}

function treeSnapshot(root: string): string[] {
  const output: string[] = [];
  function visit(path: string, relative: string) {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const nextRelative = join(relative, entry.name);
      output.push(`${entry.isDirectory() ? 'dir' : 'file'}:${nextRelative}`);
      if (entry.isDirectory()) visit(join(path, entry.name), nextRelative);
    }
  }
  visit(root, '.');
  return output;
}
