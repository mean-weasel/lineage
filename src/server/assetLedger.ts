import { defaultProject, listAssets, repoRoot } from './assetCore';
import { lineageDb, lineageDbPath, nowIso, type DatabaseSync } from './assetLineageDb';
import { ledgerWorkflowStates, upsertLedgerPlacementsForAsset, upsertLedgerWorkflowAsset } from './assetLedgerWorkflow';
import type {
  AssetLedgerIndexOptions,
  AssetLedgerIndexRun,
  AssetLedgerIndexSourceMode,
  AssetLedgerIndexSummary,
  AssetLedgerRecord,
  AssetLedgerSnapshot,
  AssetLedgerSource,
  AssetLedgerSourceType,
  GrowthAsset,
  ListAssetsOptions,
} from '../shared/types';

interface LedgerRecordRow {
  id: string;
  project_id: string;
  canonical_asset_id: string;
  checksum_sha256: string | null;
  media_type: AssetLedgerRecord['media_type'];
  title: string;
  status: string;
  channel: string | null;
  campaign: string | null;
  audience: string | null;
  updated_at: string;
  first_seen_at: string | null;
  last_seen_at: string;
  indexed_by_run_id: string | null;
}

interface LedgerSourceRow {
  id: string;
  record_id: string;
  source_type: AssetLedgerSourceType;
  asset_id: string | null;
  local_path: string | null;
  s3_bucket: string | null;
  s3_region: string | null;
  s3_key: string | null;
  s3_version_id: string | null;
  etag: string | null;
  size_bytes: number | null;
  content_type: string | null;
  updated_at: string | null;
  first_seen_at: string | null;
  last_seen_at: string;
  indexed_by_run_id: string | null;
}

interface LedgerRunRow {
  id: string;
  project_id: string;
  source_mode: AssetLedgerIndexSourceMode;
  include_live_s3: number;
  status: AssetLedgerIndexRun['status'];
  started_at: string;
  completed_at: string | null;
  assets_indexed: number;
  records_after: number;
  catalog_sources_after: number;
  local_sources_after: number;
  s3_sources_after: number;
  error: string | null;
}

interface IndexContext {
  runId?: string;
  seenAt?: string;
}

function allAssets(project: string, source: ListAssetsOptions['source']): GrowthAsset[] {
  const first = listAssets(project, { page: 1, pageSize: 100, source });
  const assets = [...first.assets];
  for (let page = 2; page <= first.pagination.totalPages; page += 1) {
    assets.push(...listAssets(project, { page, pageSize: 100, source }).assets);
  }
  return assets;
}

function sourceMode(options: AssetLedgerIndexOptions): AssetLedgerIndexSourceMode {
  if (!options.source || options.source === 'all') return 'all';
  if (options.source === 'catalog' || options.source === 'local') return options.source;
  throw new Error(`Unknown ledger source mode: ${options.source}`);
}

function assetsForIndex(project: string, mode: AssetLedgerIndexSourceMode): GrowthAsset[] {
  if (mode === 'catalog') return allAssets(project, 'catalog');
  if (mode === 'local') return allAssets(project, 'local');
  return [...allAssets(project, 'catalog'), ...allAssets(project, 'local')];
}

function recordId(project: string, asset: GrowthAsset): string {
  const checksum = asset.local?.checksum_sha256 || asset.s3?.checksum_sha256;
  return checksum ? `${project}:sha256:${checksum}` : `${project}:asset:${asset.asset_id}`;
}

function sourceId(project: string, record: string, sourceType: AssetLedgerSourceType, key: string): string {
  return `${project}:${record}:${sourceType}:${key}`;
}

function upsertProject(database: DatabaseSync, project: string): void {
  const timestamp = nowIso();
  database.prepare(`
    insert into projects (id, product, catalog_path, created_at, updated_at)
    values (?, ?, ?, ?, ?)
    on conflict(id) do update set product = excluded.product, updated_at = excluded.updated_at
  `).run(project, project, `${repoRoot}/${project}/assets/catalog.json`, timestamp, timestamp);
}

export function upsertAssetLedgerAsset(database: DatabaseSync, project: string, asset: GrowthAsset, context: IndexContext = {}): void {
  const timestamp = context.seenAt || nowIso();
  const id = recordId(project, asset);
  const checksum = asset.local?.checksum_sha256 || asset.s3?.checksum_sha256 || null;
  upsertLedgerWorkflowAsset(database, project, asset, timestamp);
  database.prepare(`
    insert into asset_ledger_records (
      id, project_id, canonical_asset_id, checksum_sha256, media_type, title, status,
      channel, campaign, audience, created_at, updated_at, first_seen_at, last_seen_at, indexed_by_run_id
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      canonical_asset_id = excluded.canonical_asset_id,
      checksum_sha256 = coalesce(asset_ledger_records.checksum_sha256, excluded.checksum_sha256),
      media_type = excluded.media_type,
      title = excluded.title,
      status = excluded.status,
      channel = excluded.channel,
      campaign = excluded.campaign,
      audience = excluded.audience,
      updated_at = excluded.updated_at,
      first_seen_at = coalesce(asset_ledger_records.first_seen_at, excluded.first_seen_at),
      last_seen_at = excluded.last_seen_at,
      indexed_by_run_id = excluded.indexed_by_run_id
  `).run(
    id, project, asset.asset_id, checksum, asset.content_type, asset.title, asset.status,
    asset.channel || null, asset.campaign || null, asset.audience || null,
    timestamp, timestamp, timestamp, timestamp, context.runId || null
  );
  if (asset.source !== 'local') upsertSource(database, project, id, 'catalog', asset, asset.asset_id, context);
  if (asset.local) upsertSource(database, project, id, 'local', asset, asset.local.relative_path, context);
  if (asset.s3) upsertSource(database, project, id, 's3', asset, asset.s3.key, context);
  upsertLedgerPlacementsForAsset(database, project, asset);
}

function upsertSource(
  database: DatabaseSync,
  project: string,
  record: string,
  sourceType: AssetLedgerSourceType,
  asset: GrowthAsset,
  key: string,
  context: IndexContext = {}
): void {
  const timestamp = context.seenAt || nowIso();
  const id = sourceId(project, record, sourceType, key);
  database.prepare(`
    insert into asset_ledger_sources (
      id, project_id, record_id, source_type, asset_id, local_path, s3_bucket, s3_region,
      s3_key, s3_version_id, etag, size_bytes, content_type, updated_at, first_seen_at, last_seen_at, indexed_by_run_id
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      asset_id = excluded.asset_id,
      local_path = excluded.local_path,
      s3_bucket = excluded.s3_bucket,
      s3_region = excluded.s3_region,
      s3_key = excluded.s3_key,
      s3_version_id = excluded.s3_version_id,
      etag = excluded.etag,
      size_bytes = excluded.size_bytes,
      content_type = excluded.content_type,
      updated_at = excluded.updated_at,
      first_seen_at = coalesce(asset_ledger_sources.first_seen_at, excluded.first_seen_at),
      last_seen_at = excluded.last_seen_at,
      indexed_by_run_id = excluded.indexed_by_run_id
  `).run(
    id, project, record, sourceType, asset.asset_id,
    sourceType === 'local' ? asset.local?.relative_path || null : null,
    sourceType === 's3' ? asset.s3?.bucket || null : null,
    sourceType === 's3' ? asset.s3?.region || null : null,
    sourceType === 's3' ? asset.s3?.key || null : null,
    sourceType === 's3' ? asset.s3?.version_id || null : null,
    sourceType === 's3' ? asset.s3?.etag || null : null,
    asset.local?.size_bytes || asset.s3?.size_bytes || null,
    asset.local?.content_type || asset.s3?.content_type || null,
    asset.local?.updated_at || asset.s3?.updated_at || null,
    timestamp, timestamp, context.runId || null
  );
}

export function indexAssetLedger(project = defaultProject, options: AssetLedgerIndexOptions = {}): AssetLedgerIndexSummary {
  const mode = sourceMode(options);
  const database = lineageDb();
  const startedAt = nowIso();
  upsertProject(database, project);
  const runId = createIndexRun(database, project, mode, startedAt);
  try {
    const assets = assetsForIndex(project, mode);
    for (const asset of assets) upsertAssetLedgerAsset(database, project, asset, { runId, seenAt: startedAt });
    const summary = ledgerSummary(database, project, assets.length, mode);
    completeIndexRun(database, runId, summary, null);
    const run = latestIndexRun(database, project) as AssetLedgerIndexRun;
    database.close();
    return { ...summary, run };
  } catch (error) {
    completeIndexRun(database, runId, ledgerSummary(database, project, 0, mode), error instanceof Error ? error.message : String(error));
    database.close();
    throw error;
  }
}

function ledgerSummary(database: DatabaseSync, project: string, assetsIndexed: number, mode: AssetLedgerIndexSourceMode): Omit<AssetLedgerIndexSummary, 'run'> {
  const sources = sourceCounts(database, project);
  const recordRow = database.prepare('select count(*) count from asset_ledger_records where project_id = ?').get(project) as { count: number };
  return {
    project,
    database: lineageDbPath(),
    records: Number(recordRow.count),
    assets_indexed: assetsIndexed,
    source_mode: mode,
    include_live_s3: false,
    sources,
    fetchedAt: nowIso(),
  };
}

function createIndexRun(database: DatabaseSync, project: string, mode: AssetLedgerIndexSourceMode, startedAt: string): string {
  const id = `${project}:ledger-run:${startedAt}`;
  database.prepare(`
    insert into asset_ledger_index_runs (id, project_id, source_mode, include_live_s3, status, started_at)
    values (?, ?, ?, 0, 'running', ?)
  `).run(id, project, mode, startedAt);
  return id;
}

function completeIndexRun(
  database: DatabaseSync,
  runId: string,
  summary: Omit<AssetLedgerIndexSummary, 'run'>,
  error: string | null
): void {
  database.prepare(`
    update asset_ledger_index_runs
    set status = ?, completed_at = ?, assets_indexed = ?, records_after = ?,
      catalog_sources_after = ?, local_sources_after = ?, s3_sources_after = ?, error = ?
    where id = ?
  `).run(
    error ? 'failed' : 'complete',
    nowIso(),
    summary.assets_indexed,
    summary.records,
    summary.sources.catalog,
    summary.sources.local,
    summary.sources.s3,
    error,
    runId
  );
}

function sourceCounts(database: DatabaseSync, project: string): Record<AssetLedgerSourceType, number> {
  const rows = database.prepare(`
    select source_type, count(*) count
    from asset_ledger_sources
    where project_id = ?
    group by source_type
  `).all(project) as Array<{ source_type: AssetLedgerSourceType; count: number }>;
  return {
    catalog: Number(rows.find(row => row.source_type === 'catalog')?.count || 0),
    local: Number(rows.find(row => row.source_type === 'local')?.count || 0),
    s3: Number(rows.find(row => row.source_type === 's3')?.count || 0),
  };
}

export function getAssetLedgerSnapshot(project = defaultProject): AssetLedgerSnapshot {
  const database = lineageDb();
  const records = database.prepare(`
    select id, project_id, canonical_asset_id, checksum_sha256, media_type, title, status, channel,
      campaign, audience, updated_at, first_seen_at, last_seen_at, indexed_by_run_id
    from asset_ledger_records
    where project_id = ?
    order by updated_at desc, id
  `).all(project) as unknown as LedgerRecordRow[];
  const sources = database.prepare(`
    select id, record_id, source_type, asset_id, local_path, s3_bucket, s3_region, s3_key,
      s3_version_id, etag, size_bytes, content_type, updated_at, first_seen_at, last_seen_at, indexed_by_run_id
    from asset_ledger_sources
    where project_id = ?
    order by source_type, id
  `).all(project) as unknown as LedgerSourceRow[];
  const totals = sourceCounts(database, project);
  const lastIndexRun = latestIndexRun(database, project);
  const sourceRecords = sources.map(toSource);
  const baseRecords = records.map(record => toRecord(record, sourceRecords.filter(source => source.record_id === record.id)));
  const workflows = ledgerWorkflowStates(database, project, baseRecords, sourceRecords);
  database.close();
  return {
    project,
    database: lineageDbPath(),
    records: baseRecords.map(record => ({ ...record, workflow: workflows[record.id] || { placements: [] } })),
    last_index_run: lastIndexRun,
    totals: {
      records: records.length,
      local: totals.local,
      catalog: totals.catalog,
      s3: totals.s3,
    },
    fetchedAt: nowIso(),
  };
}

function latestIndexRun(database: DatabaseSync, project: string): AssetLedgerIndexRun | undefined {
  const row = database.prepare(`
    select id, project_id, source_mode, include_live_s3, status, started_at, completed_at,
      assets_indexed, records_after, catalog_sources_after, local_sources_after, s3_sources_after, error
    from asset_ledger_index_runs
    where project_id = ?
    order by started_at desc, id desc
    limit 1
  `).get(project) as LedgerRunRow | undefined;
  return row ? toIndexRun(row) : undefined;
}

function toIndexRun(row: LedgerRunRow): AssetLedgerIndexRun {
  return {
    id: row.id,
    project: row.project_id,
    source_mode: row.source_mode,
    include_live_s3: Boolean(row.include_live_s3),
    status: row.status,
    started_at: row.started_at,
    completed_at: row.completed_at || undefined,
    assets_indexed: Number(row.assets_indexed),
    records_after: Number(row.records_after),
    sources_after: {
      catalog: Number(row.catalog_sources_after),
      local: Number(row.local_sources_after),
      s3: Number(row.s3_sources_after),
    },
    error: row.error || undefined,
  };
}

function toRecord(record: LedgerRecordRow, sources: AssetLedgerSource[]): AssetLedgerRecord {
  return {
    id: record.id,
    project: record.project_id,
    canonical_asset_id: record.canonical_asset_id,
    checksum_sha256: record.checksum_sha256 || undefined,
    media_type: record.media_type,
    title: record.title,
    status: record.status,
    channel: record.channel || undefined,
    campaign: record.campaign || undefined,
    audience: record.audience || undefined,
    updated_at: record.updated_at,
    first_seen_at: record.first_seen_at || undefined,
    last_seen_at: record.last_seen_at,
    indexed_by_run_id: record.indexed_by_run_id || undefined,
    sources,
    workflow: { placements: [] },
  };
}

function toSource(source: LedgerSourceRow): AssetLedgerSource {
  return {
    id: source.id,
    record_id: source.record_id,
    source_type: source.source_type,
    asset_id: source.asset_id || undefined,
    local_path: source.local_path || undefined,
    s3_bucket: source.s3_bucket || undefined,
    s3_region: source.s3_region || undefined,
    s3_key: source.s3_key || undefined,
    s3_version_id: source.s3_version_id || undefined,
    etag: source.etag || undefined,
    size_bytes: source.size_bytes || undefined,
    content_type: source.content_type || undefined,
    updated_at: source.updated_at || undefined,
    first_seen_at: source.first_seen_at || undefined,
    last_seen_at: source.last_seen_at,
    indexed_by_run_id: source.indexed_by_run_id || undefined,
  };
}
