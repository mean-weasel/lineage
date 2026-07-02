import type { AssetContentType } from './types';
import type { AssetReviewState, PlacementStatus } from './types';

export type AssetLedgerSourceType = 'local' | 'catalog' | 's3';
export type AssetLedgerIndexSourceMode = 'all' | 'catalog' | 'local';

export interface AssetLedgerIndexOptions {
  source?: AssetLedgerIndexSourceMode;
}

export interface AssetLedgerIndexRun {
  id: string;
  project: string;
  source_mode: AssetLedgerIndexSourceMode;
  include_live_s3: boolean;
  status: 'running' | 'complete' | 'failed';
  started_at: string;
  completed_at?: string;
  assets_indexed: number;
  records_after: number;
  sources_after: Record<AssetLedgerSourceType, number>;
  error?: string;
}

export interface AssetLedgerSource {
  id: string;
  record_id?: string;
  source_type: AssetLedgerSourceType;
  asset_id?: string;
  local_path?: string;
  s3_bucket?: string;
  s3_region?: string;
  s3_key?: string;
  s3_version_id?: string;
  etag?: string;
  size_bytes?: number;
  content_type?: string;
  updated_at?: string;
  first_seen_at?: string;
  last_seen_at: string;
  indexed_by_run_id?: string;
}

export interface AssetReviewLedgerState {
  asset_id: string;
  review_state: AssetReviewState;
  reviewed_at?: string;
  ignored_at?: string;
  notes?: string;
  updated_at: string;
}

export interface AssetPlacementState {
  asset_id: string;
  channel: string;
  status: PlacementStatus;
  scheduled_at?: string;
  posted_at?: string;
  url?: string;
  notes?: string;
  updated_at: string;
  synced_at: string;
}

export interface AssetLedgerSelectionState {
  root_asset_id: string;
  asset_id: string;
  notes?: string;
  selected_at: string;
}

export interface AssetLedgerWorkflowState {
  review?: AssetReviewLedgerState;
  placements: AssetPlacementState[];
  selection?: AssetLedgerSelectionState;
}

export interface AssetLedgerRecord {
  id: string;
  project: string;
  canonical_asset_id: string;
  checksum_sha256?: string;
  media_type: AssetContentType;
  title: string;
  status: string;
  channel?: string;
  campaign?: string;
  audience?: string;
  updated_at: string;
  first_seen_at?: string;
  last_seen_at: string;
  indexed_by_run_id?: string;
  sources: AssetLedgerSource[];
  workflow: AssetLedgerWorkflowState;
}

export interface AssetLedgerIndexSummary {
  project: string;
  database: string;
  records: number;
  assets_indexed: number;
  source_mode: AssetLedgerIndexSourceMode;
  include_live_s3: boolean;
  sources: Record<AssetLedgerSourceType, number>;
  run: AssetLedgerIndexRun;
  fetchedAt: string;
}

export interface AssetLedgerSnapshot {
  project: string;
  database: string;
  records: AssetLedgerRecord[];
  last_index_run?: AssetLedgerIndexRun;
  totals: {
    records: number;
    local: number;
    catalog: number;
    s3: number;
  };
  fetchedAt: string;
}
