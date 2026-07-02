import { getAssetLedgerSnapshot, indexAssetLedger } from './assetLedger';
import type { AssetLedgerIndexSourceMode, AssetLedgerRecord, AssetReviewState, PlacementStatus } from '../shared/types';

export type LedgerStorageFilter = 'all' | 'local-only' | 's3-backed' | 'local-and-s3' | 'catalog-only';
export type LedgerReviewFilter = 'all' | AssetReviewState;
export type LedgerPlacementFilter = 'all' | PlacementStatus | 'not-posted' | 'not-scheduled';
export type LedgerSelectionFilter = 'all' | 'selected' | 'not-selected';

export interface LedgerPageOptions {
  page?: number;
  pageSize?: number;
  placement?: LedgerPlacementFilter;
  query?: string;
  refresh?: boolean;
  review?: LedgerReviewFilter;
  selection?: LedgerSelectionFilter;
  source?: AssetLedgerIndexSourceMode;
  storage?: LedgerStorageFilter;
}

const storageFilters = new Set<LedgerStorageFilter>(['all', 'local-only', 's3-backed', 'local-and-s3', 'catalog-only']);
const reviewFilters = new Set<LedgerReviewFilter>(['all', 'unreviewed', 'approved', 'needs_revision', 'rejected', 'ignored']);
const placementFilters = new Set<LedgerPlacementFilter>(['all', 'planned', 'scheduled', 'posted', 'skipped', 'not-posted', 'not-scheduled']);
const selectionFilters = new Set<LedgerSelectionFilter>(['all', 'selected', 'not-selected']);

function normalizeFilter<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  return typeof value === 'string' && allowed.has(value as T) ? value as T : fallback;
}

function sourceTypes(record: AssetLedgerRecord) {
  return new Set(record.sources.map(source => source.source_type));
}

function matchesStorage(record: AssetLedgerRecord, storage: LedgerStorageFilter): boolean {
  const types = sourceTypes(record);
  if (storage === 'local-only') return types.has('local') && !types.has('s3');
  if (storage === 's3-backed') return types.has('s3');
  if (storage === 'local-and-s3') return types.has('local') && types.has('s3');
  if (storage === 'catalog-only') return types.has('catalog') && !types.has('local') && !types.has('s3');
  return true;
}

function matchesPlacement(record: AssetLedgerRecord, placement: LedgerPlacementFilter): boolean {
  if (placement === 'not-scheduled') return record.workflow.placements.length === 0;
  if (placement === 'not-posted') return !record.workflow.placements.some(item => item.status === 'posted');
  if (placement === 'all') return true;
  return record.workflow.placements.some(item => item.status === placement);
}

function matchesSelection(record: AssetLedgerRecord, selection: LedgerSelectionFilter): boolean {
  if (selection === 'selected') return Boolean(record.workflow.selection);
  if (selection === 'not-selected') return !record.workflow.selection;
  return true;
}

function filterLedgerRecords(records: AssetLedgerRecord[], options: LedgerPageOptions = {}) {
  const placement = normalizeFilter(options.placement, placementFilters, 'all');
  const review = normalizeFilter(options.review, reviewFilters, 'all');
  const selection = normalizeFilter(options.selection, selectionFilters, 'all');
  const storage = normalizeFilter(options.storage, storageFilters, 'all');
  const query = options.query?.trim().toLowerCase() || '';
  return records.filter(record => {
    if (!matchesStorage(record, storage)) return false;
    if (review !== 'all' && (record.workflow.review?.review_state || 'unreviewed') !== review) return false;
    if (!matchesPlacement(record, placement)) return false;
    if (!matchesSelection(record, selection)) return false;
    if (!query) return true;
    return [
      record.canonical_asset_id,
      record.title,
      record.status,
      record.channel,
      record.campaign,
      record.audience,
      record.workflow.review?.review_state,
      ...record.workflow.placements.map(item => `${item.channel} ${item.status}`),
    ].join(' ').toLowerCase().includes(query);
  });
}

export function getLedgerPage(project: string, options: LedgerPageOptions = {}) {
  const pageSize = Math.min(Math.max(Number(options.pageSize || 25), 1), 100);
  const page = Math.max(Number(options.page || 1), 1);
  const indexSummary = options.refresh ? indexAssetLedger(project, { source: options.source || 'all' }) : undefined;
  const snapshot = getAssetLedgerSnapshot(project);
  const records = filterLedgerRecords(snapshot.records, options);
  const totalPages = Math.max(Math.ceil(records.length / pageSize), 1);
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    ...snapshot,
    records: records.slice(start, start + pageSize),
    index_summary: indexSummary,
    pagination: { page: safePage, pageSize, total: records.length, totalPages },
  };
}

export function getLedgerPageFromQuery(project: string, query: Record<string, unknown>) {
  return getLedgerPage(project, {
    page: Number(query.page || 1),
    pageSize: Number(query.pageSize || 25),
    placement: normalizeFilter(query.placement, placementFilters, 'all'),
    query: typeof query.q === 'string' ? query.q : undefined,
    refresh: query.refresh === 'true',
    review: normalizeFilter(query.review, reviewFilters, 'all'),
    selection: normalizeFilter(query.selection, selectionFilters, 'all'),
    source: typeof query.source === 'string' ? query.source as AssetLedgerIndexSourceMode : 'all',
    storage: normalizeFilter(query.storage, storageFilters, 'all'),
  });
}
