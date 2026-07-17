import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLineageTestProfile } from '../test/lineageTestProfile';
import { defaultProject, repoRoot } from './assetCore';
import { indexLineageAssets, linkLineageAssets, updateSelectedAsset } from './assetLineage';
import { lineageDb } from './assetLineageDb';
import { fileSha256 } from './localReview';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-lineage-selection-migration');
const dbFile = join(scratchDir, 'asset-lineage.sqlite');

function localId(file: string): string {
  return `local-${fileSha256(file).slice(0, 12)}`;
}

function seedFiles() {
  mkdirSync(scratchDir, { recursive: true });
  const parent = join(scratchDir, 'parent.png');
  const child = join(scratchDir, 'child.png');
  writeFileSync(parent, Buffer.from('selection-parent'));
  writeFileSync(child, Buffer.from('selection-child'));
  return { childId: localId(child), parentId: localId(parent) };
}

describe('asset lineage selection migration', () => {
  beforeEach(() => {
    rmSync(scratchDir, { force: true, recursive: true });
    useLineageTestProfile(dbFile);
  });

  it('drops a legacy root-level selection index from partially migrated databases', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    linkLineageAssets(defaultProject, {
      childAssetId: files.childId,
      confirmWrite: true,
      parentAssetId: files.parentId,
    });

    const legacy = lineageDb();
    legacy.exec('create unique index asset_selections_project_root_unique on asset_selections(project_id, root_asset_id)');
    legacy.close();

    updateSelectedAsset(defaultProject, {
      assetId: files.parentId,
      confirmWrite: true,
      mode: 'replace',
      rootAssetId: files.parentId,
    });
    updateSelectedAsset(defaultProject, {
      assetId: files.childId,
      confirmWrite: true,
      mode: 'add',
      rootAssetId: files.parentId,
    });

    const after = lineageDb();
    const selections = after.prepare('select asset_id, position from asset_selections order by position').all();
    const indexes = after.prepare('pragma index_list(asset_selections)').all() as Array<{ name: string }>;
    after.close();

    expect(selections).toMatchObject([{ asset_id: files.parentId, position: 0 }, { asset_id: files.childId, position: 1 }]);
    expect(indexes.map(index => index.name)).not.toContain('asset_selections_project_root_unique');
  });
});
