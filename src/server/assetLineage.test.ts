import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultProject, repoRoot } from './assetCore';
import { lineageDb } from './assetLineageDb';
import { fileSha256 } from './localReview';
import {
  getLineageSnapshot,
  getLineageNextAsset,
  getLineageChildren,
  indexLineageAssets,
  linkLineageAssets,
  updateAssetReview,
  updateLineageLayout,
  updateSelectedAsset,
} from './assetLineage';
import { getLineageBrief, linkSelectedLineageChild } from './assetLineageHandoff';

const require = createRequire(import.meta.url);
const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-lineage');
const dbFile = join(scratchDir, 'asset-lineage.sqlite');
function localId(file: string): string {
  return `local-${fileSha256(file).slice(0, 12)}`;
}

function seedFiles() {
  rmSync(scratchDir, { force: true, recursive: true });
  mkdirSync(scratchDir, { recursive: true });
  const parent = join(scratchDir, 'bleep-linkedin-lineage-parent.png');
  const child = join(scratchDir, 'bleep-linkedin-lineage-child.png');
  const variation = join(scratchDir, 'bleep-linkedin-lineage-variation.png');
  const alternate = join(scratchDir, 'bleep-linkedin-lineage-alternate.png');
  writeFileSync(parent, Buffer.from('lineage-parent'));
  writeFileSync(child, Buffer.from('lineage-child'));
  writeFileSync(variation, Buffer.from('lineage-variation'));
  writeFileSync(alternate, Buffer.from('lineage-alternate'));
  return {
    alternate, alternateId: localId(alternate),
    child, childId: localId(child),
    parent, parentId: localId(parent),
    variation, variationId: localId(variation),
  };
}

describe('asset lineage index', () => {
  beforeEach(() => {
    process.env.ASSET_STUDIO_DB = dbFile;
  });

  it('indexes local assets, links lineage, and computes latest leaves', () => {
    const files = seedFiles();
    const summary = indexLineageAssets(defaultProject);

    expect(summary.local).toBeGreaterThanOrEqual(2);
    expect(summary.database).toBe(dbFile);

    const dryRun = linkLineageAssets(defaultProject, {
      childAssetId: files.childId,
      confirmWrite: false,
      parentAssetId: files.parentId,
    });
    expect(dryRun).toMatchObject({ dryRun: true, ok: true });

    linkLineageAssets(defaultProject, {
      childAssetId: files.childId,
      confirmWrite: true,
      parentAssetId: files.parentId,
    });
    updateSelectedAsset(defaultProject, { assetId: files.childId, confirmWrite: true });

    const snapshot = getLineageSnapshot(defaultProject, files.parentId);

    expect(snapshot.root_asset_id).toBe(files.parentId);
    expect(snapshot.edges).toHaveLength(1);
    expect(snapshot.latest).toEqual([files.childId]);
    expect(snapshot.selected).toEqual([files.childId]);
    expect(snapshot.nodes.find(node => node.asset_id === files.childId)).toMatchObject({
      is_latest: true,
      user_selected: true,
    });
  });

  it('persists review state for indexed assets', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);

    updateAssetReview(defaultProject, {
      assetId: files.parentId,
      confirmWrite: true,
      notes: 'Not the cleanest branch.',
      reviewState: 'rejected',
    });

    const snapshot = getLineageSnapshot(defaultProject, files.parentId);
    expect(snapshot.nodes.find(node => node.asset_id === files.parentId)?.review_state).toBe('rejected');
  });

  it('persists needs-revision review state for indexed local assets', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);

    updateAssetReview(defaultProject, {
      assetId: files.parentId,
      confirmWrite: true,
      notes: 'Composition is useful, but the CTA needs another pass.',
      reviewState: 'needs_revision',
    });

    const snapshot = getLineageSnapshot(defaultProject, files.parentId);
    expect(snapshot.nodes.find(node => node.asset_id === files.parentId)).toMatchObject({
      review_notes: 'Composition is useful, but the CTA needs another pass.',
      review_state: 'needs_revision',
    });
  });

  it('returns the next asset to evolve from selected state or latest fallback', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    linkLineageAssets(defaultProject, {
      childAssetId: files.childId,
      confirmWrite: true,
      parentAssetId: files.parentId,
    });

    const fallback = getLineageNextAsset(defaultProject, files.parentId);
    expect(fallback.strategy).toBe('single_latest');
    expect(fallback.recommended_action).toBe('evolve_variations');
    expect(fallback.reason).toBe('single_latest_fallback');
    expect(fallback.next_asset?.asset_id).toBe(files.childId);

    updateSelectedAsset(defaultProject, { assetId: files.parentId, confirmWrite: true });

    const selected = getLineageNextAsset(defaultProject, files.parentId);
    expect(selected.strategy).toBe('selected');
    expect(selected.reason).toBe('user_selected');
    expect(selected.next_asset?.asset_id).toBe(files.parentId);
    expect(selected.warnings).toContain('Selected asset is not a latest leaf; agents should treat this as an intentional branch choice.');

    const branchBrief = getLineageBrief(defaultProject, files.parentId);
    expect(branchBrief.next_asset?.asset_id).toBe(files.parentId);
    expect(branchBrief.warnings).toContain('Selected asset is not a latest leaf; agents should treat this as an intentional branch choice.');
    expect(branchBrief.brief.prompt).toContain(`Create 3-4 variations from asset ${files.parentId}`);
  });

  it('returns direct lineage children for an indexed parent', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    linkLineageAssets(defaultProject, {
      childAssetId: files.childId,
      confirmWrite: true,
      parentAssetId: files.parentId,
    });

    const result = getLineageChildren(defaultProject, files.parentId);

    expect(result.parent_asset_id).toBe(files.parentId);
    expect(result.children.map(child => child.asset_id)).toEqual([files.childId]);
    expect(result.edges).toHaveLength(1);
  });

  it('persists graph layout and next-base rationale for snapshots', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    linkLineageAssets(defaultProject, {
      childAssetId: files.childId,
      confirmWrite: true,
      parentAssetId: files.parentId,
    });

    updateLineageLayout(defaultProject, {
      confirmWrite: true,
      rootAssetId: files.parentId,
      positions: [{ assetId: files.childId, x: 320, y: 180 }],
    });
    updateSelectedAsset(defaultProject, {
      assetId: files.childId,
      confirmWrite: true,
      notes: 'Best expression for the next branch.',
      rootAssetId: files.parentId,
    });

    const snapshot = getLineageSnapshot(defaultProject, files.parentId);
    const child = snapshot.nodes.find(node => node.asset_id === files.childId);

    expect(snapshot.selection).toMatchObject({
      asset_id: files.childId,
      notes: 'Best expression for the next branch.',
    });
    expect(child).toMatchObject({
      position: { x: 320, y: 180 },
      preview_url: expect.stringContaining('/api/assets/local-preview?'),
      selection_note: 'Best expression for the next branch.',
    });
  });

  it('migrates a legacy single selected asset row into ordered multi-selection storage', () => {
    const files = seedFiles();
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const database = new DatabaseSync(dbFile);
    database.exec(`
      create table projects (
        id text primary key,
        product text not null,
        catalog_path text,
        created_at text not null,
        updated_at text not null
      );
      create table assets (
        id text primary key,
        project_id text not null references projects(id),
        source text not null check (source in ('local', 'catalog')),
        local_path text,
        s3_key text,
        checksum_sha256 text,
        media_type text not null,
        title text not null,
        status text not null,
        channel text,
        campaign text,
        audience text,
        size_bytes integer,
        content_type text,
        created_at text not null,
        updated_at text not null,
        last_seen_at text not null
      );
      create table asset_selections (
        id text primary key,
        project_id text not null references projects(id),
        root_asset_id text not null references assets(id),
        asset_id text not null references assets(id),
        notes text,
        selected_at text not null,
        unique(project_id, root_asset_id)
      );
      insert into projects (id, product, catalog_path, created_at, updated_at)
      values ('${defaultProject}', '${defaultProject}', null, '2026-06-29T00:00:00.000Z', '2026-06-29T00:00:00.000Z');
      insert into assets (id, project_id, source, local_path, s3_key, checksum_sha256, media_type, title, status, channel, campaign, audience, size_bytes, content_type, created_at, updated_at, last_seen_at)
      values
        ('${files.parentId}', '${defaultProject}', 'local', 'parent.png', null, null, 'image', 'Parent', 'working', 'linkedin', 'campaign', 'audience', 1, 'image/png', '2026-06-29T00:00:00.000Z', '2026-06-29T00:00:00.000Z', '2026-06-29T00:00:00.000Z'),
        ('${files.childId}', '${defaultProject}', 'local', 'child.png', null, null, 'image', 'Child', 'working', 'linkedin', 'campaign', 'audience', 1, 'image/png', '2026-06-29T00:00:00.000Z', '2026-06-29T00:00:00.000Z', '2026-06-29T00:00:00.000Z');
      insert into asset_selections (id, project_id, root_asset_id, asset_id, notes, selected_at)
      values ('legacy-selection', '${defaultProject}', '${files.parentId}', '${files.parentId}', 'Legacy selected row.', '2026-06-29T00:00:00.000Z');
    `);
    database.close();

    const migrated = lineageDb();
    const columns = migrated.prepare('pragma table_info(asset_selections)').all() as Array<{ name: string }>;
    const rows = migrated.prepare('select asset_id, notes, position from asset_selections order by position').all() as Array<{ asset_id: string; notes: string; position: number }>;
    migrated.close();

    expect(columns.map(column => column.name)).toContain('position');
    expect(rows).toEqual([{ asset_id: files.parentId, notes: 'Legacy selected row.', position: 0 }]);

    updateSelectedAsset(defaultProject, {
      assetId: files.childId,
      confirmWrite: true,
      mode: 'add',
      rootAssetId: files.parentId,
    });

    const after = lineageDb();
    const selections = after.prepare('select asset_id, notes, position from asset_selections order by position').all();
    after.close();
    expect(selections).toMatchObject([
      { asset_id: files.parentId, notes: 'Legacy selected row.', position: 0 },
      { asset_id: files.childId, position: 1 },
    ]);
  });

  it('returns ordered multi-selected next variation bases in the lineage snapshot and next response', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    linkLineageAssets(defaultProject, {
      childAssetId: files.childId,
      confirmWrite: true,
      parentAssetId: files.parentId,
    });
    linkLineageAssets(defaultProject, {
      childAssetId: files.variationId,
      confirmWrite: true,
      parentAssetId: files.parentId,
    });

    updateSelectedAsset(defaultProject, {
      assetIds: [files.childId, files.variationId],
      confirmWrite: true,
      mode: 'replace',
      rootAssetId: files.parentId,
    });

    const snapshot = getLineageSnapshot(defaultProject, files.parentId);
    expect(snapshot.selected).toEqual([files.childId, files.variationId]);
    expect(snapshot.selections.map(selection => selection.asset_id)).toEqual([files.childId, files.variationId]);
    expect(snapshot.selection?.asset_id).toBe(files.childId);
    expect(new Set(snapshot.nodes.filter(node => node.user_selected).map(node => node.asset_id))).toEqual(new Set([files.childId, files.variationId]));

    const next = getLineageNextAsset(defaultProject, files.parentId);
    expect(next.strategy).toBe('selected');
    expect(next.selection_mode).toBe('multiple');
    expect(next.next_asset?.asset_id).toBe(files.childId);
    expect(next.next_assets.map(asset => asset.asset_id)).toEqual([files.childId, files.variationId]);
  });

  it('caps next variation selection at three assets on the server boundary', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);

    expect(() => updateSelectedAsset(defaultProject, {
      assetIds: [files.parentId, files.childId, files.variationId, files.alternateId],
      confirmWrite: true,
      maxSelections: 3,
      mode: 'replace',
      rootAssetId: files.parentId,
    })).toThrow('Select at most 3 assets for next variation');
  });

  it('adds, removes, toggles, and clears selected next variation assets independently', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);

    updateSelectedAsset(defaultProject, { assetId: files.parentId, confirmWrite: true, mode: 'add', rootAssetId: files.parentId });
    updateSelectedAsset(defaultProject, { assetId: files.childId, confirmWrite: true, mode: 'add', rootAssetId: files.parentId });
    expect(getLineageSnapshot(defaultProject, files.parentId).selected).toEqual([files.parentId, files.childId]);

    updateSelectedAsset(defaultProject, { assetId: files.parentId, confirmWrite: true, mode: 'remove', rootAssetId: files.parentId });
    expect(getLineageSnapshot(defaultProject, files.parentId).selected).toEqual([files.childId]);

    updateSelectedAsset(defaultProject, { assetId: files.childId, confirmWrite: true, mode: 'toggle', rootAssetId: files.parentId });
    expect(getLineageSnapshot(defaultProject, files.parentId).selected).toEqual([]);

    updateSelectedAsset(defaultProject, { assetIds: [files.parentId, files.childId], confirmWrite: true, mode: 'replace', rootAssetId: files.parentId });
    updateSelectedAsset(defaultProject, { clear: true, confirmWrite: true, rootAssetId: files.parentId });
    expect(getLineageSnapshot(defaultProject, files.parentId).selected).toEqual([]);
  });

  it('creates an agent brief from multiple selected next variation bases', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    linkLineageAssets(defaultProject, {
      childAssetId: files.childId,
      confirmWrite: true,
      parentAssetId: files.parentId,
    });
    updateSelectedAsset(defaultProject, {
      assetIds: [files.parentId, files.childId],
      confirmWrite: true,
      mode: 'replace',
      notes: 'Blend the strongest pieces.',
      rootAssetId: files.parentId,
    });

    const brief = getLineageBrief(defaultProject, files.parentId);
    expect(brief.selection_mode).toBe('multiple');
    expect(brief.next_assets.map(asset => asset.asset_id)).toEqual([files.parentId, files.childId]);
    expect(brief.brief.reference_asset_ids).toEqual([files.parentId, files.childId]);
    expect(brief.brief.prompt).toContain(`Create 3-4 variations using these 2 selected references: ${files.parentId}, ${files.childId}`);
    expect(brief.brief.prompt).toContain('Blend the strongest pieces.');
    expect(brief.handoff.link_child_command).toContain('lineage link-child');
  });

  it('creates an agent brief and links a generated child from the selected base', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    linkLineageAssets(defaultProject, {
      childAssetId: files.childId,
      confirmWrite: true,
      parentAssetId: files.parentId,
    });
    updateSelectedAsset(defaultProject, {
      assetId: files.childId,
      confirmWrite: true,
      notes: 'Use the cleanest concept for the next branch.',
      rootAssetId: files.parentId,
    });

    const brief = getLineageBrief(defaultProject, files.parentId);
    expect(brief.next_asset?.asset_id).toBe(files.childId);
    expect(brief.brief.prompt).toContain('Use the cleanest concept');
    expect(brief.handoff.link_child_command).toContain('lineage link-child');

    const dryRun = linkSelectedLineageChild(defaultProject, {
      childAssetId: files.variationId,
      confirmWrite: false,
      rootAssetId: files.parentId,
    });
    expect(dryRun).toMatchObject({ dryRun: true, parent_asset_id: files.childId });

    linkSelectedLineageChild(defaultProject, {
      childAssetId: files.variationId,
      confirmWrite: true,
      rootAssetId: files.parentId,
    });

    const children = getLineageChildren(defaultProject, files.childId);
    expect(children.children.map(child => child.asset_id)).toEqual([files.variationId]);
  });
});
