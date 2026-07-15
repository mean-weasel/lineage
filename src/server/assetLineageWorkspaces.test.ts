import express, { type Express } from 'express';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultProject, listAssets, repoRoot } from './assetCore';
import { getLineageAttempts, getLineageNextAsset, getLineageSnapshot, indexLineageAssets, linkLineageAssets, updateSelectedAsset } from './assetLineage';
import {
  archiveDemoLineageWorkspace,
  demoSeedMediaStatus,
  downloadSwissifierRichDemoMedia,
  restoreDemoSeedMedia,
  restoreSwissifierRichDemoMedia,
  seedDemoLineageWorkspace,
  seedSwissifierRichDemoWorkspace,
  swissifierRichDemoMediaStatus,
} from './assetLineageDemo';
import {
  activateLineageWorkspace,
  archiveLineageWorkspace,
  createLineageWorkspace,
  inspectLineageWorkspace,
  lineageWorkspaceId,
  listLineageWorkspaces,
  updateLineageWorkspace,
} from './assetLineageWorkspaces';
import { registerLineageWorkspaceRoutes } from './lineageWorkspaceRoutes';
import { fileSha256 } from './localReview';
import { lineageDb } from './assetLineageDb';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-lineage-workspaces');
const dbFile = join(scratchDir, 'asset-lineage-workspaces.sqlite');
const demoProject = 'vitest-lineage-demo';
const demoProjectDir = join(repoRoot, demoProject);
const demoFilesDir = join(repoRoot, '.asset-scratch', 'lineage-demo', '2026-06-lineage-demo', demoProject);
const defaultDemoFilesDir = join(repoRoot, '.asset-scratch', 'lineage-demo', '2026-06-lineage-demo', defaultProject);
let server: ReturnType<Express['listen']> | null = null;

function localId(file: string): string {
  return `local-${fileSha256(file).slice(0, 12)}`;
}

function seedFiles() {
  rmSync(scratchDir, { force: true, recursive: true });
  mkdirSync(scratchDir, { recursive: true });
  const rootA = join(scratchDir, 'demo-tiktok-hook-root-a.png');
  const childA = join(scratchDir, 'demo-tiktok-hook-child-a.png');
  const rootB = join(scratchDir, 'demo-linkedin-founder-root-b.png');
  const childB = join(scratchDir, 'demo-linkedin-founder-child-b.png');
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

function projectFrom(input: { body?: Record<string, unknown>; query?: Record<string, unknown> }): string {
  const candidate = input.body?.project || input.query?.project;
  return typeof candidate === 'string' ? candidate : defaultProject;
}

function asyncRoute(handler: (req: express.Request, res: express.Response) => Promise<void> | void): express.RequestHandler {
  return (req, res, next) => { Promise.resolve(handler(req, res)).catch(next); };
}

function appWithLineageWorkspaceRoutes() {
  const app = express();
  app.use(express.json());
  registerLineageWorkspaceRoutes(app, projectFrom, asyncRoute);
  server = app.listen(0);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function bufferServer(body: Buffer, status = 200) {
  server = createServer((_req, res) => {
    res.statusCode = status;
    res.setHeader('content-length', String(body.length));
    res.end(body);
  }).listen(0);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/swissifier-rich-demo-v1.tar.gz`;
}

function sha256(body: Buffer | string): string {
  return createHash('sha256').update(body).digest('hex');
}

function tarGz(entries: Array<{ name: string; body: Buffer; typeflag?: string }>) {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100, 'utf8');
    header.write('0000644\0', 100, 8, 'ascii');
    header.write('0000000\0', 108, 8, 'ascii');
    header.write('0000000\0', 116, 8, 'ascii');
    header.write(`${entry.body.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
    header.write('00000000000\0', 136, 12, 'ascii');
    header.fill(' ', 148, 156);
    header.write(entry.typeflag || '0', 156, 1, 'ascii');
    header.write('ustar\0', 257, 6, 'ascii');
    const checksum = [...header].reduce((sum, value) => sum + value, 0);
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
    chunks.push(header, entry.body);
    const padding = (512 - (entry.body.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}

async function postJson<T>(baseUrl: string, path: string, body: Record<string, unknown>): Promise<{ body: T; status: number }> {
  const response = await fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  return { body: await response.json() as T, status: response.status };
}

describe('lineage workspaces', () => {
  beforeEach(() => {
    process.env.LINEAGE_DB = dbFile;
    rmSync(demoProjectDir, { force: true, recursive: true });
    rmSync(demoFilesDir, { force: true, recursive: true });
  });

  afterEach(() => {
    server?.close();
    server = null;
    rmSync(demoProjectDir, { force: true, recursive: true });
    rmSync(demoFilesDir, { force: true, recursive: true });
    rmSync(defaultDemoFilesDir, { force: true, recursive: true });
  });

  it('indexes catalog assets before creating a workspace through the HTTP route', async () => {
    const catalogAsset = listAssets(defaultProject, { source: 'catalog', page: 1, pageSize: 1 }).assets[0];
    const baseUrl = appWithLineageWorkspaceRoutes();

    const created = await postJson<{ workspace?: { root_asset_id: string; title: string } }>(baseUrl, '/api/lineage-workspaces', {
      confirmWrite: true,
      project: defaultProject,
      rootAssetId: catalogAsset.asset_id,
      title: 'Catalog root workspace',
    });

    expect(created.status).toBe(200);
    expect(created.body.workspace).toMatchObject({
      root_asset_id: catalogAsset.asset_id,
      title: 'Catalog root workspace',
    });
    expect(getLineageSnapshot(defaultProject, catalogAsset.asset_id).nodes[0]).toMatchObject({
      asset_id: catalogAsset.asset_id,
      source: 'catalog',
    });
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

  it('infers adopted legacy workspaces without writes when a profile command opens the database read-only', () => {
    const files = seedTwoLineages();
    const database = lineageDb();
    database.exec('delete from lineage_workspaces');
    database.close();
    process.env.LINEAGE_DB_ACCESS = 'read-only';
    try {
      const snapshot = listLineageWorkspaces(defaultProject);

      expect(snapshot.active_workspace).not.toBeNull();
      expect(snapshot.workspaces.map(workspace => workspace.root_asset_id).sort()).toEqual([files.rootAId, files.rootBId].sort());
      expect(inspectLineageWorkspace(defaultProject, files.rootAId)).toMatchObject({
        created_by: 'system',
        root_asset_id: files.rootAId,
      });

      const verification = new DatabaseSync(dbFile, { readOnly: true });
      expect(verification.prepare('select count(*) count from lineage_workspaces').get()).toEqual({ count: 0 });
      verification.close();
    } finally {
      delete process.env.LINEAGE_DB_ACCESS;
    }
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

  it('keeps snapshots scoped to an explicit child workspace root', () => {
    const files = seedTwoLineages();
    createLineageWorkspace(defaultProject, {
      activate: true,
      confirmWrite: true,
      rootAssetId: files.childAId,
      title: 'TikTok child workspace',
    });

    const snapshot = getLineageSnapshot(defaultProject, files.childAId);

    expect(snapshot.root_asset_id).toBe(files.childAId);
    expect(snapshot.active_asset_id).toBe(files.childAId);
    expect(snapshot.nodes.map(node => node.asset_id)).toEqual([files.childAId]);
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

  it('uses generated local media for the default demo seed', () => {
    const seeded = seedDemoLineageWorkspace(defaultProject, { confirmWrite: true });
    const snapshot = getLineageSnapshot(defaultProject, seeded.root_asset_id);
    const next = getLineageNextAsset(defaultProject, seeded.root_asset_id);

    expect(seeded.workspace).toMatchObject({
      status: 'active',
      title: 'Demo: Content iteration tree',
    });
    expect(snapshot.nodes).toHaveLength(10);
    expect(snapshot.edges).toHaveLength(9);
    expect(snapshot.nodes.every(node => node.preview_url?.includes('/api/assets/local-preview?'))).toBe(true);
    expect(snapshot.nodes.every(node => node.local_path?.includes('lineage-demo'))).toBe(true);
    expect(next.strategy).toBe('selected');

    const archived = archiveDemoLineageWorkspace(defaultProject, true);
    expect(archived.archived.workspace).toMatchObject({ status: 'archived' });
    expect(existsSync(defaultDemoFilesDir)).toBe(false);
  });

  it('reports and restores missing generated demo media', () => {
    const seeded = seedDemoLineageWorkspace(defaultProject, { confirmWrite: true });
    expect(demoSeedMediaStatus(defaultProject)).toMatchObject({
      present: 10,
      total: 10,
      missing: [],
    });

    rmSync(defaultDemoFilesDir, { force: true, recursive: true });
    expect(demoSeedMediaStatus(defaultProject)).toMatchObject({
      present: 0,
      total: 10,
    });

    const dryRun = restoreDemoSeedMedia(defaultProject, { confirmWrite: false });
    expect(dryRun).toMatchObject({ dryRun: true, restored: 0, would_restore: 10 });
    expect(existsSync(defaultDemoFilesDir)).toBe(false);

    const restored = restoreDemoSeedMedia(defaultProject, { confirmWrite: true });
    const snapshot = getLineageSnapshot(defaultProject, seeded.root_asset_id);

    expect(restored).toMatchObject({ dryRun: false, restored: 10 });
    expect(demoSeedMediaStatus(defaultProject)).toMatchObject({
      present: 10,
      total: 10,
      missing: [],
    });
    expect(snapshot.nodes.every(node => node.preview_url?.includes('/api/assets/local-preview?'))).toBe(true);

    archiveDemoLineageWorkspace(defaultProject, true);
  });

  it('seeds the manifest-backed Swissifier rich demo without bundling media', () => {
    const dryRun = seedSwissifierRichDemoWorkspace(defaultProject, { confirmWrite: false });
    expect(dryRun).toMatchObject({
      demo_id: 'swissifier-rich-demo',
      dryRun: true,
      root_asset_id: 'local-5748fb8ba6df',
    });

    const seeded = seedSwissifierRichDemoWorkspace(defaultProject, { confirmWrite: true });
    const snapshot = getLineageSnapshot(defaultProject, seeded.root_asset_id);
    const next = getLineageNextAsset(defaultProject, seeded.root_asset_id);
    const workspaces = listLineageWorkspaces(defaultProject);

    expect(seeded.workspace).toMatchObject({
      created_by: 'system',
      status: 'active',
      title: 'Swissifier rich demo',
    });
    expect(snapshot.nodes).toHaveLength(14);
    expect(snapshot.edges).toHaveLength(13);
    expect(snapshot.selected).toEqual(['local-27050bc5c393', 'local-6d06bdbd9f56']);
    expect(snapshot.nodes.find(node => node.asset_id === seeded.root_asset_id)).toMatchObject({
      channel: 'linkedin',
      local_path: 'rich-demo-drafts/swissifier-v1/swissifier-linkedin-root-v1.png',
      position: { x: 40, y: 894 },
    });
    const beforeAfter = snapshot.nodes.find(node => node.asset_id === 'local-27050bc5c393');
    const mintDrill = snapshot.nodes.find(node => node.asset_id === 'local-6d06bdbd9f56');
    expect(beforeAfter).toMatchObject({
      attempt_count: 3,
      current_attempt: {
        attempt_index: 3,
        file_path: 'rich-demo-drafts/swissifier-v1/reroll-attempts/swissifier-vertical-before-after-reroll-v3.png',
        source: 'reroll',
      },
    });
    expect(decodeURIComponent(beforeAfter?.preview_url || '')).toContain('reroll-attempts/swissifier-vertical-before-after-reroll-v3.png');
    expect(mintDrill).toMatchObject({
      attempt_count: 2,
      current_attempt: {
        attempt_index: 2,
        file_path: 'rich-demo-drafts/swissifier-v1/reroll-attempts/swissifier-drill-mint-diagonal-reroll-v2.png',
        source: 'reroll',
      },
    });
    const attempts = getLineageAttempts(defaultProject, seeded.root_asset_id, 'local-27050bc5c393').attempts;
    expect(attempts.map(attempt => attempt.attempt_index)).toEqual([3, 2, 1]);
    expect(attempts[0].prompt).toContain('Re-roll again');
    const currentAttemptPath = join(repoRoot, '.asset-scratch', attempts[0].file_path!);
    expect(existsSync(currentAttemptPath)).toBe(true);
    expect(readFileSync(currentAttemptPath).subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(snapshot.nodes.every(node => node.local_path?.startsWith('rich-demo-drafts/swissifier-v1/'))).toBe(true);
    expect(next.strategy).toBe('selected');
    expect(next.selection_mode).toBe('multiple');
    expect(workspaces.active_workspace).toMatchObject({
      root_asset_id: seeded.root_asset_id,
      title: 'Swissifier rich demo',
    });
    expect(seeded.media_status).toMatchObject({
      demo_id: 'swissifier-rich-demo',
      total: 14,
    });
    expect(seeded.reroll_attempts).toEqual({ total: 3 });
  });

  it('reports Swissifier media status and requires an optional source to restore it', () => {
    const previousSource = process.env.LINEAGE_SWISSIFIER_MEDIA_DIR;
    delete process.env.LINEAGE_SWISSIFIER_MEDIA_DIR;
    try {
      const status = swissifierRichDemoMediaStatus(defaultProject);
      expect(status).toMatchObject({
        download_available: true,
        download_file: 'swissifier-rich-demo-v1.tar.gz',
        download_sha256: '24edc5307d0932ddc8a151c6a8c1001a08c45075e3ae198082038c44519be0de',
        demo_id: 'swissifier-rich-demo',
        total: 14,
      });
      expect(status.present + status.missing.length + status.invalid.length).toBe(status.total);

      const restored = restoreSwissifierRichDemoMedia(defaultProject, { confirmWrite: true });
      expect(restored).toMatchObject({
        demo_id: 'swissifier-rich-demo',
        restored: 0,
        source_env: 'LINEAGE_SWISSIFIER_MEDIA_DIR',
        source_required: true,
      });
    } finally {
      if (previousSource === undefined) delete process.env.LINEAGE_SWISSIFIER_MEDIA_DIR;
      else process.env.LINEAGE_SWISSIFIER_MEDIA_DIR = previousSource;
    }
  });

  it('verifies the Swissifier media download checksum before restore work', async () => {
    const body = Buffer.from('not a tarball, but enough for dry-run checksum proof');
    const url = bufferServer(body);

    const downloaded = await downloadSwissifierRichDemoMedia(defaultProject, {
      confirmWrite: false,
      expectedSha256: sha256(body),
      sourceUrl: url,
    });

    expect(downloaded).toMatchObject({
      archive_sha256: sha256(body),
      demo_id: 'swissifier-rich-demo',
      download_available: true,
      dryRun: true,
      restored: 0,
      total: 14,
      would_restore: 14,
    });
  });

  it('rejects Swissifier media downloads with mismatched archive checksums', async () => {
    const body = Buffer.from('wrong archive body');
    const url = bufferServer(body);

    await expect(downloadSwissifierRichDemoMedia(defaultProject, {
      confirmWrite: true,
      expectedSha256: '0'.repeat(64),
      sourceUrl: url,
    })).rejects.toThrow('checksum mismatch');
  });

  it('rejects Swissifier media archives with unsafe paths before writing files', async () => {
    const archive = tarGz([{ name: '../swissifier-linkedin-root-v1.png', body: Buffer.from('unsafe') }]);
    const url = bufferServer(archive);

    await expect(downloadSwissifierRichDemoMedia(defaultProject, {
      confirmWrite: true,
      expectedSha256: sha256(archive),
      sourceUrl: url,
    })).rejects.toThrow('Unsafe Swissifier media archive path');
  });

  it('ignores known archive metadata before validating expected media files', async () => {
    const archive = tarGz([
      { name: './._.', body: Buffer.from('appledouble') },
      { name: 'PaxHeader/currentdir', body: Buffer.from('path=./\n'), typeflag: 'x' },
    ]);
    const url = bufferServer(archive);

    await expect(downloadSwissifierRichDemoMedia(defaultProject, {
      confirmWrite: true,
      expectedSha256: sha256(archive),
      sourceUrl: url,
    })).rejects.toThrow('missing 14 expected files');
  });
});
