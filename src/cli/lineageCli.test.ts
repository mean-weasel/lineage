import { afterEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { defaultProject, repoRoot } from '../server/assetCore';
import { indexLineageAssets } from '../server/assetLineage';
import { resolveStartOptions, runLineageDataCommand } from './lineageCli';

const originalEnv = { ...process.env };
const cliScratchDir = join(repoRoot, '.asset-scratch', 'vitest-cli');
const cliDbFile = join(cliScratchDir, 'lineage-cli.sqlite');
const fixtureRootAssetId = 'demo-meta-short-form-upload-demo-post-static';
const fixtureChildAssetId = 'demo-linkedin-ledger-catalog-shared';

afterEach(() => {
  process.env = { ...originalEnv };
});

function seedCliDb() {
  rmSync(cliScratchDir, { force: true, recursive: true });
  process.env.LINEAGE_DB = cliDbFile;
  indexLineageAssets(defaultProject);
}

describe('lineage CLI start options', () => {
  it('uses stable channel defaults with an isolated runtime home', () => {
    process.env.LINEAGE_HOME = '/tmp/lineage-home';
    delete process.env.PORT;
    delete process.env.HOST;
    delete process.env.LINEAGE_DB;

    const options = resolveStartOptions({ binName: 'lineage', channel: 'stable', defaultPort: 5197, displayName: 'Lineage' }, []);

    expect(options).toMatchObject({
      dbPath: join('/tmp/lineage-home', 'lineage.sqlite'),
      host: '127.0.0.1',
      json: false,
      open: false,
      port: 5197,
    });
  });

  it('keeps the development channel on a separate default port and database', () => {
    process.env.LINEAGE_HOME = '/tmp/lineage-dev-home';

    const options = resolveStartOptions({ binName: 'lineage-dev', channel: 'development', defaultPort: 5198, displayName: 'Lineage Dev' }, ['--json']);

    expect(options).toMatchObject({
      dbPath: join('/tmp/lineage-dev-home', 'lineage-dev.sqlite'),
      json: true,
      port: 5198,
    });
  });

  it('accepts explicit host, port, database, and open flags', () => {
    const options = resolveStartOptions(
      { binName: 'lineage', channel: 'stable', defaultPort: 5197, displayName: 'Lineage' },
      ['--host', '0.0.0.0', '--port=6123', '--db', '/tmp/custom.sqlite', '--open']
    );

    expect(options).toMatchObject({
      dbPath: '/tmp/custom.sqlite',
      host: '0.0.0.0',
      open: true,
      port: 6123,
    });
  });

  it('rejects invalid ports before spawning a server', () => {
    expect(() =>
      resolveStartOptions(
        { binName: 'lineage', channel: 'stable', defaultPort: 5197, displayName: 'Lineage' },
        ['--port', 'not-a-port']
      )
    ).toThrow('Invalid port: not-a-port');

    expect(() =>
      resolveStartOptions(
        { binName: 'lineage', channel: 'stable', defaultPort: 5197, displayName: 'Lineage' },
        ['--port', '70000']
      )
    ).toThrow('Invalid port: 70000');
  });
});

describe('lineage CLI handoff commands', () => {
  it('returns the next lineage base from the packaged CLI contract', () => {
    seedCliDb();

    const result = runLineageDataCommand('next', [
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--db', cliDbFile,
      '--json',
    ]) as { next_asset?: { asset_id: string } | null; root_asset_id: string };

    expect(result.root_asset_id).toBe(fixtureRootAssetId);
    expect(result.next_asset?.asset_id).toBe(fixtureRootAssetId);
  });

  it('inspects an indexed asset and supports the legacy doubled lineage namespace', () => {
    seedCliDb();

    const inspected = runLineageDataCommand('inspect', [
      '--project', defaultProject,
      '--asset-id', fixtureRootAssetId,
      '--db', cliDbFile,
      '--json',
    ]) as { active_asset_id: string; nodes: Array<{ asset_id: string }> };
    const legacyNext = runLineageDataCommand('next', [
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--db', cliDbFile,
      '--json',
    ]) as { root_asset_id: string };

    expect(inspected.active_asset_id).toBe(fixtureRootAssetId);
    expect(inspected.nodes.map(node => node.asset_id)).toContain(fixtureRootAssetId);
    expect(legacyNext.root_asset_id).toBe(fixtureRootAssetId);
  });

  it('dry-runs link-child and rejects unknown children before writing', () => {
    seedCliDb();

    const dryRun = runLineageDataCommand('link-child', [
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--child', fixtureChildAssetId,
      '--db', cliDbFile,
      '--json',
    ]) as { dryRun?: boolean; edge?: { child_asset_id: string; parent_asset_id: string } };

    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.edge).toMatchObject({
      child_asset_id: fixtureChildAssetId,
      parent_asset_id: fixtureRootAssetId,
    });
    expect(() =>
      runLineageDataCommand('link-child', [
        '--project', defaultProject,
        '--root', fixtureRootAssetId,
        '--child', 'missing-child',
        '--db', cliDbFile,
        '--json',
      ])
    ).toThrow('Unknown indexed asset: missing-child');
  });
});
