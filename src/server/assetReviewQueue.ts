import { defaultProject, listAssets } from './assetCore';
import { getAssetReviewMap } from './assetReviews';
import type { GrowthAsset, ListAssetsOptions, ReviewQueueLane, ReviewQueueSnapshot, ReviewableAsset } from '../shared/types';

interface QueueOptions {
  channel?: string;
  limit?: number;
}

function allAssets(project: string, source: ListAssetsOptions['source']): GrowthAsset[] {
  const first = listAssets(project, { page: 1, pageSize: 100, source });
  const assets = [...first.assets];
  for (let page = 2; page <= first.pagination.totalPages; page += 1) {
    assets.push(...listAssets(project, { page, pageSize: 100, source }).assets);
  }
  return assets;
}

function isPosted(asset: GrowthAsset): boolean {
  return Boolean(asset.placements?.some(placement => placement.status === 'posted'));
}

function isScheduled(asset: GrowthAsset): boolean {
  return Boolean(asset.placements?.some(placement => placement.status === 'scheduled'));
}

function isReadyToPost(asset: GrowthAsset): boolean {
  return asset.status !== 'archived' && Boolean(asset.s3?.key) && !isPosted(asset) && !isScheduled(asset);
}

function withReviews(project: string, assets: GrowthAsset[]): ReviewableAsset[] {
  const reviewMap = getAssetReviewMap(project, assets.map(asset => asset.asset_id));
  return assets.map(asset => ({
    ...asset,
    review: reviewMap[asset.asset_id]
      ? {
          notes: reviewMap[asset.asset_id].notes,
          review_state: reviewMap[asset.asset_id].review_state,
          updated_at: reviewMap[asset.asset_id].updated_at,
        }
      : { review_state: 'unreviewed' },
  }));
}

function reviewState(asset: ReviewableAsset) {
  return asset.review?.review_state || 'unreviewed';
}

function laneFor(channel: string, localAssets: ReviewableAsset[], catalogAssets: GrowthAsset[], limit: number): ReviewQueueLane {
  const reviewedLocal = localAssets.filter(asset => asset.channel === channel);
  const needsQa = reviewedLocal.filter(asset => reviewState(asset) === 'unreviewed');
  const approvedLocal = reviewedLocal.filter(asset => reviewState(asset) === 'approved');
  const needsRevision = reviewedLocal.filter(asset => reviewState(asset) === 'needs_revision');
  const rejectedLocal = reviewedLocal.filter(asset => reviewState(asset) === 'rejected' || reviewState(asset) === 'ignored');
  const readyToPost = catalogAssets.filter(asset => asset.channel === channel && isReadyToPost(asset));
  const scheduled = catalogAssets.filter(asset => asset.channel === channel && isScheduled(asset) && !isPosted(asset));
  const posted = catalogAssets.filter(asset => asset.channel === channel && isPosted(asset));
  return {
    approvedLocal: approvedLocal.slice(0, limit),
    channel,
    needsQa: needsQa.slice(0, limit),
    needsRevision: needsRevision.slice(0, limit),
    posted: posted.slice(0, limit),
    readyToPost: readyToPost.slice(0, limit),
    rejectedLocal: rejectedLocal.slice(0, limit),
    scheduled: scheduled.slice(0, limit),
    totals: {
      approvedLocal: approvedLocal.length,
      needsQa: needsQa.length,
      needsRevision: needsRevision.length,
      posted: posted.length,
      readyToPost: readyToPost.length,
      rejectedLocal: rejectedLocal.length,
      scheduled: scheduled.length,
    },
  };
}

function handoff(project: string) {
  const prefix = `npm run studio:cli --`;
  return {
    backupTemplate: `${prefix} local backup --project ${project} --asset-id <local-id> --dry-run --json`,
    lineageNextTemplate: `${prefix} lineage next --project ${project} --root <root-id> --json`,
    localListCommand: `${prefix} local list --project ${project} --json`,
    queueCommand: `${prefix} review queue --project ${project} --json`,
    scheduleTemplate: `${prefix} placement mark-scheduled --project ${project} --asset-id <asset-id> --channel <channel> --scheduled-at <iso> --dry-run --json`,
  };
}

export function getReviewQueue(project = defaultProject, options: QueueOptions = {}): ReviewQueueSnapshot {
  const limit = Math.min(Math.max(Number(options.limit || 6), 1), 24);
  const localAssets = allAssets(project, 'local');
  const catalogAssets = allAssets(project, 'catalog');
  const channels = Array.from(new Set([...localAssets, ...catalogAssets].map(asset => asset.channel)))
    .filter(channel => !options.channel || options.channel === 'all' || channel === options.channel)
    .sort();
  const channelSet = new Set(channels);
  const reviewedLocalAssets = withReviews(project, localAssets.filter(asset => channelSet.has(asset.channel)));
  const lanes = channels.map(channel => laneFor(channel, reviewedLocalAssets, catalogAssets, limit));
  return {
    fetchedAt: new Date().toISOString(),
    handoff: handoff(project),
    lanes,
    project,
    totals: {
      approvedLocal: lanes.reduce((sum, lane) => sum + lane.totals.approvedLocal, 0),
      channels: lanes.length,
      needsQa: lanes.reduce((sum, lane) => sum + lane.totals.needsQa, 0),
      needsRevision: lanes.reduce((sum, lane) => sum + lane.totals.needsRevision, 0),
      posted: lanes.reduce((sum, lane) => sum + lane.totals.posted, 0),
      readyToPost: lanes.reduce((sum, lane) => sum + lane.totals.readyToPost, 0),
      rejectedLocal: lanes.reduce((sum, lane) => sum + lane.totals.rejectedLocal, 0),
      scheduled: lanes.reduce((sum, lane) => sum + lane.totals.scheduled, 0),
    },
  };
}
