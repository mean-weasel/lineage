import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultProject, defaultProduct, listAssets, listProjects, localPreviewPath, presignAsset, previewPlacement, repoRoot } from './assetCore';
import { initProject } from './assetProjects';

describe('asset core catalog listing', () => {
  it('discovers product-backed catalogs as projects', () => {
    const projects = listProjects();
    const project = projects.find(item => item.project === defaultProject);

    expect(project).toBeTruthy();
    expect(project?.product).toBe(defaultProduct);
    expect(project?.asset_count).toBeGreaterThan(0);
  });

  it('initializes a project catalog idempotently without assets or S3 writes', () => {
    const project = 'vitest-project-init';
    const projectDir = join(repoRoot, project);
    const catalogFile = join(projectDir, 'assets', 'catalog.json');
    rmSync(projectDir, { force: true, recursive: true });

    try {
      const created = initProject(project, {
        defaultBucket: 'lineage-demo-assets',
        defaultRegion: 'us-east-1',
        product: 'Vitest Project Init',
      });
      const again = initProject(project, { product: 'Ignored Product' });
      const catalog = JSON.parse(readFileSync(catalogFile, 'utf8')) as { assets: unknown[]; product: string; project: string };

      expect(created.created).toBe(true);
      expect(created.project).toMatchObject({ asset_count: 0, default_region: 'us-east-1', project });
      expect(again.created).toBe(false);
      expect(again.project.asset_count).toBe(0);
      expect(catalog).toMatchObject({ assets: [], product: 'Vitest Project Init', project });
    } finally {
      rmSync(projectDir, { force: true, recursive: true });
    }
  });

  it('rejects invalid project names before scaffolding', () => {
    expect(() => initProject('Not Valid')).toThrow('Project must be lowercase kebab-case');
  });

  it('paginates catalog assets without listing S3 by default', () => {
    const snapshot = listAssets(defaultProduct, { page: 1, pageSize: 5 });

    expect(snapshot.catalog.project).toBe(defaultProject);
    expect(snapshot.assets).toHaveLength(5);
    expect(snapshot.assets.every(asset => asset.project === defaultProject)).toBe(true);
    expect(snapshot.pagination.page).toBe(1);
    expect(snapshot.pagination.pageSize).toBe(5);
    expect(snapshot.pagination.total).toBeGreaterThan(5);
    expect(snapshot.liveObjects).toHaveLength(0);
    expect(snapshot.orphanObjects).toHaveLength(0);
  });

  it('filters catalog assets server-side', () => {
    const firstPage = listAssets(defaultProduct, { page: 1, pageSize: 10 });
    const channel = firstPage.assets[0]?.channel;
    const audience = firstPage.assets[0]?.audience;
    const campaign = firstPage.assets[0]?.campaign;
    const snapshot = listAssets(defaultProduct, { audience, campaign, channel, page: 1, pageSize: 10 });

    expect(channel).toBeTruthy();
    expect(audience).toBeTruthy();
    expect(campaign).toBeTruthy();
    expect(snapshot.assets.length).toBeGreaterThan(0);
    expect(snapshot.assets.every(asset => asset.channel === channel)).toBe(true);
    expect(snapshot.assets.every(asset => asset.audience === audience)).toBe(true);
    expect(snapshot.assets.every(asset => asset.campaign === campaign)).toBe(true);
    expect(snapshot.pagination.total).toBe(snapshot.assets.length);
  });

  it('lists local pre-push assets without cataloging them', () => {
    const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-local-review');
    const file = join(scratchDir, 'demo-tiktok-local-prepush.png');
    rmSync(scratchDir, { force: true, recursive: true });
    mkdirSync(scratchDir, { recursive: true });
    writeFileSync(file, Buffer.from('local-review-only'));

    try {
      const snapshot = listAssets(defaultProduct, { page: 1, pageSize: 100, query: 'local-prepush', source: 'local' });
      const asset = snapshot.assets.find(item => item.local?.relative_path === 'vitest-local-review/demo-tiktok-local-prepush.png');

      expect(asset).toBeTruthy();
      expect(asset?.source).toBe('local');
      expect(asset?.s3).toBeUndefined();
      expect(asset?.channel).toBe('tiktok');
      expect(asset?.status).toBe('planned');
      expect(snapshot.catalog.asset_count).toBeGreaterThan(0);
      expect(localPreviewPath(asset!.local!.relative_path)).toBe(file);
    } finally {
      rmSync(scratchDir, { force: true, recursive: true });
    }
  });

  it('previews placement metadata without mutating the catalog', () => {
    const firstAsset = listAssets(defaultProject, { page: 1, pageSize: 1 }).assets[0];
    const preview = previewPlacement(defaultProject, {
      assetId: firstAsset.asset_id,
      channel: firstAsset.channel,
      confirmWrite: false,
      scheduledAt: '2026-06-24T16:00:00-07:00',
      status: 'scheduled',
    });

    expect(preview.asset_id).toBe(firstAsset.asset_id);
    expect(preview.placement).toMatchObject({
      channel: firstAsset.channel,
      scheduled_at: '2026-06-24T16:00:00-07:00',
      status: 'scheduled',
    });
  });

  it('presigns public fallback assets with a local data URL without external scripts', () => {
    const originalPath = process.env.PATH;
    const blockedPath = join(repoRoot, '.asset-scratch', 'vitest-empty-path');
    rmSync(blockedPath, { force: true, recursive: true });
    mkdirSync(blockedPath, { recursive: true });
    process.env.PATH = blockedPath;

    try {
      const preview = presignAsset(defaultProject, 'demo-meta-short-form-upload-demo-post-static', 123);
      const encoded = preview.url.replace(/^data:image\/svg\+xml;base64,/, '');
      const svg = Buffer.from(encoded, 'base64').toString('utf8');

      expect(preview).toMatchObject({
        assetId: 'demo-meta-short-form-upload-demo-post-static',
        expiresIn: 123,
      });
      expect(preview.url).toMatch(/^data:image\/svg\+xml;base64,/);
      expect(svg).toContain('Lineage public demo preview');
      expect(svg).toContain('No external storage requested');
    } finally {
      process.env.PATH = originalPath;
      rmSync(blockedPath, { force: true, recursive: true });
    }
  });

  it('rejects missing public fallback assets without external scripts', () => {
    const originalPath = process.env.PATH;
    const blockedPath = join(repoRoot, '.asset-scratch', 'vitest-empty-path-missing');
    rmSync(blockedPath, { force: true, recursive: true });
    mkdirSync(blockedPath, { recursive: true });
    process.env.PATH = blockedPath;

    try {
      expect(() => presignAsset(defaultProject, 'missing-fallback-asset')).toThrow('Unknown asset: missing-fallback-asset');
    } finally {
      process.env.PATH = originalPath;
      rmSync(blockedPath, { force: true, recursive: true });
    }
  });

  it('filters by placement status from catalog metadata', () => {
    const allAssets = listAssets(defaultProject, { page: 1, pageSize: 100 }).assets;
    const expectedPosted = allAssets.filter(asset => asset.placements?.some(placement => placement.status === 'posted')).length;
    const expectedNotPosted = allAssets.filter(asset => !asset.placements?.some(placement => placement.status === 'posted')).length;

    expect(listAssets(defaultProject, { page: 1, pageSize: 100, placementStatus: 'posted' }).pagination.total).toBe(expectedPosted);
    expect(listAssets(defaultProject, { page: 1, pageSize: 100, placementStatus: 'not-posted' }).pagination.total).toBe(expectedNotPosted);
  });

  it('rejects unsupported placement statuses before writing', () => {
    const firstAsset = listAssets(defaultProject, { page: 1, pageSize: 1 }).assets[0];

    expect(() =>
      previewPlacement(defaultProject, {
        assetId: firstAsset.asset_id,
        channel: firstAsset.channel,
        confirmWrite: false,
        status: 'queued' as never,
      })
    ).toThrow('Unsupported placement status');
  });
});
