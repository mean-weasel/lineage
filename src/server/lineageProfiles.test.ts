import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { repoRoot } from './assetCore';
import { assertProfileChannel, assertResolvedRuntimeProfileEnvironment, assertRuntimeProfileSafety, assertUnselectedDatabaseIsUnbound, bindLineageProfileDatabase, cloneLineageProfileAssets, cloneLineageProfileDatabase, doctorLineageProfile, initializeLineageProfile, repinLineageDevelopmentProfileRuntime, resolveLineageProfile, runtimeProfileIdentity } from './lineageProfiles';
import { getLineageCodeIdentity, getLineageRuntimeInfo } from './runtimeInfo';

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
  it('rolls back a reserved profile when initialization fails under its writer lease', () => {
    const profileRoot = join(scratchRoot, 'development-rollback');

    expect(() => initializeLineageProfile(
      'development-rollback',
      'http://lineage-dev.localhost:5198',
      testRuntime('dev'),
      true,
      () => { throw new Error('injected initialization failure'); },
    )).toThrow('injected initialization failure');

    expect(existsSync(profileRoot)).toBe(false);
  });

  it('repins only expected_runtime for an owner-only development manifest before its targets exist', () => {
    const manifest = writeProfile('development-repin', 'development', { createAssetRoot: false });
    const payload = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown> & { expected_runtime: Record<string, unknown> };
    payload.expected_runtime.code_fingerprint = 'a'.repeat(64);
    payload.operator_note = 'preserve-me';
    writeFileSync(manifest, `${JSON.stringify(payload, null, 2)}\n`);
    chmodSync(dirname(manifest), 0o700);
    chmodSync(manifest, 0o600);
    const before = resolveLineageProfile(manifest);
    const runtime = testRuntime('dev');

    const result = repinLineageDevelopmentProfileRuntime(manifest, repoRoot, runtime, true);
    const after = resolveLineageProfile(manifest);
    const rawAfter = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown> & { expected_runtime: Record<string, unknown> };

    expect(result).toMatchObject({
      changed: true,
      checkout_root: repoRoot,
      previous_code_fingerprint: 'a'.repeat(64),
      new_code_fingerprint: runtime.code.fingerprint,
      profile_fingerprint: before.profile_fingerprint,
      schema_version: 'lineage.profile_runtime_repin_receipt.v1',
    });
    expect(result.manifest_before_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.manifest_after_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(after.profile_fingerprint).toBe(before.profile_fingerprint);
    expect(after.expected_runtime).toMatchObject({
      channel: 'dev',
      code_fingerprint: runtime.code.fingerprint,
      code_origin: 'checkout',
      git_sha: runtime.gitSha,
      version: runtime.version,
    });
    expect(rawAfter.operator_note).toBe('preserve-me');
    expect(existsSync(after.database_path)).toBe(false);
    expect(existsSync(after.asset_root)).toBe(false);
    expect(statSync(manifest).mode & 0o777).toBe(0o600);
  });

  it('refuses runtime repin outside the exact verified development checkout contract', () => {
    const developmentManifest = writeProfile('development-repin-refusal', 'development', { createAssetRoot: false });
    chmodSync(dirname(developmentManifest), 0o700);
    chmodSync(developmentManifest, 0o600);
    const devRuntime = testRuntime('dev');

    expect(() => repinLineageDevelopmentProfileRuntime(developmentManifest, repoRoot, devRuntime, false))
      .toThrow('requires --confirm-write');
    expect(() => repinLineageDevelopmentProfileRuntime(developmentManifest, scratchRoot, devRuntime, true))
      .toThrow('does not match executing code root');
    expect(() => repinLineageDevelopmentProfileRuntime(developmentManifest, repoRoot, {
      ...devRuntime,
      channel: 'preview',
    }, true)).toThrow('requires dev code');
    expect(() => repinLineageDevelopmentProfileRuntime(developmentManifest, repoRoot, {
      ...devRuntime,
      code: { ...devRuntime.code, origin: 'package' },
    }, true)).toThrow('requires checkout code');
    expect(() => repinLineageDevelopmentProfileRuntime(developmentManifest, repoRoot, {
      ...devRuntime,
      code: { ...devRuntime.code, verified: false },
    }, true)).toThrow('requires a verified checkout runtime');

    const productionManifest = writeProfile('production-repin-refusal', 'production', { createAssetRoot: false });
    chmodSync(dirname(productionManifest), 0o700);
    chmodSync(productionManifest, 0o600);
    expect(() => repinLineageDevelopmentProfileRuntime(productionManifest, repoRoot, devRuntime, true))
      .toThrow('requires a development profile');

    const packagePinned = JSON.parse(readFileSync(developmentManifest, 'utf8')) as { expected_runtime: { code_origin: string } };
    packagePinned.expected_runtime.code_origin = 'package';
    writeFileSync(developmentManifest, `${JSON.stringify(packagePinned, null, 2)}\n`);
    chmodSync(developmentManifest, 0o600);
    expect(() => repinLineageDevelopmentProfileRuntime(developmentManifest, repoRoot, devRuntime, true))
      .toThrow('requires an existing checkout origin pin');
  });

  it('refuses unsafe manifest permissions and manifest symlinks without replacement', () => {
    const manifest = writeProfile('development-repin-files', 'development', { createAssetRoot: false });
    chmodSync(dirname(manifest), 0o700);
    chmodSync(manifest, 0o644);
    const before = readFileSync(manifest, 'utf8');

    expect(() => repinLineageDevelopmentProfileRuntime(manifest, repoRoot, testRuntime('dev'), true))
      .toThrow('manifest must be owner-only');
    expect(readFileSync(manifest, 'utf8')).toBe(before);

    chmodSync(manifest, 0o600);
    const linkedManifest = join(dirname(manifest), 'linked-profile.json');
    symlinkSync(manifest, linkedManifest);
    expect(() => repinLineageDevelopmentProfileRuntime(linkedManifest, repoRoot, testRuntime('dev'), true))
      .toThrow('manifest must be a nonsymlink regular file');
    expect(readFileSync(manifest, 'utf8')).toBe(before);
  });

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

    const result = doctorLineageProfile(manifest, testRuntime('dev'));
    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'runtime_channel', status: 'fail' }));
  });

  it('does not create a missing database, asset root, or any other file during doctor', () => {
    const manifest = writeProfile('development-main', 'development', { createAssetRoot: false });
    const before = treeSnapshot(scratchRoot);

    const result = doctorLineageProfile(manifest, testRuntime('dev'));
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
    bindDatabase(dbPath, 'different-profile', 'development', 'f'.repeat(64));
    const modifiedBefore = statSync(dbPath).mtimeMs;

    const result = doctorLineageProfile(manifest, testRuntime('dev'));

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
    const profile = resolveLineageProfile(manifest);
    bindDatabase(profile.database_path, profile.profile_id, profile.environment, profile.profile_fingerprint, ['base-v1']);

    const result = doctorLineageProfile(manifest, testRuntime('dev'));

    expect(result.ok).toBe(true);
    expect(result.checks.every(check => check.status === 'pass')).toBe(true);
    expect(result.profile).toMatchObject({
      profile_id: 'development-main',
      environment: 'development',
      service_origin: 'http://lineage-dev.localhost:5198',
    });
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

  it('rejects malformed optional runtime pins instead of silently discarding them', () => {
    const manifest = writeProfile('development-main', 'development');
    const payload = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>;
    payload.expected_runtime = { version: 11 };
    writeFileSync(manifest, `${JSON.stringify(payload, null, 2)}\n`);

    expect(() => resolveLineageProfile(manifest)).toThrow('version must be a non-empty string');
  });

  it('keeps embedded data identity stable across runtime-pin and migration-expectation updates', () => {
    const manifest = writeProfile('development-main', 'development');
    const original = resolveLineageProfile(manifest);
    const payload = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>;
    payload.expected_runtime = {
      channel: 'dev',
      code_fingerprint: 'c'.repeat(64),
      code_origin: 'checkout',
      version: '9.9.9',
    };
    payload.required_schema_migrations = ['future-v2'];
    writeFileSync(manifest, `${JSON.stringify(payload, null, 2)}\n`);

    const updated = resolveLineageProfile(manifest);
    const doctor = doctorLineageProfile(manifest, testRuntime('dev'));
    expect(updated.profile_fingerprint).toBe(original.profile_fingerprint);
    expect(doctor.checks).toContainEqual(expect.objectContaining({ id: 'runtime_code', status: 'fail' }));
    expect(doctor.checks).toContainEqual(expect.objectContaining({ id: 'database_schema', status: 'fail' }));
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

    expect(() => assertResolvedRuntimeProfileEnvironment(profile)).toThrow(/LINEAGE_PROFILE_ID=spoofed-profile, .*LINEAGE_DB=.*wrong.sqlite/);
  });

  it('rejects a profile-bound database when no profile was selected', () => {
    const dbPath = join(scratchRoot, 'bound-production.sqlite');
    bindDatabase(dbPath, 'production-main', 'production', 'e'.repeat(64));
    const runtime = getLineageRuntimeInfo({ channel: 'dev', dbPath });

    expect(() => assertUnselectedDatabaseIsUnbound(runtime)).toThrow('is bound to Lineage profile production-main/production');
  });

  it('binds only after explicit confirmation and upgrades a matching legacy identity with the profile fingerprint', () => {
    const manifest = writeProfile('development-main', 'development');
    const profile = resolveLineageProfile(manifest);
    const database = new DatabaseSync(profile.database_path);
    database.exec('create table lineage_profile_identity (profile_id text primary key, environment text not null, bound_at text not null)');
    database.prepare('insert into lineage_profile_identity (profile_id, environment, bound_at) values (?, ?, ?)')
      .run(profile.profile_id, profile.environment, '2026-07-14T00:00:00.000Z');
    database.close();

    expect(() => bindLineageProfileDatabase(manifest, testRuntime('dev'), false)).toThrow('requires --confirm-write');
    const result = bindLineageProfileDatabase(manifest, testRuntime('dev'), true);

    expect(result.already_bound).toBe(false);
    expect(result.identity.profile_fingerprint).toBe(profile.profile_fingerprint);
    expect(doctorLineageProfile(manifest, testRuntime('dev')).ok).toBe(true);
  });

  it('clones a live WAL database through SQLite backup and assigns a fresh non-production identity', async () => {
    const sourcePath = join(scratchRoot, 'source.sqlite');
    const source = new DatabaseSync(sourcePath);
    source.exec('pragma journal_mode = wal; create table source_marker (value text not null);');
    source.prepare('insert into source_marker (value) values (?)').run('committed-in-wal');
    const targetManifest = writeProfile('development-clone', 'development');
    const target = resolveLineageProfile(targetManifest);

    const result = await cloneLineageProfileDatabase(sourcePath, targetManifest, testRuntime('dev'), true);
    source.close();

    const cloned = new DatabaseSync(target.database_path, { readOnly: true });
    expect(cloned.prepare('select value from source_marker').get()).toMatchObject({ value: 'committed-in-wal' });
    expect(cloned.prepare('select profile_id, environment, profile_fingerprint from lineage_profile_identity').get()).toMatchObject({
      environment: 'development',
      profile_fingerprint: target.profile_fingerprint,
      profile_id: 'development-clone',
    });
    cloned.close();
    expect(result.pages_copied).toBeGreaterThan(0);
    expect(existsSync(result.receipt_path)).toBe(true);
    expect(statSync(target.database_path).mode & 0o777).toBe(0o600);
  });

  it('refuses clone targets that are production, already exist, or lack explicit confirmation', async () => {
    const sourcePath = join(scratchRoot, 'source.sqlite');
    const source = new DatabaseSync(sourcePath);
    source.exec('create table marker (id text)');
    source.close();
    const developmentManifest = writeProfile('development-main', 'development');
    const productionManifest = writeProfile('production-main', 'production');

    await expect(cloneLineageProfileDatabase(sourcePath, developmentManifest, testRuntime('dev'), false)).rejects.toThrow('requires --confirm-write');
    await expect(cloneLineageProfileDatabase(sourcePath, productionManifest, testRuntime('stable'), true)).rejects.toThrow(/verified runtime code identity|never production/);
    const target = resolveLineageProfile(developmentManifest);
    const existing = new DatabaseSync(target.database_path);
    existing.close();
    await expect(cloneLineageProfileDatabase(sourcePath, developmentManifest, testRuntime('dev'), true)).rejects.toThrow('already exists');
  });

  it('clones only referenced local assets into a new hardened profile root with a receipt', () => {
    const sourceRoot = join(scratchRoot, 'legacy-assets');
    mkdirSync(join(sourceRoot, '.asset-scratch', 'review'), { recursive: true });
    mkdirSync(join(sourceRoot, 'demo-project', 'assets'), { recursive: true });
    mkdirSync(join(sourceRoot, 'notes'), { recursive: true });
    writeFileSync(join(sourceRoot, '.asset-scratch', 'review', 'image.png'), 'image-bytes');
    writeFileSync(join(sourceRoot, 'demo-project', 'assets', 'catalog.json'), '{"assets":[]}\n');
    writeFileSync(join(sourceRoot, 'notes', 'post.md'), '# post\n');
    writeFileSync(join(sourceRoot, '.asset-scratch', 'unreferenced.png'), 'do-not-copy');
    const manifest = writeProfile('development-assets', 'development', { createAssetRoot: false });
    const profile = resolveLineageProfile(manifest);
    const database = new DatabaseSync(profile.database_path);
    database.exec(`
      create table projects (id text);
      create table assets (local_path text);
      create table asset_attempts (file_path text);
      create table content_posts (source_path text);
      insert into projects values ('demo-project');
      insert into assets values ('review/image.png'), ('review/missing.png');
      insert into asset_attempts values ('review/image.png');
      insert into content_posts values ('notes/post.md');
    `);
    database.close();

    const result = cloneLineageProfileAssets(sourceRoot, manifest, testRuntime('dev'), true);

    expect(result).toMatchObject({
      bytes_copied: Buffer.byteLength('image-bytes{"assets":[]}\n# post\n'),
      duplicate_references: 1,
      files_copied: 3,
      missing_references: 1,
      references_discovered: 5,
      schema_version: 'lineage.profile_assets_clone_receipt.v1',
    });
    expect(result.tree_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(join(profile.asset_root, '.asset-scratch', 'review', 'image.png'), 'utf8')).toBe('image-bytes');
    expect(readFileSync(join(profile.asset_root, 'demo-project', 'assets', 'catalog.json'), 'utf8')).toBe('{"assets":[]}\n');
    expect(readFileSync(join(profile.asset_root, 'notes', 'post.md'), 'utf8')).toBe('# post\n');
    expect(existsSync(join(profile.asset_root, '.asset-scratch', 'unreferenced.png'))).toBe(false);
    expect(statSync(profile.asset_root).mode & 0o777).toBe(0o700);
    expect(statSync(result.receipt_path).mode & 0o777).toBe(0o600);
  });

  it('rejects escaping references and removes its reserved target on failure', () => {
    const sourceRoot = join(scratchRoot, 'legacy-assets');
    mkdirSync(join(sourceRoot, '.asset-scratch'), { recursive: true });
    const manifest = writeProfile('development-assets', 'development', { createAssetRoot: false });
    const profile = resolveLineageProfile(manifest);
    const database = new DatabaseSync(profile.database_path);
    database.exec("create table assets (local_path text); insert into assets values ('../outside.png')");
    database.close();

    expect(() => cloneLineageProfileAssets(sourceRoot, manifest, testRuntime('dev'), true)).toThrow('escapes the declared source asset root');
    expect(existsSync(profile.asset_root)).toBe(false);
  });

  it('rejects a referenced symlink that escapes the declared source asset root', () => {
    const sourceRoot = join(scratchRoot, 'legacy-assets');
    mkdirSync(join(sourceRoot, '.asset-scratch'), { recursive: true });
    const outside = join(scratchRoot, 'outside.png');
    writeFileSync(outside, 'outside');
    symlinkSync(outside, join(sourceRoot, '.asset-scratch', 'escape.png'));
    const manifest = writeProfile('development-assets', 'development', { createAssetRoot: false });
    const profile = resolveLineageProfile(manifest);
    const database = new DatabaseSync(profile.database_path);
    database.exec("create table assets (local_path text); insert into assets values ('escape.png')");
    database.close();

    expect(() => cloneLineageProfileAssets(sourceRoot, manifest, testRuntime('dev'), true)).toThrow('symlink escapes the declared source asset root');
    expect(existsSync(profile.asset_root)).toBe(false);
  });

  it('refuses an existing asset target and a database bound to another profile', () => {
    const sourceRoot = join(scratchRoot, 'legacy-assets');
    mkdirSync(sourceRoot, { recursive: true });
    const existingManifest = writeProfile('development-assets', 'development');
    const existing = resolveLineageProfile(existingManifest);
    const existingDatabase = new DatabaseSync(existing.database_path);
    existingDatabase.close();
    expect(() => cloneLineageProfileAssets(sourceRoot, existingManifest, testRuntime('dev'), true)).toThrow('target already exists');

    const conflictingManifest = writeProfile('development-conflict', 'development', { createAssetRoot: false });
    const conflicting = resolveLineageProfile(conflictingManifest);
    bindDatabase(conflicting.database_path, 'another-profile', 'development', 'f'.repeat(64));
    expect(() => cloneLineageProfileAssets(sourceRoot, conflictingManifest, testRuntime('dev'), true)).toThrow('already bound to another-profile/development');
    expect(existsSync(conflicting.asset_root)).toBe(false);
  });
});

function writeProfile(
  profileId: string,
  environment: 'production' | 'preview' | 'development',
  options: { createAssetRoot?: boolean; requiredMigrations?: string[] } = {}
): string {
  const profileDir = join(scratchRoot, profileId);
  mkdirSync(profileDir, { recursive: true });
  if (options.createAssetRoot !== false) mkdirSync(join(profileDir, 'media'), { recursive: true });
  const channel = environment === 'production' ? 'stable' : environment === 'preview' ? 'preview' : 'dev';
  const port = environment === 'production' ? 5197 : environment === 'preview' ? 5199 : 5198;
  const manifest = join(profileDir, 'profile.json');
  const code = getLineageCodeIdentity(channel);
  writeFileSync(manifest, `${JSON.stringify({
    schema_version: 'lineage.profile.v1',
    profile_id: profileId,
    environment,
    expected_runtime: {
      channel,
      code_fingerprint: code.fingerprint,
      code_origin: code.origin === 'package' ? 'package' : 'checkout',
    },
    database_path: './lineage.sqlite',
    asset_root: './media',
    service_origin: `http://lineage-${channel}.localhost:${port}`,
    ...(options.requiredMigrations ? { required_schema_migrations: options.requiredMigrations } : {}),
  }, null, 2)}\n`);
  return manifest;
}

function bindDatabase(
  path: string,
  profileId: string,
  environment: 'production' | 'preview' | 'development',
  profileFingerprint: string,
  migrations: string[] = []
) {
  const database = new DatabaseSync(path);
  database.exec(`
    create table lineage_profile_identity (
      profile_id text primary key,
      environment text not null,
      profile_fingerprint text not null,
      bound_at text not null
    );
    create table lineage_schema_migrations (
      key text primary key,
      applied_at text not null
    );
  `);
  database.prepare('insert into lineage_profile_identity (profile_id, environment, profile_fingerprint, bound_at) values (?, ?, ?, ?)')
    .run(profileId, environment, profileFingerprint, '2026-07-14T00:00:00.000Z');
  for (const migration of migrations) {
    database.prepare('insert into lineage_schema_migrations (key, applied_at) values (?, ?)')
      .run(migration, '2026-07-14T00:00:00.000Z');
  }
  database.close();
}

function testRuntime(channel: 'stable' | 'preview' | 'dev') {
  const code = getLineageCodeIdentity(channel);
  return { channel, code, gitSha: code.git_sha, version: '0.1.11' };
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
