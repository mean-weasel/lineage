import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { repoRoot } from './assetCore';
import { getLineageCodeIdentity, getLineageRuntimeInfo, lineagePackageTreeSha256, normalizeRuntimeChannel } from './runtimeInfo';

const originalEnv = { ...process.env };
const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-runtime-info');
const dbFile = join(scratchDir, 'runtime-info.sqlite');

afterEach(() => {
  process.env = { ...originalEnv };
  rmSync(scratchDir, { force: true, recursive: true });
});

describe('runtime info', () => {
  it('normalizes runtime channel labels', () => {
    process.env.NODE_ENV = 'development';

    expect(normalizeRuntimeChannel('production')).toBe('stable');
    expect(normalizeRuntimeChannel('next')).toBe('preview');
    expect(normalizeRuntimeChannel('development')).toBe('dev');
    expect(normalizeRuntimeChannel()).toBe('dev');
  });

  it('reports database identity and aggregate counts without creating a database', () => {
    rmSync(scratchDir, { force: true, recursive: true });

    const missing = getLineageRuntimeInfo({ channel: 'dev', dbPath: dbFile });

    expect(missing).toMatchObject({
      asset_root: repoRoot,
      channel: 'dev',
      code: {
        channel: 'dev',
        origin: 'checkout',
        verified: true,
      },
      database: {
        exists: false,
        path: dbFile,
      },
      package_name: '@mean-weasel/lineage',
      profile: {
        bound: false,
        id: 'legacy-unbound',
        environment: 'development',
      },
      schema: { migration_keys: [] },
    });

    process.env.LINEAGE_DB = dbFile;
    createRuntimeFixtureDb();

    const present = getLineageRuntimeInfo({ channel: 'preview', dbPath: dbFile });

    expect(present.channel).toBe('preview');
    expect(present.database).toMatchObject({
      exists: true,
      path: dbFile,
    });
    expect(present.database.projects).toBeGreaterThanOrEqual(1);
    expect(present.database.workspaces).toBeGreaterThanOrEqual(0);
    expect(present.database.size_bytes).toBeGreaterThan(0);
  });

  it('accepts only dev identity from a checkout and fingerprints dirty state', () => {
    process.env.LINEAGE_REPO_ROOT = join(scratchDir, 'environment-selected-fake-root');
    process.env.LINEAGE_ASSET_ROOT = join(scratchDir, 'environment-selected-assets');
    const dev = getLineageCodeIdentity('dev');
    const stable = getLineageCodeIdentity('stable');

    expect(dev).toMatchObject({ channel: 'dev', origin: 'checkout', root: repoRoot, verified: true });
    expect(dev.git_sha).toMatch(/^[a-f0-9]{40}$/);
    expect(dev.source_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(typeof dev.dirty).toBe('boolean');
    expect(stable).toMatchObject({ channel: 'stable', origin: 'checkout', verified: false });
    expect(stable.errors).toContain('Checkout code may run only as dev, not stable');
  });

  it('reports the frozen startup code and managed service instance supplied by the server', () => {
    const startupCode = { ...getLineageCodeIdentity('dev'), fingerprint: 'a'.repeat(64) };
    process.env.LINEAGE_SERVICE_INSTANCE_ID = 'service-instance-a';
    process.env.LINEAGE_LAUNCHER_PID = '4242';

    const runtime = getLineageRuntimeInfo({ channel: 'dev', code: startupCode, dbPath: dbFile });

    expect(runtime.code?.fingerprint).toBe('a'.repeat(64));
    expect(runtime.service).toMatchObject({
      instance_id: 'service-instance-a',
      launcher_pid: 4242,
      pid: process.pid,
    });
  });

  it('verifies a clean packaged tree against its channel receipt and rejects tampering or a channel mismatch', () => {
    const installRoot = join(scratchDir, 'runtime-install');
    const fixtureRoot = join(installRoot, 'node_modules', '@mean-weasel', 'lineage');
    mkdirSync(join(fixtureRoot, 'dist'), { recursive: true });
    writeFileSync(join(fixtureRoot, 'package.json'), JSON.stringify({ name: '@mean-weasel/lineage', version: '9.9.9' }));
    const buildWithoutFingerprint = {
      package_name: '@mean-weasel/lineage',
      package_version: '9.9.9',
      schema_version: 'lineage.runtime_build.v1',
      source_dirty: false,
      source_fingerprint: 'b'.repeat(64),
      source_git_sha: 'a'.repeat(40),
    } as const;
    const buildFingerprint = createHash('sha256').update(JSON.stringify(buildWithoutFingerprint)).digest('hex');
    writeFileSync(join(fixtureRoot, 'dist', 'runtime-build.json'), JSON.stringify({ build_fingerprint: buildFingerprint, ...buildWithoutFingerprint }));
    writeFileSync(join(fixtureRoot, 'dist', 'server.js'), 'export default true;\n');
    const receiptPath = join(installRoot, 'lineage-runtime-receipt.json');
    writeFileSync(receiptPath, JSON.stringify({
      build_fingerprint: buildFingerprint,
      channel: 'stable',
      installed_at: '2026-07-16T00:00:00.000Z',
      package_integrity: `sha512-${Buffer.from('fixture').toString('base64')}`,
      package_name: '@mean-weasel/lineage',
      package_root: fixtureRoot,
      package_source: 'registry',
      package_spec: '@mean-weasel/lineage@9.9.9',
      package_tree_sha256: lineagePackageTreeSha256(fixtureRoot),
      package_version: '9.9.9',
      schema_version: 'lineage.runtime_install.v1',
    }));

    const stable = getLineageCodeIdentity('stable', { receiptPath, root: fixtureRoot });
    const preview = getLineageCodeIdentity('preview', { receiptPath, root: fixtureRoot });
    expect(stable).toMatchObject({ channel: 'stable', git_sha: 'a'.repeat(40), origin: 'package', verified: true });
    expect(preview.verified).toBe(false);
    expect(preview.errors).toContain('Install receipt channel stable does not match requested preview');

    writeFileSync(join(fixtureRoot, 'dist', 'server.js'), 'export default false;\n');
    const tampered = getLineageCodeIdentity('stable', { receiptPath, root: fixtureRoot });
    expect(tampered.verified).toBe(false);
    expect(tampered.errors).toContain('Installed package tree does not match the channel install receipt');
  });

  it('reports the same bound profile identity and schema that the runtime UI consumes', () => {
    process.env.LINEAGE_DB = dbFile;
    const fingerprint = 'f'.repeat(64);
    createRuntimeFixtureDb({ profileFingerprint: fingerprint });
    process.env.LINEAGE_PROFILE_ID = 'development-main';
    process.env.LINEAGE_PROFILE_ENVIRONMENT = 'development';
    process.env.LINEAGE_PROFILE_FINGERPRINT = fingerprint;
    process.env.LINEAGE_PROFILE_MANIFEST = '/runtime/profile.json';
    process.env.LINEAGE_PROFILE_SERVICE_ORIGIN = 'http://lineage-dev.localhost:5198';
    process.env.LINEAGE_PROFILE = '/runtime/profile.json';

    const runtime = getLineageRuntimeInfo({ channel: 'dev', dbPath: dbFile });

    expect(runtime.profile).toEqual({
      bound: true,
      environment: 'development',
      fingerprint,
      id: 'development-main',
      manifest_path: '/runtime/profile.json',
      service_origin: 'http://lineage-dev.localhost:5198',
    });
    expect(runtime.schema).toMatchObject({
      profile_id: 'development-main',
      profile_environment: 'development',
      profile_fingerprint: fingerprint,
    });
  });
});

function createRuntimeFixtureDb(options: { profileFingerprint?: string } = {}): void {
  mkdirSync(scratchDir, { recursive: true });
  const database = new DatabaseSync(dbFile);
  database.exec(`
    create table projects (id text primary key);
    create table lineage_workspaces (id text primary key);
    insert into projects (id) values ('fixture-project');
  `);
  if (options.profileFingerprint) {
    database.exec('create table lineage_profile_identity (profile_id text primary key, environment text not null, profile_fingerprint text not null, bound_at text not null)');
    database.prepare('insert into lineage_profile_identity (profile_id, environment, profile_fingerprint, bound_at) values (?, ?, ?, ?)')
      .run('development-main', 'development', options.profileFingerprint, '2026-07-14T00:00:00.000Z');
  }
  database.close();
}
