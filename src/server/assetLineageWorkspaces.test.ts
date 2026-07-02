import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultProject, repoRoot } from './assetCore';
import { getLineageNextAsset, getLineageSnapshot, indexLineageAssets, linkLineageAssets, updateSelectedAsset } from './assetLineage';
import { archiveDemoLineageWorkspace, seedDemoLineageWorkspace } from './assetLineageDemo';
import { richBleepDemoAssets } from './assetLineageRichSeed';
import {
  activateLineageWorkspace,
  archiveLineageWorkspace,
  createLineageWorkspace,
  inspectLineageWorkspace,
  lineageWorkspaceId,
  listLineageWorkspaces,
  updateLineageWorkspace,
} from './assetLineageWorkspaces';
import { fileSha256 } from './localReview';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-lineage-workspaces');
const dbFile = join(scratchDir, 'asset-lineage-workspaces.sqlite');
const demoProject = 'vitest-lineage-demo';
const demoProjectDir = join(repoRoot, demoProject);
const demoFilesDir = join(repoRoot, '.asset-scratch', 'lineage-demo', '2026-06-lineage-demo', demoProject);
const richSeedRoot = join(scratchDir, 'rich-seed-files');

function localId(file: string): string {
  return `local-${fileSha256(file).slice(0, 12)}`;
}

function seedFiles() {
  rmSync(scratchDir, { force: true, recursive: true });
  mkdirSync(scratchDir, { recursive: true });
  const rootA = join(scratchDir, 'bleep-tiktok-hook-root-a.png');
  const childA = join(scratchDir, 'bleep-tiktok-hook-child-a.png');
  const rootB = join(scratchDir, 'bleep-linkedin-founder-root-b.png');
  const childB = join(scratchDir, 'bleep-linkedin-founder-child-b.png');
  writeFileSync(rootA, Buffer.from('workspace-root-a'));
  writeFileSync(childA, Buffer.from('workspace-child-a'));
  writeFileSync(rootB, Buffer.from('workspace-root-b'));
  writeFileSync(childB, Buffer.from('workspace-child-b'));
  return {
    childA,
    childAId: localId(childA),
    childB,
    childBId: localId(childB),
    rootA,
    rootAId: localId(rootA),
    rootB,
    rootBId: localId(rootB),
  };
}

function seedTwoLineages() {
  const files = seedFiles();
  indexLineageAssets(defaultProject);
  linkLineageAssets(defaultProject, { childAssetId: files.childAId, confirmWrite: true, parentAssetId: files.rootAId });
  linkLineageAssets(defaultProject, { childAssetId: files.childBId, confirmWrite: true, parentAssetId: files.rootBId });
  updateSelectedAsset(defaultProject, {
    assetId: files.childBId,
    confirmWrite: true,
    notes: 'Use LinkedIn branch next.',
    rootAssetId: files.rootBId,
  });
  updateSelectedAsset(defaultProject, {
    assetId: files.childAId,
    confirmWrite: true,
    notes: 'Use TikTok branch next.',
    rootAssetId: files.rootAId,
  });
  return files;
}

function seedDemoProjectCatalog() {
  mkdirSync(join(demoProjectDir, 'assets'), { recursive: true });
  writeFileSync(join(demoProjectDir, 'assets', 'catalog.json'), JSON.stringify({
    assets: [],
    default_bucket: '',
    default_region: '',
    product: demoProject,
    project: demoProject,
  }, null, 2));
}

describe('lineage workspaces', () => {
  beforeEach(() => {
    process.env.ASSET_STUDIO_DB = dbFile;
    rmSync(demoProjectDir, { force: true, recursive: true });
    rmSync(demoFilesDir, { force: true, recursive: true });
  });

  afterEach(() => {
    delete process.env.ASSET_STUDIO_RICH_SEED_ASSET_ROOT;
    rmSync(demoProjectDir, { force: true, recursive: true });
    rmSync(demoFilesDir, { force: true, recursive: true });
    rmSync(richSeedRoot, { force: true, recursive: true });
  });

  it('seeds workspace rows from existing root-scoped selections without rewriting them', () => {
    const files = seedTwoLineages();

    const snapshot = listLineageWorkspaces(defaultProject);

    expect(snapshot.workspaces.map(workspace => workspace.root_asset_id).sort()).toEqual([files.rootAId, files.rootBId].sort());
    expect(snapshot.workspaces.every(workspace => workspace.status === 'active')).toBe(true);
    expect(inspectLineageWorkspace(defaultProject, lineageWorkspaceId(defaultProject, files.rootAId))).toMatchObject({
      root_asset_id: files.rootAId,
      created_by: 'system',
    });
    expect(getLineageNextAsset(defaultProject, files.rootAId).next_asset?.asset_id).toBe(files.childAId);
    expect(getLineageNextAsset(defaultProject, files.rootBId).next_asset?.asset_id).toBe(files.childBId);
  });

  it('creates, updates, and activates explicit workspaces independently under one project', () => {
    const files = seedTwoLineages();

    const dryRun = createLineageWorkspace(defaultProject, {
      confirmWrite: false,
      notes: 'dry run only',
      rootAssetId: files.rootAId,
      title: 'TikTok hook workspace',
    });
    expect(dryRun).toMatchObject({ dryRun: true, workspace: { title: 'TikTok hook workspace' } });

    const saved = createLineageWorkspace(defaultProject, {
      activate: true,
      confirmWrite: true,
      notes: 'vertical hook exploration',
      rootAssetId: files.rootAId,
      title: 'TikTok hook workspace',
    });
    expect(saved.workspace).toMatchObject({
      notes: 'vertical hook exploration',
      root_asset_id: files.rootAId,
      status: 'active',
      title: 'TikTok hook workspace',
    });

    const updated = updateLineageWorkspace(defaultProject, saved.workspace!.id, {
      confirmWrite: true,
      notes: 'paused while reviewing',
      status: 'paused',
      title: 'TikTok paused workspace',
    });
    expect(updated.workspace).toMatchObject({
      notes: 'paused while reviewing',
      status: 'paused',
      title: 'TikTok paused workspace',
    });

    const linkedIn = createLineageWorkspace(defaultProject, {
      activate: true,
      confirmWrite: true,
      rootAssetId: files.rootBId,
      title: 'LinkedIn founder workspace',
    });
    const active = activateLineageWorkspace(defaultProject, linkedIn.workspace!.id, true);

    expect(active.workspace).toMatchObject({ root_asset_id: files.rootBId, status: 'active' });
    const snapshot = listLineageWorkspaces(defaultProject);
    expect(snapshot.active_workspace?.root_asset_id).toBe(files.rootBId);
    expect(snapshot.workspaces.map(workspace => workspace.root_asset_id)).toContain(files.rootAId);
    expect(snapshot.workspaces.map(workspace => workspace.root_asset_id)).toContain(files.rootBId);
  });

  it('uses active workspace root before latest selected root for rootless lineage next', () => {
    const files = seedTwoLineages();
    createLineageWorkspace(defaultProject, {
      activate: true,
      confirmWrite: true,
      rootAssetId: files.rootAId,
      title: 'TikTok workspace',
    });
    createLineageWorkspace(defaultProject, {
      activate: true,
      confirmWrite: true,
      rootAssetId: files.rootBId,
      title: 'LinkedIn workspace',
    });

    const next = getLineageNextAsset(defaultProject);

    expect(next.root_asset_id).toBe(files.rootBId);
    expect(next.next_asset?.asset_id).toBe(files.childBId);
    expect(next.selection?.notes).toBe('Use LinkedIn branch next.');
  });

  it('archives a workspace and clears its selected next variation', () => {
    const files = seedTwoLineages();
    const saved = createLineageWorkspace(defaultProject, {
      activate: true,
      confirmWrite: true,
      rootAssetId: files.rootAId,
      title: 'Workspace to archive',
    });

    const archived = archiveLineageWorkspace(defaultProject, saved.workspace!.id, true);

    expect(archived.workspace).toMatchObject({ status: 'archived', active_at: undefined });
    expect(getLineageNextAsset(defaultProject, files.rootAId)).toMatchObject({
      selected: [],
      selection: null,
    });
  });

  it('seeds and archives a repeatable demo workspace', () => {
    seedDemoProjectCatalog();

    const dryRun = seedDemoLineageWorkspace(demoProject, { confirmWrite: false });
    expect(dryRun).toMatchObject({ dryRun: true });
    expect(existsSync(demoFilesDir)).toBe(false);

    const seeded = seedDemoLineageWorkspace(demoProject, { confirmWrite: true });
    expect(seeded.workspace).toMatchObject({
      status: 'active',
      title: 'Demo: Content iteration tree',
    });
    expect(existsSync(demoFilesDir)).toBe(true);
    expect(getLineageNextAsset(demoProject).strategy).toBe('selected');

    const archived = archiveDemoLineageWorkspace(demoProject, true);
    expect(archived.archived.workspace).toMatchObject({ status: 'archived' });
    expect(existsSync(demoFilesDir)).toBe(false);
    expect(listLineageWorkspaces(demoProject).active_workspace).toBeNull();
  });

  it('uses the rich Bleep graph and screenshots as the single default seed', () => {
    process.env.ASSET_STUDIO_RICH_SEED_ASSET_ROOT = richSeedRoot;
    for (const [assetId, localPath] of richBleepDemoAssets) {
      const file = join(richSeedRoot, localPath);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `rich-seed-${assetId}`);
    }

    const seeded = seedDemoLineageWorkspace(defaultProject, { confirmWrite: true });
    const snapshot = getLineageSnapshot(defaultProject, seeded.root_asset_id);
    const next = getLineageNextAsset(defaultProject, seeded.root_asset_id);

    expect(seeded.workspace).toMatchObject({
      root_asset_id: 'local-e88bc3fcd9e8',
      title: 'Bleep LinkedIn dogfood round 02 grounded',
    });
    expect(snapshot.nodes).toHaveLength(19);
    expect(snapshot.edges).toHaveLength(18);
    expect(snapshot.nodes.every(node => node.preview_url?.includes('/api/assets/local-preview?'))).toBe(true);
    expect(snapshot.nodes.some(node => node.local_path?.includes('lineage-demo'))).toBe(false);
    expect(next.selected).toEqual(['local-0809da1e2b16']);

    const archived = archiveDemoLineageWorkspace(defaultProject, true);
    expect(archived.archived.workspace).toMatchObject({ status: 'archived' });
  });

  it('restores rich Bleep seed media before seeding the default workspace', () => {
    process.env.ASSET_STUDIO_RICH_SEED_ASSET_ROOT = richSeedRoot;

    const seeded = seedDemoLineageWorkspace(defaultProject, { confirmWrite: true });
    const snapshot = getLineageSnapshot(defaultProject, seeded.root_asset_id);
    const next = getLineageNextAsset(defaultProject, seeded.root_asset_id);

    expect(seeded.summary).toMatchObject({ local: 19, total: 19 });
    expect(snapshot.nodes).toHaveLength(19);
    expect(snapshot.edges).toHaveLength(18);
    expect(snapshot.nodes.every(node => existsSync(join(richSeedRoot, node.local_path || '')))).toBe(true);
    expect(next.selected).toEqual(['local-0809da1e2b16']);
  });
});
