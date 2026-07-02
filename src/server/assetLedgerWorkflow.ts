import { lineageDb, nowIso, type DatabaseSync } from './assetLineageDb';
import type {
  AssetLedgerRecord,
  AssetLedgerSelectionState,
  AssetLedgerSource,
  AssetLedgerWorkflowState,
  AssetPlacementState,
  AssetReviewLedgerState,
  GrowthAsset,
  PlacementStatus,
} from '../shared/types';

interface ReviewRow {
  asset_id: string;
  review_state: AssetReviewLedgerState['review_state'];
  reviewed_at: string | null;
  ignored_at: string | null;
  notes: string | null;
  updated_at: string;
}

interface PlacementRow {
  asset_id: string;
  channel: string;
  status: PlacementStatus;
  scheduled_at: string | null;
  posted_at: string | null;
  url: string | null;
  notes: string | null;
  updated_at: string;
  synced_at: string;
}

interface SelectionRow {
  root_asset_id: string;
  asset_id: string;
  notes: string | null;
  selected_at: string;
}

type PlacementInput = Omit<AssetPlacementState, 'asset_id' | 'synced_at'>;

function ensureProject(database: DatabaseSync, project: string): void {
  const timestamp = nowIso();
  database.prepare(`
    insert into projects (id, product, created_at, updated_at)
    values (?, ?, ?, ?)
    on conflict(id) do update set product = excluded.product, updated_at = excluded.updated_at
  `).run(project, project, timestamp, timestamp);
}

function upsertLedgerPlacement(database: DatabaseSync, project: string, assetId: string, placement: PlacementInput): void {
  const syncedAt = nowIso();
  database.prepare(`
    insert into asset_ledger_placements (
      id, project_id, asset_id, channel, status, scheduled_at, posted_at, url, notes, updated_at, synced_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(project_id, asset_id, channel) do update set
      status = excluded.status,
      scheduled_at = excluded.scheduled_at,
      posted_at = excluded.posted_at,
      url = excluded.url,
      notes = excluded.notes,
      updated_at = excluded.updated_at,
      synced_at = excluded.synced_at
  `).run(
    `${project}:${assetId}:placement:${placement.channel}`,
    project,
    assetId,
    placement.channel,
    placement.status,
    placement.scheduled_at || null,
    placement.posted_at || null,
    placement.url || null,
    placement.notes || null,
    placement.updated_at,
    syncedAt
  );
}

export function upsertLedgerPlacementsForAsset(database: DatabaseSync, project: string, asset: GrowthAsset): void {
  for (const placement of asset.placements || []) upsertLedgerPlacement(database, project, asset.asset_id, placement);
}

export function upsertLedgerWorkflowAsset(database: DatabaseSync, project: string, asset: GrowthAsset, timestamp: string): void {
  const source = asset.source === 'local' ? 'local' : 'catalog';
  database.prepare(`
    insert into assets (
      id, project_id, source, local_path, s3_key, checksum_sha256, media_type, title, status,
      channel, campaign, audience, size_bytes, content_type, created_at, updated_at, last_seen_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      source = excluded.source, local_path = excluded.local_path, s3_key = excluded.s3_key,
      checksum_sha256 = excluded.checksum_sha256, media_type = excluded.media_type,
      title = excluded.title, status = excluded.status, channel = excluded.channel,
      campaign = excluded.campaign, audience = excluded.audience, size_bytes = excluded.size_bytes,
      content_type = excluded.content_type, updated_at = excluded.updated_at, last_seen_at = excluded.last_seen_at
  `).run(
    asset.asset_id, project, source, asset.local?.relative_path || null, asset.s3?.key || null,
    asset.local?.checksum_sha256 || asset.s3?.checksum_sha256 || null, asset.content_type, asset.title,
    asset.status, asset.channel || null, asset.campaign || null, asset.audience || null,
    asset.local?.size_bytes || asset.s3?.size_bytes || null, asset.local?.content_type || asset.s3?.content_type || null,
    timestamp, timestamp, timestamp
  );
  database.prepare(`
    insert into asset_reviews (asset_id, review_state, updated_at)
    values (?, 'unreviewed', ?)
    on conflict(asset_id) do nothing
  `).run(asset.asset_id, timestamp);
}

export function syncLedgerPlacement(project: string, assetId: string, placement: PlacementInput): void {
  const database = lineageDb();
  try {
    ensureProject(database, project);
    upsertLedgerPlacement(database, project, assetId, placement);
  } finally {
    database.close();
  }
}

function placeholders(values: string[]): string {
  return values.map(() => '?').join(',');
}

function assetIdsForRecord(record: AssetLedgerRecord, sources: AssetLedgerSource[]): string[] {
  return [...new Set([record.canonical_asset_id, ...sources.map(source => source.asset_id).filter(Boolean) as string[]])];
}

function reviewFromRow(row: ReviewRow): AssetReviewLedgerState {
  return {
    asset_id: row.asset_id,
    review_state: row.review_state,
    reviewed_at: row.reviewed_at || undefined,
    ignored_at: row.ignored_at || undefined,
    notes: row.notes || undefined,
    updated_at: row.updated_at,
  };
}

function placementFromRow(row: PlacementRow): AssetPlacementState {
  return {
    asset_id: row.asset_id,
    channel: row.channel,
    status: row.status,
    scheduled_at: row.scheduled_at || undefined,
    posted_at: row.posted_at || undefined,
    url: row.url || undefined,
    notes: row.notes || undefined,
    updated_at: row.updated_at,
    synced_at: row.synced_at,
  };
}

function selectionFromRow(row: SelectionRow): AssetLedgerSelectionState {
  return {
    root_asset_id: row.root_asset_id,
    asset_id: row.asset_id,
    notes: row.notes || undefined,
    selected_at: row.selected_at,
  };
}

export function ledgerWorkflowStates(
  database: DatabaseSync,
  project: string,
  records: AssetLedgerRecord[],
  sources: AssetLedgerSource[]
): Record<string, AssetLedgerWorkflowState> {
  const recordAssets = new Map(records.map(record => [record.id, assetIdsForRecord(record, sources.filter(source => source.record_id === record.id))]));
  const assetIds = [...new Set([...recordAssets.values()].flat())];
  if (assetIds.length === 0) return {};
  const marker = placeholders(assetIds);
  const reviews = database.prepare(`
    select asset_id, review_state, reviewed_at, ignored_at, notes, updated_at
    from asset_reviews
    where asset_id in (${marker})
  `).all(...assetIds) as unknown as ReviewRow[];
  const placements = database.prepare(`
    select asset_id, channel, status, scheduled_at, posted_at, url, notes, updated_at, synced_at
    from asset_ledger_placements
    where project_id = ? and asset_id in (${marker})
  `).all(project, ...assetIds) as unknown as PlacementRow[];
  const selections = database.prepare(`
    select root_asset_id, asset_id, notes, selected_at
    from asset_selections
    where project_id = ? and asset_id in (${marker})
  `).all(project, ...assetIds) as unknown as SelectionRow[];
  return Object.fromEntries(records.map(record => {
    const ids = recordAssets.get(record.id) || [];
    const review = reviews.find(row => ids.includes(row.asset_id));
    const selection = selections.find(row => ids.includes(row.asset_id));
    return [record.id, {
      review: review ? reviewFromRow(review) : undefined,
      placements: placements.filter(row => ids.includes(row.asset_id)).map(placementFromRow),
      selection: selection ? selectionFromRow(selection) : undefined,
    }];
  }));
}
