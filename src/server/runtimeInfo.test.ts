import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { defaultProject, repoRoot } from './assetCore';
import { indexLineageAssets } from './assetLineage';
import { getLineageRuntimeInfo, normalizeRuntimeChannel } from './runtimeInfo';

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
    indexLineageAssets(defaultProject);

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

  it('reports the same bound profile identity and schema that the runtime UI consumes', () => {
    process.env.LINEAGE_DB = dbFile;
    indexLineageAssets(defaultProject);
    const database = new DatabaseSync(dbFile);
    database.exec('create table lineage_profile_identity (profile_id text primary key, environment text not null, bound_at text not null)');
    database.prepare('insert into lineage_profile_identity (profile_id, environment, bound_at) values (?, ?, ?)')
      .run('development-main', 'development', '2026-07-14T00:00:00.000Z');
    database.close();
    process.env.LINEAGE_PROFILE_ID = 'development-main';
    process.env.LINEAGE_PROFILE_ENVIRONMENT = 'development';
    process.env.LINEAGE_PROFILE_MANIFEST = '/runtime/profile.json';
    process.env.LINEAGE_PROFILE_SERVICE_ORIGIN = 'http://lineage-dev.localhost:5198';
    process.env.LINEAGE_PROFILE = '/runtime/profile.json';

    const runtime = getLineageRuntimeInfo({ channel: 'dev', dbPath: dbFile });

    expect(runtime.profile).toEqual({
      bound: true,
      environment: 'development',
      id: 'development-main',
      manifest_path: '/runtime/profile.json',
      service_origin: 'http://lineage-dev.localhost:5198',
    });
    expect(runtime.schema).toMatchObject({
      profile_id: 'development-main',
      profile_environment: 'development',
    });
  });
});
