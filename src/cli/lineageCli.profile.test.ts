import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { repoRoot } from '../server/assetCore';
import { resolveLineageProfile } from '../server/lineageProfiles';
import { acquireProfileWriterLease, profileWriterLockPath } from '../server/profileWriterLease';
import { getLineageCodeIdentity } from '../server/runtimeInfo';
import { lineageProfileDoctorExitCode, resolveStartOptions, runLineageProfileCommand, type LineageCliConfig } from './lineageCli';

const originalEnv = { ...process.env };
const scratchRoot = join(repoRoot, '.asset-scratch', 'vitest-lineage-cli-profiles');
const config: LineageCliConfig = {
  binName: 'lineage-dev',
  channel: 'dev',
  defaultHost: 'lineage-dev.localhost',
  defaultPort: 5198,
  displayName: 'Lineage Dev',
};

beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.LINEAGE_DB;
  delete process.env.LINEAGE_ASSET_ROOT;
  delete process.env.LINEAGE_PROFILE;
  delete process.env.HOST;
  delete process.env.PORT;
  rmSync(scratchRoot, { force: true, recursive: true });
  process.env.LINEAGE_PROFILE_ROOT = scratchRoot;
  mkdirSync(join(scratchRoot, 'development-main', 'media'), { recursive: true });
  const code = getLineageCodeIdentity('dev');
  writeFileSync(join(scratchRoot, 'development-main', 'profile.json'), `${JSON.stringify({
    schema_version: 'lineage.profile.v1',
    profile_id: 'development-main',
    environment: 'development',
    expected_runtime: {
      channel: 'dev',
      code_fingerprint: code.fingerprint,
      code_origin: code.origin,
    },
    database_path: './lineage.sqlite',
    asset_root: './media',
    service_origin: 'http://lineage-dev.localhost:5198',
  }, null, 2)}\n`);
  const profile = resolveLineageProfile('development-main');
  bindDatabase(profile.database_path, profile.profile_fingerprint);
});

afterEach(() => {
  process.env = { ...originalEnv };
  rmSync(scratchRoot, { force: true, recursive: true });
});

describe('profile-aware CLI options', () => {
  it('repins a development manifest through the CLI and releases its writer lease', () => {
    const manifest = join(scratchRoot, 'development-main', 'profile.json');
    const payload = JSON.parse(readFileSync(manifest, 'utf8')) as { expected_runtime: { code_fingerprint: string } };
    payload.expected_runtime.code_fingerprint = 'a'.repeat(64);
    writeFileSync(manifest, `${JSON.stringify(payload, null, 2)}\n`);
    chmodSync(join(scratchRoot, 'development-main'), 0o700);
    chmodSync(manifest, 0o600);

    const result = runLineageProfileCommand(config, 'repin-runtime', [
      '--profile', 'development-main',
      '--checkout-root', repoRoot,
      '--confirm-write',
      '--json',
    ]);

    expect(result).toMatchObject({
      changed: true,
      profile_id: 'development-main',
      previous_code_fingerprint: 'a'.repeat(64),
      new_code_fingerprint: getLineageCodeIdentity('dev').fingerprint,
      schema_version: 'lineage.profile_runtime_repin_receipt.v1',
    });
    expect(resolveLineageProfile('development-main').expected_runtime?.code_fingerprint)
      .toBe(getLineageCodeIdentity('dev').fingerprint);
    expect(statSync(manifest).mode & 0o777).toBe(0o600);
    expect(existsSync(profileWriterLockPath(resolveLineageProfile('development-main')))).toBe(false);
  });

  it('requires explicit repin inputs and refuses an active profile writer', () => {
    const manifest = join(scratchRoot, 'development-main', 'profile.json');
    chmodSync(join(scratchRoot, 'development-main'), 0o700);
    chmodSync(manifest, 0o600);

    expect(() => runLineageProfileCommand(config, 'repin-runtime', ['--profile', 'development-main']))
      .toThrow('requires --checkout-root');
    expect(() => runLineageProfileCommand(config, 'repin-runtime', [
      '--profile', 'development-main', '--checkout-root', repoRoot,
    ])).toThrow('requires --confirm-write');
    expect(() => runLineageProfileCommand(config, 'repin-runtime', [
      '--profile', 'development-main', '--checkout-root', repoRoot, '--confirm-write', '--db', '/tmp/wrong.sqlite',
    ])).toThrow('cannot be combined with --db');
    expect(() => runLineageProfileCommand(config, 'repin-runtime', [
      '--profile', 'development-main', '--checkout-root', repoRoot, '--confirm-write', '--asset-root', '/tmp/wrong-assets',
    ])).toThrow('cannot be combined with --asset-root');

    const profile = resolveLineageProfile('development-main');
    const serviceLease = acquireProfileWriterLease(profile, 'dev', 'service');
    try {
      expect(() => runLineageProfileCommand(config, 'repin-runtime', [
        '--profile', 'development-main', '--checkout-root', repoRoot, '--confirm-write',
      ])).toThrow('already has an active service writer');
    } finally {
      serviceLease.release();
    }
  });

  it('supports --profile and sources all protected paths and origin from its manifest', () => {
    const options = resolveStartOptions(config, ['--profile', 'development-main', '--json']);

    expect(options).toMatchObject({
      assetRoot: join(scratchRoot, 'development-main', 'media'),
      dbPath: join(scratchRoot, 'development-main', 'lineage.sqlite'),
      host: 'lineage-dev.localhost',
      port: 5198,
      profile: { profile_id: 'development-main', environment: 'development' },
    });
    expect(process.env.LINEAGE_PROFILE_ID).toBe('development-main');
  });

  it('supports LINEAGE_PROFILE without duplicating direct path configuration', () => {
    process.env.LINEAGE_PROFILE = 'development-main';

    const options = resolveStartOptions(config, []);

    expect(options.profile?.profile_id).toBe('development-main');
    expect(options.dbPath).toBe(join(scratchRoot, 'development-main', 'lineage.sqlite'));
  });

  it('rejects direct database and asset-root overrides when a profile is selected', () => {
    expect(() => resolveStartOptions(config, ['--profile', 'development-main', '--db', join(scratchRoot, 'other.sqlite')]))
      .toThrow('cannot be combined with --db');
    expect(() => resolveStartOptions(config, ['--profile', 'development-main', '--asset-root', join(scratchRoot, 'other-media')]))
      .toThrow('cannot be combined with --asset-root');
  });

  it('returns a machine-readable doctor contract and rejects missing profile selection', () => {
    const result = runLineageProfileCommand(config, 'doctor', ['--profile', 'development-main', '--json']);

    expect(result).toMatchObject({
      ok: true,
      schema_version: 'lineage.profile_doctor.v1',
      profile: { profile_id: 'development-main' },
      runtime: { channel: 'dev' },
    });
    expect(lineageProfileDoctorExitCode(result)).toBe(0);
    expect(() => runLineageProfileCommand(config, 'doctor', ['--json'])).toThrow('requires --profile or LINEAGE_PROFILE');
  });

  it('maps a failed read-only doctor result to a nonzero CLI exit code', () => {
    rmSync(join(scratchRoot, 'development-main', 'lineage.sqlite'));

    const result = runLineageProfileCommand(config, 'doctor', ['--profile', 'development-main', '--json']);

    expect(result.ok).toBe(false);
    expect(lineageProfileDoctorExitCode(result)).toBe(1);
  });

  it('returns the structured doctor contract for an invalid manifest', () => {
    const invalid = join(scratchRoot, 'invalid-profile.json');
    writeFileSync(invalid, '{"schema_version":"wrong"}\n');

    const result = runLineageProfileCommand(config, 'doctor', ['--profile', invalid, '--json']);

    expect(result).toMatchObject({ ok: false, schema_version: 'lineage.profile_doctor.v1' });
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'manifest', status: 'fail' }));
  });

  it('rejects direct legacy access to a profile-bound database', () => {
    process.env.LINEAGE_DB = join(scratchRoot, 'development-main', 'lineage.sqlite');

    expect(() => resolveStartOptions(config, [])).toThrow('is bound to Lineage profile development-main/development');
  });

  it('requires confirmation for profile bind and returns its machine-readable receipt', () => {
    expect(() => runLineageProfileCommand(config, 'bind', ['--profile', 'development-main']))
      .toThrow('requires --confirm-write');
    expect(existsSync(profileWriterLockPath(resolveLineageProfile('development-main')))).toBe(false);

    const result = runLineageProfileCommand(config, 'bind', ['--profile', 'development-main', '--confirm-write']);
    expect(result).toMatchObject({
      already_bound: true,
      schema_version: 'lineage.profile_bind.v1',
      identity: { profile_id: 'development-main' },
    });
    expect(existsSync(profileWriterLockPath(resolveLineageProfile('development-main')))).toBe(false);
  });

  it('refuses profile bind while another writer owns the target profile', () => {
    const profile = resolveLineageProfile('development-main');
    const owner = acquireProfileWriterLease(profile, 'dev', 'service');

    expect(() => runLineageProfileCommand(config, 'bind', ['--profile', 'development-main', '--confirm-write']))
      .toThrow('already has an active service writer');

    owner.release();
  });

  it('exposes SQLite-safe clone through the CLI contract', async () => {
    const code = getLineageCodeIdentity('dev');
    const targetRoot = join(scratchRoot, 'development-clone');
    mkdirSync(join(targetRoot, 'media'), { recursive: true });
    writeFileSync(join(targetRoot, 'profile.json'), `${JSON.stringify({
      schema_version: 'lineage.profile.v1',
      profile_id: 'development-clone',
      environment: 'development',
      expected_runtime: { channel: 'dev', code_fingerprint: code.fingerprint, code_origin: code.origin },
      database_path: './lineage.sqlite',
      asset_root: './media',
      service_origin: 'http://lineage-clone.localhost:5298',
    }, null, 2)}\n`);
    const sourcePath = join(scratchRoot, 'clone-source.sqlite');
    const source = new DatabaseSync(sourcePath);
    source.exec('create table marker (value text); insert into marker (value) values (\'copied\')');
    source.close();

    const args = [
      '--source-db', sourcePath,
      '--target-profile', 'development-clone',
      '--confirm-write',
    ];
    const clone = runLineageProfileCommand(config, 'clone', args);
    expect(() => runLineageProfileCommand(config, 'clone', args)).toThrow('already has an active cli writer');
    const result = await clone;

    expect(result).toMatchObject({
      schema_version: 'lineage.profile_clone_receipt.v1',
      target_identity: { profile_id: 'development-clone', environment: 'development' },
    });
  });

  it('exposes no-clobber referenced-asset clone through the CLI contract and releases its writer lease', () => {
    const code = getLineageCodeIdentity('dev');
    const targetRoot = join(scratchRoot, 'development-assets');
    mkdirSync(targetRoot, { recursive: true });
    writeFileSync(join(targetRoot, 'profile.json'), `${JSON.stringify({
      schema_version: 'lineage.profile.v1',
      profile_id: 'development-assets',
      environment: 'development',
      expected_runtime: { channel: 'dev', code_fingerprint: code.fingerprint, code_origin: code.origin },
      database_path: './lineage.sqlite',
      asset_root: './media',
      service_origin: 'http://lineage-assets.localhost:5398',
    }, null, 2)}\n`);
    const target = resolveLineageProfile('development-assets');
    const database = new DatabaseSync(target.database_path);
    database.exec("create table assets (local_path text); insert into assets values ('proof.png')");
    database.close();
    const sourceRoot = join(scratchRoot, 'legacy-assets');
    mkdirSync(join(sourceRoot, '.asset-scratch'), { recursive: true });
    writeFileSync(join(sourceRoot, '.asset-scratch', 'proof.png'), 'proof');

    expect(() => runLineageProfileCommand(config, 'clone-assets', [
      '--source-asset-root', sourceRoot,
      '--target-profile', 'development-assets',
    ])).toThrow('requires --confirm-write');
    const result = runLineageProfileCommand(config, 'clone-assets', [
      '--source-asset-root', sourceRoot,
      '--target-profile', 'development-assets',
      '--confirm-write',
    ]);

    expect(result).toMatchObject({ files_copied: 1, schema_version: 'lineage.profile_assets_clone_receipt.v1' });
    expect(existsSync(profileWriterLockPath(target))).toBe(false);
  });
});

function bindDatabase(path: string, profileFingerprint: string) {
  const database = new DatabaseSync(path);
  database.exec(`
    create table lineage_profile_identity (profile_id text primary key, environment text not null, profile_fingerprint text not null, bound_at text not null);
    create table lineage_schema_migrations (key text primary key, applied_at text not null);
  `);
  database.prepare('insert into lineage_profile_identity (profile_id, environment, profile_fingerprint, bound_at) values (?, ?, ?, ?)')
    .run('development-main', 'development', profileFingerprint, '2026-07-14T00:00:00.000Z');
  database.close();
}
