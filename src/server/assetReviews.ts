import type { SQLOutputValue } from 'node:sqlite';
import { indexLineageAssets, updateAssetReview } from './assetLineage';
import { lineageDb } from './assetLineageDb';
import { listAssets } from './assetCore';
import type { AssetLibrarySnapshot, AssetReviewState, BatchReviewFields, BatchReviewResponse, GrowthAsset, ReviewFields } from '../shared/types';

export interface AssetReviewSummary {
  asset_id: string;
  review_state: AssetReviewState;
  reviewed_at?: string;
  ignored_at?: string;
  notes?: string;
  updated_at: string;
}

interface AssetReviewDbRow {
  asset_id: string;
  review_state: AssetReviewState;
  reviewed_at: string | null;
  ignored_at: string | null;
  notes: string | null;
  updated_at: string;
}

const reviewStates = new Set<AssetReviewState>(['unreviewed', 'approved', 'needs_revision', 'rejected', 'ignored']);

class AssetReviewError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function isAssetReviewError(error: unknown): error is AssetReviewError {
  return error instanceof AssetReviewError;
}

function stringColumn(row: Record<string, SQLOutputValue>, column: keyof AssetReviewDbRow): string {
  const value = row[column];
  if (typeof value !== 'string') throw new TypeError(`Invalid asset review row column: ${column}`);
  return value;
}

function nullableStringColumn(row: Record<string, SQLOutputValue>, column: keyof AssetReviewDbRow): string | null {
  const value = row[column];
  if (value === null || typeof value === 'string') return value;
  throw new TypeError(`Invalid asset review row column: ${column}`);
}

function toAssetReviewDbRow(row: Record<string, SQLOutputValue>): AssetReviewDbRow {
  const reviewState = stringColumn(row, 'review_state');
  if (!reviewStates.has(reviewState as AssetReviewState)) throw new TypeError(`Invalid asset review state: ${reviewState}`);
  return {
    asset_id: stringColumn(row, 'asset_id'),
    review_state: reviewState as AssetReviewState,
    reviewed_at: nullableStringColumn(row, 'reviewed_at'),
    ignored_at: nullableStringColumn(row, 'ignored_at'),
    notes: nullableStringColumn(row, 'notes'),
    updated_at: stringColumn(row, 'updated_at'),
  };
}

function toAssetReviewSummary(row: AssetReviewDbRow): AssetReviewSummary {
  return {
    asset_id: row.asset_id,
    review_state: row.review_state,
    reviewed_at: row.reviewed_at ?? undefined,
    ignored_at: row.ignored_at ?? undefined,
    notes: row.notes ?? undefined,
    updated_at: row.updated_at,
  };
}

export function getAssetReviewMap(project: string, assetIds: string[]): Record<string, AssetReviewSummary> {
  if (assetIds.length === 0) return {};
  indexLineageAssets(project);
  const database = lineageDb();
  try {
    const placeholders = assetIds.map(() => '?').join(',');
    const rows = database.prepare(`
      select asset_id, review_state, reviewed_at, ignored_at, notes, updated_at
      from asset_reviews
      where asset_id in (${placeholders})
    `).all(...assetIds).map(toAssetReviewDbRow);
    return Object.fromEntries(rows.map(row => [row.asset_id, toAssetReviewSummary(row)]));
  } finally {
    database.close();
  }
}

export function markAssetReview(project: string, fields: ReviewFields) {
  indexLineageAssets(project);
  return updateAssetReview(project, fields);
}

function localAssetIds(project: string): Set<string> {
  return new Set(localAssets(project).map(asset => asset.asset_id));
}

function localAssets(project: string): GrowthAsset[] {
  const first = listAssets(project, { page: 1, pageSize: 100, source: 'local' });
  const assets = [...first.assets];
  for (let page = 2; page <= first.pagination.totalPages; page += 1) {
    assets.push(...listAssets(project, { page, pageSize: 100, source: 'local' }).assets);
  }
  return assets;
}

function uniqueAssetIds(assetIds: string[]): string[] {
  const ids = assetIds.map(assetId => assetId.trim()).filter(Boolean);
  return [...new Set(ids)];
}

export function markAssetReviews(project: string, fields: BatchReviewFields): BatchReviewResponse {
  if (!reviewStates.has(fields.reviewState)) throw new AssetReviewError(`Unsupported local review state: ${fields.reviewState}`);
  const assetIds = uniqueAssetIds(fields.assetIds);
  if (assetIds.length < 1) throw new AssetReviewError('Batch local review requires at least one asset id');
  const knownLocalIds = localAssetIds(project);
  const unknownIds = assetIds.filter(assetId => !knownLocalIds.has(assetId));
  if (unknownIds.length > 0) throw new AssetReviewError(`Unknown local asset${unknownIds.length === 1 ? '' : 's'}: ${unknownIds.join(', ')}`, 404);

  if (!fields.confirmWrite) {
    const results = assetIds.map(assetId => ({
      asset_id: assetId,
      dryRun: true as const,
      notes: fields.notes,
      review_state: fields.reviewState,
    }));
    return {
      ok: true,
      dryRun: true,
      message: `Would mark ${assetIds.length} local asset${assetIds.length === 1 ? '' : 's'} ${fields.reviewState}`,
      review_state: fields.reviewState,
      notes: fields.notes,
      count: results.length,
      results,
    };
  }

  indexLineageAssets(project);
  const results = assetIds.map(assetId => {
    const result = updateAssetReview(project, {
      assetId,
      confirmWrite: true,
      notes: fields.notes,
      reviewState: fields.reviewState,
    });
    return {
      asset_id: result.asset_id,
      message: result.message,
      notes: fields.notes,
      review_state: result.review_state,
    };
  });
  return {
    ok: true,
    message: `Marked ${results.length} local asset${results.length === 1 ? '' : 's'} ${fields.reviewState}`,
    review_state: fields.reviewState,
    notes: fields.notes,
    count: results.length,
    results,
  };
}

function normalizeReviewState(value: unknown): AssetReviewState {
  const rawState = typeof value === 'string' ? value : 'unreviewed';
  return rawState.replace(/-/g, '_') as AssetReviewState;
}

function batchReviewFieldsFromRequestBody(body: Record<string, unknown>): BatchReviewFields {
  if (!Array.isArray(body.assetIds)) throw new AssetReviewError('Batch local review requires assetIds array');
  const badAssetId = body.assetIds.find(assetId => typeof assetId !== 'string');
  if (badAssetId !== undefined) throw new AssetReviewError('Batch local review assetIds must be strings');
  return {
    assetIds: body.assetIds,
    reviewState: normalizeReviewState(body.reviewState || body.state),
    notes: typeof body.notes === 'string' ? body.notes : undefined,
    confirmWrite: body.confirmWrite === true && body.dryRun !== true,
  };
}

export function markAssetReviewsFromRequestBody(project: string, body: Record<string, unknown>): BatchReviewResponse {
  return markAssetReviews(project, batchReviewFieldsFromRequestBody(body));
}

export function requireApprovedLocalBackup(project: string, asset: GrowthAsset): AssetReviewSummary {
  if (!asset.local?.relative_path) throw new AssetReviewError(`Asset is not local-only: ${asset.asset_id}`);
  const review = getAssetReviewMap(project, [asset.asset_id])[asset.asset_id];
  if (review?.review_state !== 'approved') throw new AssetReviewError(`Local backup requires approved local review for ${asset.asset_id}`, 403);
  return review;
}

export function requireApprovedLocalBackupPath(project: string, relativePath: string): GrowthAsset {
  const asset = localAssets(project).find(item => item.local?.relative_path === relativePath);
  if (!asset) throw new AssetReviewError(`Unknown local asset path: ${relativePath}`, 404);
  requireApprovedLocalBackup(project, asset);
  return asset;
}

export function withLocalReviewMetadata(project: string, snapshot: AssetLibrarySnapshot): AssetLibrarySnapshot {
  const localAssetIds = snapshot.assets.filter(asset => asset.local?.relative_path).map(asset => asset.asset_id);
  const reviewMap = getAssetReviewMap(project, localAssetIds);
  return {
    ...snapshot,
    assets: snapshot.assets.map(asset => {
      const review = reviewMap[asset.asset_id];
      if (!asset.local?.relative_path || !review) return asset;
      return { ...asset, review: { notes: review.notes, review_state: review.review_state, updated_at: review.updated_at } };
    }),
  };
}
