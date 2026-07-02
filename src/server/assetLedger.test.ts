import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultProject, repoRoot } from './assetCore';
import { indexAssetLedger, getAssetLedgerSnapshot, upsertAssetLedgerAsset } from './assetLedger';
import { getLedgerPageFromQuery } from './assetLedgerApi';
import { fileSha256 } from './localReview';
import { lineageDb } from './assetLineageDb';
import type { GrowthAsset } from '../shared/types';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-asset-ledger');
const dbFile = join(scratchDir, 'asset-ledger.sqlite');

function seedLocalAsset() {
  rmSync(scratchDir, { force: true, recursive: true });
  mkdirSync(scratchDir, { recursive: true });
  const file = join(scratchDir, 'demo-linkedin-ledger-local.png');
  writeFileSync(file, Buffer.from('asset-ledger-local'));
  return { file, checksum: fileSha256(file) };
}

function syntheticAsset(source: 'catalog' | 'local', checksum: string): GrowthAsset {
  return {
    asset_id: source === 'catalog' ? 'ledger-catalog-shared' : 'local-ledger-shared',
    audience: 'internal-ops',
    campaign: '2026-06-ledger-test',
    channel: 'linkedin',
    content_type: 'image',
    cta: 'Review before upload',
    hook: 'Shared checksum record',
    product: defaultProject,
    project: defaultProject,
    source,
    status: source === 'catalog' ? 'working' : 'planned',
    title: `Ledger ${source}`,
    utm_content: `ledger_${source}`,
    ...(source === 'catalog'
      ? {
          placements: [{
            channel: 'linkedin',
            notes: 'Ready for scheduled post.',
            scheduled_at: '2026-06-24T16:00:00-07:00',
            status: 'scheduled' as const,
            updated_at: '2026-06-24T12:30:00.000Z',
          }],
        }
      : {}),
    ...(source === 'local'
      ? {
          local: {
            absolute_path: '/tmp/ledger-shared.png',
            checksum_sha256: checksum,
            content_type: 'image/png',
            relative_path: 'ledger-shared.png',
            size_bytes: 12,
            updated_at: '2026-06-24T12:00:00.000Z',
          },
        }
      : {
          s3: {
            bucket: 'lineage-demo-assets',
            checksum_sha256: checksum,
            key: 'products/demo-project/campaigns/2026-06-ledger-test/channels/linkedin/audiences/internal-ops/statuses/working/types/image/assets/ledger-catalog-shared/ledger.png',
            region: 'us-east-1',
            version_id: 'ledger-version',
          },
        }),
  };
}

describe('asset ledger foundation', () => {
  beforeEach(() => {
    rmSync(scratchDir, { force: true, recursive: true });
    process.env.LINEAGE_DB = dbFile;
  });

  it('indexes catalog, local, and S3 metadata into one SQLite ledger', () => {
    seedLocalAsset();

    const summary = indexAssetLedger(defaultProject);
    const snapshot = getAssetLedgerSnapshot(defaultProject);
    const localRecord = snapshot.records.find(record =>
      record.sources.some(source => source.local_path === 'vitest-asset-ledger/demo-linkedin-ledger-local.png')
    );

    expect(summary.database).toBe(dbFile);
    expect(summary.source_mode).toBe('all');
    expect(summary.include_live_s3).toBe(false);
    expect(summary.run.status).toBe('complete');
    expect(summary.run.include_live_s3).toBe(false);
    expect(summary.run.sources_after).toMatchObject(summary.sources);
    expect(summary.records).toBeGreaterThan(0);
    expect(summary.sources.catalog).toBeGreaterThan(0);
    expect(summary.sources.s3).toBeGreaterThan(0);
    expect(summary.sources.local).toBeGreaterThan(0);
    expect(snapshot.last_index_run?.id).toBe(summary.run.id);
    expect(snapshot.totals).toMatchObject(summary.sources);
    expect(localRecord).toBeTruthy();
    expect(localRecord?.first_seen_at).toBeTruthy();
    expect(localRecord?.indexed_by_run_id).toBe(summary.run.id);
    expect(localRecord?.sources.some(source => source.source_type === 'local')).toBe(true);

    const localOnlyPage = getLedgerPageFromQuery(defaultProject, { pageSize: '1', storage: 'local-only' });
    expect(localOnlyPage.pagination).toMatchObject({ page: 1, pageSize: 1 });
    expect(localOnlyPage.pagination.total).toBeGreaterThanOrEqual(1);
    expect(localOnlyPage.records[0].sources.map(source => source.source_type)).toEqual(['local']);
  });

  it('can index catalog metadata without sweeping local review assets', () => {
    seedLocalAsset();

    const summary = indexAssetLedger(defaultProject, { source: 'catalog' });
    const snapshot = getAssetLedgerSnapshot(defaultProject);

    expect(summary.source_mode).toBe('catalog');
    expect(summary.sources.catalog).toBeGreaterThan(0);
    expect(summary.sources.s3).toBeGreaterThan(0);
    expect(summary.sources.local).toBe(0);
    expect(summary.run.assets_indexed).toBe(summary.assets_indexed);
    expect(snapshot.totals.local).toBe(0);
    expect(snapshot.records.some(record =>
      record.sources.some(source => source.local_path === 'vitest-asset-ledger/demo-linkedin-ledger-local.png')
    )).toBe(false);
  });

  it('can represent local, catalog, and S3 sources for the same checksum record', () => {
    const checksum = 'f'.repeat(64);
    const database = lineageDb();

    database.prepare(`
      insert into projects (id, product, catalog_path, created_at, updated_at)
      values (?, ?, ?, ?, ?)
      on conflict(id) do nothing
    `).run(defaultProject, defaultProject, null, '2026-06-24T12:00:00.000Z', '2026-06-24T12:00:00.000Z');
    upsertAssetLedgerAsset(database, defaultProject, syntheticAsset('catalog', checksum));
    upsertAssetLedgerAsset(database, defaultProject, syntheticAsset('local', checksum));
    database.close();

    const snapshot = getAssetLedgerSnapshot(defaultProject);
    const record = snapshot.records.find(item => item.checksum_sha256 === checksum);

    expect(record).toBeTruthy();
    expect(record?.sources.map(source => source.source_type).sort()).toEqual(['catalog', 'local', 's3']);
    expect(record?.sources.find(source => source.source_type === 's3')?.s3_key).toContain('ledger-catalog-shared');

    const combinedPage = getLedgerPageFromQuery(defaultProject, { pageSize: '1', storage: 'local-and-s3' });
    expect(combinedPage.pagination).toMatchObject({ page: 1, pageSize: 1, total: 1 });
    expect(combinedPage.records[0].checksum_sha256).toBe(checksum);
  });

  it('hydrates review, placement, and selected lineage state into ledger records', () => {
    const checksum = 'a'.repeat(64);
    const asset = syntheticAsset('catalog', checksum);
    const database = lineageDb();

    database.prepare(`
      insert into projects (id, product, catalog_path, created_at, updated_at)
      values (?, ?, ?, ?, ?)
      on conflict(id) do nothing
    `).run(defaultProject, defaultProject, null, '2026-06-24T12:00:00.000Z', '2026-06-24T12:00:00.000Z');
    upsertAssetLedgerAsset(database, defaultProject, asset);
    const indexedAsset = database.prepare('select id from assets where project_id = ? and id = ?').get(defaultProject, asset.asset_id);
    const defaultReview = database.prepare('select review_state from asset_reviews where asset_id = ?').get(asset.asset_id) as { review_state: string };
    database.prepare(`
      update asset_reviews
      set review_state = 'approved', reviewed_at = ?, ignored_at = null, notes = 'Use this as the next branch.', updated_at = ?
      where asset_id = ?
    `).run('2026-06-24T12:45:00.000Z', '2026-06-24T12:45:00.000Z', asset.asset_id);
    database.prepare(`
      insert into asset_selections (id, project_id, root_asset_id, asset_id, notes, selected_at)
      values (?, ?, ?, ?, ?, ?)
    `).run(`${defaultProject}:${asset.asset_id}:selected`, defaultProject, asset.asset_id, asset.asset_id, 'User selected for variations.', '2026-06-24T13:00:00.000Z');
    database.close();

    const record = getAssetLedgerSnapshot(defaultProject).records.find(item => item.checksum_sha256 === checksum);

    expect(indexedAsset).toBeTruthy();
    expect(defaultReview.review_state).toBe('unreviewed');
    expect(record?.workflow.review).toMatchObject({ asset_id: asset.asset_id, review_state: 'approved' });
    expect(record?.workflow.placements[0]).toMatchObject({ asset_id: asset.asset_id, channel: 'linkedin', status: 'scheduled' });
    expect(record?.workflow.selection).toMatchObject({ asset_id: asset.asset_id, root_asset_id: asset.asset_id });

    const workflowPage = getLedgerPageFromQuery(defaultProject, {
      pageSize: '1',
      placement: 'scheduled',
      review: 'approved',
      selection: 'selected',
    });
    expect(workflowPage.pagination).toMatchObject({ page: 1, pageSize: 1, total: 1 });
    expect(workflowPage.records[0].canonical_asset_id).toBe(asset.asset_id);
  });
});
