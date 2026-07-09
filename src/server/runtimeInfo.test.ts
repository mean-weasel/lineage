import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
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
      channel: 'dev',
      database: {
        exists: false,
        path: dbFile,
      },
      package_name: '@mean-weasel/lineage',
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
});
