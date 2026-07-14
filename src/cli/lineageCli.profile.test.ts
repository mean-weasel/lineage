import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { repoRoot } from '../server/assetCore';
import { lineageProfileDoctorExitCode, lineageServiceUrl, resolveStartOptions, runLineageProfileCommand, type LineageCliConfig } from './lineageCli';

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
  mkdirSync(join(scratchRoot, 'development-main', 'media'), { recursive: true });
  writeFileSync(join(scratchRoot, 'development-main', 'profile.json'), `${JSON.stringify({
    schema_version: 'lineage.profile.v1',
    profile_id: 'development-main',
    environment: 'development',
    database_path: './lineage.sqlite',
    asset_root: './media',
    service_origin: 'http://lineage-dev.localhost:5198',
  }, null, 2)}\n`);
  bindDatabase(join(scratchRoot, 'development-main', 'lineage.sqlite'));
  process.env.LINEAGE_PROFILE_ROOT = scratchRoot;
});

afterEach(() => {
  process.env = { ...originalEnv };
  rmSync(scratchRoot, { force: true, recursive: true });
});

describe('profile-aware CLI options', () => {
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

  it('accepts equivalent named and manifest-path profile selectors', () => {
    process.env.LINEAGE_PROFILE = 'development-main';

    const options = resolveStartOptions(config, [
      '--profile',
      join(scratchRoot, 'development-main', 'profile.json'),
    ]);

    expect(options.profile?.profile_id).toBe('development-main');
  });

  it('unbrackets an IPv6 profile origin for Node server.listen()', () => {
    writeFileSync(join(scratchRoot, 'development-main', 'profile.json'), `${JSON.stringify({
      schema_version: 'lineage.profile.v1',
      profile_id: 'development-main',
      environment: 'development',
      database_path: './lineage.sqlite',
      asset_root: './media',
      service_origin: 'http://[::1]:5198',
    }, null, 2)}\n`);

    const options = resolveStartOptions(config, ['--profile', 'development-main']);

    expect(options).toMatchObject({ host: '::1', port: 5198 });
    expect(lineageServiceUrl(options.host, options.port)).toBe('http://[::1]:5198');
  });

  it('rejects direct database and asset-root overrides when a profile is selected', () => {
    expect(() => resolveStartOptions(config, ['--profile', 'development-main', '--db', join(scratchRoot, 'other.sqlite')]))
      .toThrow('cannot be combined with --db');
    expect(() => resolveStartOptions(config, ['--profile', 'development-main', '--asset-root', join(scratchRoot, 'other-media')]))
      .toThrow('cannot be combined with --asset-root');
  });

  it('rejects present but empty profile selectors instead of falling back to legacy-unbound paths', () => {
    expect(() => resolveStartOptions(config, ['--profile'])).toThrow('--profile requires a non-empty profile ID or manifest path');
    expect(() => resolveStartOptions(config, ['--profile='])).toThrow('--profile requires a non-empty profile ID or manifest path');
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
    if (result.schema_version !== 'lineage.profile_doctor.v1') throw new Error('Expected profile doctor result');
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'manifest', status: 'fail' }));
  });

  it('dry-runs and then explicitly binds a new profile database under the writer lease', () => {
    const profileRoot = join(scratchRoot, 'development-unbound');
    const databasePath = join(profileRoot, 'nested', 'lineage.sqlite');
    mkdirSync(join(profileRoot, 'media'), { recursive: true });
    writeFileSync(join(profileRoot, 'profile.json'), `${JSON.stringify({
      schema_version: 'lineage.profile.v1',
      profile_id: 'development-unbound',
      environment: 'development',
      database_path: './nested/lineage.sqlite',
      asset_root: './media',
      service_origin: 'http://lineage-dev.localhost:5298',
    }, null, 2)}\n`);

    const dryRun = runLineageProfileCommand(config, 'bind', ['--profile', 'development-unbound']);
    expect(dryRun).toMatchObject({ ok: true, dryRun: true, profile_id: 'development-unbound' });
    expect(existsSync(databasePath)).toBe(false);

    const bound = runLineageProfileCommand(config, 'bind', ['--profile', 'development-unbound', '--confirm-write']);
    expect(bound).toMatchObject({ ok: true, profile_id: 'development-unbound' });
    expect(bound).not.toHaveProperty('dryRun');
    expect(existsSync(databasePath)).toBe(true);

    const database = new DatabaseSync(databasePath, { readOnly: true });
    expect(database.prepare('select profile_id, environment from lineage_profile_identity').get())
      .toEqual({ profile_id: 'development-unbound', environment: 'development' });
    database.close();
  });

  it('refuses to rebind a database with a different immutable profile identity', () => {
    const manifestPath = join(scratchRoot, 'different-profile.json');
    writeFileSync(manifestPath, `${JSON.stringify({
      schema_version: 'lineage.profile.v1',
      profile_id: 'different-profile',
      environment: 'development',
      database_path: './development-main/lineage.sqlite',
      asset_root: './development-main/media',
      service_origin: 'http://lineage-dev.localhost:5299',
    }, null, 2)}\n`);

    expect(() => runLineageProfileCommand(config, 'bind', ['--profile', manifestPath, '--confirm-write']))
      .toThrow('already bound to a different Lineage profile identity');

    const database = new DatabaseSync(join(scratchRoot, 'development-main', 'lineage.sqlite'), { readOnly: true });
    expect(database.prepare('select profile_id, environment from lineage_profile_identity').get())
      .toEqual({ profile_id: 'development-main', environment: 'development' });
    database.close();
  });

  it('rejects direct legacy access to a profile-bound database', () => {
    process.env.LINEAGE_DB = join(scratchRoot, 'development-main', 'lineage.sqlite');

    expect(() => resolveStartOptions(config, [])).toThrow('is bound to Lineage profile development-main/development');
  });
});

function bindDatabase(path: string) {
  const database = new DatabaseSync(path);
  database.exec(`
    create table lineage_profile_identity (profile_id text primary key, environment text not null, bound_at text not null);
    create table lineage_schema_migrations (key text primary key, applied_at text not null);
  `);
  database.prepare('insert into lineage_profile_identity (profile_id, environment, bound_at) values (?, ?, ?)')
    .run('development-main', 'development', '2026-07-14T00:00:00.000Z');
  database.close();
}
