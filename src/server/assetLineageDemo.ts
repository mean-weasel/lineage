import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defaultProject, repoRoot } from './assetCore';
import { linkLineageAssets, updateLineageLayout, updateSelectedAsset } from './assetLineage';
import { lineageDb, nowIso } from './assetLineageDb';
import { requireRichDemoFiles, richAssetPath, richBleepDemoAssets, richDemoEdges, richDemoRootId, richDemoSelectedId, richDemoWorkspaceNotes, richDemoWorkspaceTitle } from './assetLineageRichSeed';
import { archiveLineageWorkspace, createLineageWorkspace, isLineageWorkspaceError, lineageWorkspaceId } from './assetLineageWorkspaces';

const demoWorkspaceTitle = 'Demo: Content iteration tree';
const demoWorkspaceNotes = 'Repeatable sample lineage for demos and onboarding. Archive it when dogfooding real work.';
const demoBasePath = ['lineage-demo', '2026-06-lineage-demo'];

const demoAssets = [
  { key: 'root', channel: 'linkedin', file: 'bleep-demo-root.svg', label: 'Initial Bleep Concept', fill: '#f6fbfb', stroke: '#0b7f88' },
  { key: 'hookA', channel: 'tiktok', file: 'bleep-demo-hook-a-v01.svg', label: 'Hook A v01', fill: '#fff8e6', stroke: '#9a6a00' },
  { key: 'hookB', channel: 'linkedin', file: 'bleep-demo-workflow-v01.svg', label: 'Workflow v01', fill: '#eff7ff', stroke: '#2166a5' },
  { key: 'hookC', channel: 'linkedin', file: 'bleep-demo-founder-note-v01.svg', label: 'Founder Note v01', fill: '#f6efff', stroke: '#7653a6' },
  { key: 'hookA2', channel: 'tiktok', file: 'bleep-demo-hook-a-v02.svg', label: 'Hook A v02', fill: '#fff2cc', stroke: '#9a6a00' },
  { key: 'hookA3', channel: 'tiktok', file: 'bleep-demo-before-after-v02.svg', label: 'Before / After v02', fill: '#fff2cc', stroke: '#9a6a00' },
  { key: 'hookB2', channel: 'linkedin', file: 'bleep-demo-workflow-v02.svg', label: 'Workflow v02', fill: '#e6f3ff', stroke: '#2166a5' },
  { key: 'hookB3', channel: 'linkedin', file: 'bleep-demo-product-v02.svg', label: 'Product v02', fill: '#e6f3ff', stroke: '#2166a5' },
  { key: 'winner', channel: 'linkedin', file: 'bleep-demo-product-v03.svg', label: 'Selected Product v03', fill: '#eaf8ef', stroke: '#2e7d4f' },
  { key: 'alt', channel: 'tiktok', file: 'bleep-demo-action-v03.svg', label: 'Action v03', fill: '#fff2cc', stroke: '#9a6a00' },
] as const;

const demoEdges = [
  ['root', 'hookA'],
  ['root', 'hookB'],
  ['root', 'hookC'],
  ['hookA', 'hookA2'],
  ['hookA', 'hookA3'],
  ['hookB', 'hookB2'],
  ['hookB', 'hookB3'],
  ['hookB3', 'winner'],
  ['hookA3', 'alt'],
] as const;

const demoPositions = new Map<string, { x: number; y: number }>([
  ['root', { x: 0, y: 160 }],
  ['hookA', { x: 340, y: 0 }],
  ['hookB', { x: 340, y: 190 }],
  ['hookC', { x: 340, y: 380 }],
  ['hookA2', { x: 700, y: -80 }],
  ['hookA3', { x: 700, y: 80 }],
  ['hookB2', { x: 700, y: 230 }],
  ['hookB3', { x: 700, y: 390 }],
  ['winner', { x: 1060, y: 350 }],
  ['alt', { x: 1060, y: 80 }],
]);

function demoProjectDir(project: string): string {
  return join(repoRoot, '.asset-scratch', ...demoBasePath, project);
}

function demoRelativePath(project: string, asset: typeof demoAssets[number]): string {
  return join(...demoBasePath, project, asset.channel, asset.file);
}

function svg(label: string, fill: string, stroke: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <rect width="1200" height="675" rx="42" fill="${fill}"/>
  <rect x="60" y="60" width="1080" height="555" rx="34" fill="#ffffff" stroke="${stroke}" stroke-width="12"/>
  <text x="600" y="310" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="68" font-weight="800" fill="#1f2a33">${label}</text>
  <text x="600" y="390" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="700" fill="${stroke}">Asset Studio demo lineage</text>
</svg>
`;
}

function assetIdFor(asset: typeof demoAssets[number]): string {
  return `local-${createHash('sha256').update(svg(asset.label, asset.fill, asset.stroke)).digest('hex').slice(0, 12)}`;
}

function demoAssetIds(): Record<string, string> {
  return Object.fromEntries(demoAssets.map(asset => [asset.key, assetIdFor(asset)]));
}

function writeDemoFiles(project: string): Record<string, string> {
  const ids = demoAssetIds();
  for (const asset of demoAssets) {
    const path = join(demoProjectDir(project), asset.channel, asset.file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, svg(asset.label, asset.fill, asset.stroke));
  }
  return ids;
}

function upsertDemoAssets(project: string, ids: Record<string, string>) {
  const database = lineageDb();
  const timestamp = nowIso();
  try {
    database.prepare(`
      insert into projects (id, product, catalog_path, created_at, updated_at)
      values (?, ?, ?, ?, ?)
      on conflict(id) do update set product = excluded.product, updated_at = excluded.updated_at
    `).run(project, project, join(repoRoot, project, 'assets', 'catalog.json'), timestamp, timestamp);
    const assetStatement = database.prepare(`
      insert into assets (
        id, project_id, source, local_path, s3_key, checksum_sha256, media_type, title, status,
        channel, campaign, audience, size_bytes, content_type, created_at, updated_at, last_seen_at
      ) values (?, ?, 'local', ?, null, ?, 'image', ?, 'planned', ?, '2026-06-lineage-demo', 'demo', ?, 'image/svg+xml', ?, ?, ?)
      on conflict(id) do update set
        source = excluded.source, local_path = excluded.local_path, checksum_sha256 = excluded.checksum_sha256,
        media_type = excluded.media_type, title = excluded.title, status = excluded.status, channel = excluded.channel,
        campaign = excluded.campaign, audience = excluded.audience, size_bytes = excluded.size_bytes,
        content_type = excluded.content_type, updated_at = excluded.updated_at, last_seen_at = excluded.last_seen_at
    `);
    const reviewStatement = database.prepare(`
      insert into asset_reviews (asset_id, review_state, updated_at)
      values (?, 'unreviewed', ?)
      on conflict(asset_id) do nothing
    `);
    for (const asset of demoAssets) {
      const body = svg(asset.label, asset.fill, asset.stroke);
      assetStatement.run(
        ids[asset.key],
        project,
        demoRelativePath(project, asset),
        createHash('sha256').update(body).digest('hex'),
        asset.label,
        asset.channel,
        Buffer.byteLength(body),
        timestamp,
        timestamp,
        timestamp
      );
      reviewStatement.run(ids[asset.key], timestamp);
    }
  } finally {
    database.close();
  }
  return { catalog: 0, local: demoAssets.length, total: demoAssets.length };
}

function archiveSimpleDemoWorkspace(project: string, confirmWrite: boolean) {
  const rootAssetId = demoAssetIds().root;
  try {
    archiveLineageWorkspace(project, lineageWorkspaceId(project, rootAssetId), confirmWrite);
  } catch (error) {
    if (!isLineageWorkspaceError(error) || error.status !== 404) throw error;
  }
  if (confirmWrite) rmSync(demoProjectDir(project), { force: true, recursive: true });
}

function upsertRichBleepAssets(project: string) {
  const database = lineageDb();
  const timestamp = nowIso();
  try {
    database.prepare(`
      insert into projects (id, product, catalog_path, created_at, updated_at)
      values (?, ?, ?, ?, ?)
      on conflict(id) do update set product = excluded.product, updated_at = excluded.updated_at
    `).run(project, project, join(repoRoot, project, 'assets', 'catalog.json'), timestamp, timestamp);
    const assetStatement = database.prepare(`
      insert into assets (
        id, project_id, source, local_path, s3_key, checksum_sha256, media_type, title, status,
        channel, campaign, audience, size_bytes, content_type, created_at, updated_at, last_seen_at
      ) values (?, ?, 'local', ?, null, ?, 'image', ?, 'planned', ?, '2026-06-organic-traffic-test', 'local-review', ?, 'image/png', ?, ?, ?)
      on conflict(id) do update set
        source = excluded.source, local_path = excluded.local_path, checksum_sha256 = excluded.checksum_sha256,
        media_type = excluded.media_type, title = excluded.title, status = excluded.status, channel = excluded.channel,
        campaign = excluded.campaign, audience = excluded.audience, size_bytes = excluded.size_bytes,
        content_type = excluded.content_type, updated_at = excluded.updated_at, last_seen_at = excluded.last_seen_at
    `);
    const reviewStatement = database.prepare(`
      insert into asset_reviews (asset_id, review_state, updated_at)
      values (?, 'unreviewed', ?)
      on conflict(asset_id) do nothing
    `);
    for (const [id, localPath, title, channel] of richBleepDemoAssets) {
      const file = richAssetPath(localPath);
      assetStatement.run(id, project, localPath, createHash('sha256').update(readFileSync(file)).digest('hex'), title, channel, statSync(file).size, timestamp, timestamp, timestamp);
      reviewStatement.run(id, timestamp);
    }
  } finally {
    database.close();
  }
  return { catalog: 0, local: richBleepDemoAssets.length, total: richBleepDemoAssets.length };
}

function seedRichBleepLineageWorkspace(project: string, fields: { activate?: boolean; confirmWrite: boolean }) {
  if (!fields.confirmWrite) {
    return { ok: true as const, dryRun: true as const, root_asset_id: richDemoRootId, workspace_id: lineageWorkspaceId(project, richDemoRootId), title: richDemoWorkspaceTitle };
  }
  const media = requireRichDemoFiles();
  archiveSimpleDemoWorkspace(project, true);
  const summary = upsertRichBleepAssets(project);
  for (const [parentAssetId, childAssetId] of richDemoEdges) {
    linkLineageAssets(project, { parentAssetId, childAssetId, confirmWrite: true });
  }
  updateSelectedAsset(project, { assetId: richDemoSelectedId, confirmWrite: true, rootAssetId: richDemoRootId });
  const workspace = createLineageWorkspace(project, {
    activate: fields.activate !== false,
    confirmWrite: true,
    createdBy: 'system',
    notes: richDemoWorkspaceNotes,
    rootAssetId: richDemoRootId,
    title: richDemoWorkspaceTitle,
  }).workspace;
  return {
    ok: true as const,
    message: `Seeded ${richDemoWorkspaceTitle}`,
    root_asset_id: richDemoRootId,
    selected_asset_id: richDemoSelectedId,
    media,
    summary,
    workspace,
  };
}

export function seedDemoLineageWorkspace(project: string, fields: { activate?: boolean; confirmWrite: boolean }) {
  if (project === defaultProject) return seedRichBleepLineageWorkspace(project, fields);
  const ids = fields.confirmWrite ? writeDemoFiles(project) : demoAssetIds();
  const rootAssetId = ids.root;
  if (!fields.confirmWrite) {
    return {
      ok: true as const,
      dryRun: true as const,
      root_asset_id: rootAssetId,
      workspace_id: lineageWorkspaceId(project, rootAssetId),
      files_dir: demoProjectDir(project),
    };
  }
  const summary = upsertDemoAssets(project, ids);
  for (const [parent, child] of demoEdges) {
    linkLineageAssets(project, { parentAssetId: ids[parent], childAssetId: ids[child], confirmWrite: true });
  }
  updateSelectedAsset(project, {
    assetId: ids.winner,
    confirmWrite: true,
    notes: 'Demo selected winner for the next variation.',
    rootAssetId,
  });
  updateLineageLayout(project, {
    confirmWrite: true,
    rootAssetId,
    positions: [...demoPositions].map(([key, position]) => ({ assetId: ids[key], ...position })),
  });
  const workspace = createLineageWorkspace(project, {
    activate: fields.activate !== false,
    confirmWrite: true,
    createdBy: 'system',
    notes: demoWorkspaceNotes,
    rootAssetId,
    title: demoWorkspaceTitle,
  }).workspace;
  return {
    ok: true as const,
    message: `Seeded ${demoWorkspaceTitle}`,
    files_dir: demoProjectDir(project),
    root_asset_id: rootAssetId,
    selected_asset_id: ids.winner,
    summary,
    workspace,
  };
}

export function archiveDemoLineageWorkspace(project: string, confirmWrite: boolean) {
  if (project === defaultProject) {
    let archived;
    try {
      archived = archiveLineageWorkspace(project, lineageWorkspaceId(project, richDemoRootId), confirmWrite);
    } catch (error) {
      if (!isLineageWorkspaceError(error) || error.status !== 404) throw error;
      archived = { ok: true as const, message: 'No rich Bleep lineage workspace exists yet', workspace: null };
    }
    if (confirmWrite) archiveSimpleDemoWorkspace(project, true);
    return {
      ok: true as const,
      message: confirmWrite ? `Archived ${richDemoWorkspaceTitle}` : `Would archive ${richDemoWorkspaceTitle}`,
      root_asset_id: richDemoRootId,
      archived,
    };
  }
  const ids = demoAssetIds();
  const rootAssetId = ids.root;
  let archived;
  try {
    archived = archiveLineageWorkspace(project, lineageWorkspaceId(project, rootAssetId), confirmWrite);
  } catch (error) {
    if (!isLineageWorkspaceError(error) || error.status !== 404) throw error;
    archived = { ok: true as const, message: 'No demo lineage workspace exists yet', workspace: null };
  }
  if (confirmWrite) rmSync(demoProjectDir(project), { force: true, recursive: true });
  return {
    ok: true as const,
    message: confirmWrite ? `Archived ${demoWorkspaceTitle}` : `Would archive ${demoWorkspaceTitle}`,
    files_dir: demoProjectDir(project),
    root_asset_id: rootAssetId,
    archived,
  };
}
