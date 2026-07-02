import { listAssets } from './assetCore';
import { getAssetReviewMap } from './assetReviews';
import { nowIso } from './assetLineageDb';
import { listContentPosts } from './contentBatches';
import { getContentTarget, readinessForPost } from './contentTargets';
import type { AssetReviewState, ContentOpsQueueAssetStorage, ContentOpsQueueBackupCue, ContentOpsQueueItem, ContentOpsQueueLane, ContentOpsQueueLaneId, ContentOpsQueueLaneSummary, ContentOpsQueueSnapshot, ContentPost } from '../shared/types';

const lanes = [
  ['next_target', 'Next Target'],
  ['needs_asset', 'Needs Assets'],
  ['draft_ready', 'Draft Ready'],
  ['in_review', 'In Review'],
  ['scheduled', 'Scheduled'],
  ['posted', 'Posted'],
  ['skipped_or_archived', 'Skipped or Archived'],
] satisfies Array<[ContentOpsQueueLaneId, string]>;

type AssetSources = { local: boolean; review_state?: AssetReviewState; s3: boolean };
const actionableLaneOrder: ContentOpsQueueLaneId[] = ['needs_asset', 'draft_ready', 'in_review', 'scheduled'];

function emptyStorage(): ContentOpsQueueAssetStorage {
  return { local: 0, s3: 0, total: 0, unresolved: 0 };
}

function addStorage(left: ContentOpsQueueAssetStorage, right: ContentOpsQueueAssetStorage): ContentOpsQueueAssetStorage {
  return {
    local: left.local + right.local,
    s3: left.s3 + right.s3,
    total: left.total + right.total,
    unresolved: left.unresolved + right.unresolved,
  };
}

function collectAssetSources(project: string): Map<string, AssetSources> {
  const sources = new Map<string, AssetSources>();
  const pageSize = 100;
  let page = 1;
  while (true) {
    const snapshot = listAssets(project, { page, pageSize, source: 'all' });
    for (const asset of snapshot.assets) {
      const current = sources.get(asset.asset_id) || { local: false, s3: false };
      sources.set(asset.asset_id, {
        local: current.local || Boolean(asset.local),
        s3: current.s3 || Boolean(asset.s3),
      });
    }
    if (page >= snapshot.pagination.totalPages) break;
    page += 1;
  }
  const localAssetIds = [...sources].filter(([, source]) => source.local).map(([assetId]) => assetId);
  const reviewMap = getAssetReviewMap(project, localAssetIds);
  for (const assetId of localAssetIds) {
    const source = sources.get(assetId);
    if (source) source.review_state = reviewMap[assetId]?.review_state || 'unreviewed';
  }
  return sources;
}

function storageForPost(post: ContentPost, sources: Map<string, AssetSources>): ContentOpsQueueAssetStorage {
  return post.assets.reduce((storage, asset) => {
    const source = sources.get(asset.asset_id);
    return {
      local: storage.local + (source?.local ? 1 : 0),
      s3: storage.s3 + (source?.s3 ? 1 : 0),
      total: storage.total + 1,
      unresolved: storage.unresolved + (!source?.local && !source?.s3 ? 1 : 0),
    };
  }, emptyStorage());
}

function backupCueForPost(project: string, post: ContentPost, sources: Map<string, AssetSources>): ContentOpsQueueBackupCue | undefined {
  let approvedLocal = 0;
  let localAndS3 = 0;
  let localOnly = 0;
  let needsReview = 0;
  let s3Backed = 0;
  let unresolved = 0;
  let firstLocalOnly = '';
  for (const asset of post.assets) {
    const source = sources.get(asset.asset_id);
    if (source?.local && source.s3) localAndS3 += 1;
    else if (source?.local) {
      localOnly += 1;
      firstLocalOnly ||= asset.asset_id;
      if (source.review_state === 'approved') approvedLocal += 1;
      else needsReview += 1;
    } else if (source?.s3) s3Backed += 1;
    else unresolved += 1;
  }
  if (post.assets.length === 0) return undefined;
  const label = localOnly > 0
    ? `${localOnly} local-only${needsReview > 0 ? ` · ${needsReview} need review before backup` : ' · approved for backup'}`
    : localAndS3 > 0 ? `${localAndS3} local + S3 backed`
      : s3Backed > 0 ? `${s3Backed} S3 backed`
        : `${unresolved} unresolved`;
  return {
    approved_local: approvedLocal,
    label,
    local_and_s3: localAndS3,
    local_backup_command: firstLocalOnly ? `npm run studio:cli -- local backup --project ${project} --asset-id ${firstLocalOnly} --dry-run --json` : undefined,
    local_only: localOnly,
    local_queue_command: firstLocalOnly ? `npm run studio:cli -- local queue --project ${project} --json` : undefined,
    local_review_command: firstLocalOnly ? `npm run studio:cli -- local review --project ${project} --asset-id ${firstLocalOnly} --state approved --dry-run --json` : undefined,
    needs_review: needsReview,
    s3_backed: s3Backed,
    unresolved,
  };
}

function itemFor(project: string, post: ContentPost, targetPostId: string | undefined, sources: Map<string, AssetSources>): ContentOpsQueueItem {
  const readiness = post.readiness || readinessForPost(post);
  return {
    asset_storage: storageForPost(post, sources),
    attached_asset_count: post.assets.length,
    backup_cue: backupCueForPost(project, post, sources),
    handoff: post.handoff,
    is_target: post.id === targetPostId,
    post,
    readiness,
  };
}

function laneFor(id: ContentOpsQueueLaneId, items: ContentOpsQueueItem[]): ContentOpsQueueLane {
  const label = lanes.find(([laneId]) => laneId === id)?.[1] || id;
  return { id, label, items, total: items.length };
}

function laneSummary(lane: ContentOpsQueueLane): ContentOpsQueueLaneSummary {
  return { id: lane.id, label: lane.label, total: lane.total };
}

function prefix(): string {
  return `npm run studio:cli -- content queue`;
}

function compactItem(item: ContentOpsQueueItem | undefined) {
  if (!item) return null;
  return {
    asset_storage: item.asset_storage,
    attached_asset_count: item.attached_asset_count,
    batch_id: item.post.batch_id,
    channel: item.post.channel,
    is_target: item.is_target,
    next_commands: {
      attachAssetTemplate: item.handoff?.attachAssetTemplate,
      inspectBatchCommand: item.handoff?.inspectBatchCommand,
      markPostedTemplate: item.handoff?.markPostedTemplate,
      moveToReviewCommand: item.handoff?.moveToReviewCommand,
      scheduleTemplate: item.handoff?.scheduleTemplate,
      setTargetTemplate: item.handoff?.setTargetTemplate,
    },
    backup_cue: item.backup_cue,
    phase: item.post.phase,
    post_id: item.post.id,
    readiness: item.readiness,
    title: item.post.title,
  };
}

function firstLaneItem(queueLanes: ContentOpsQueueLane[], laneOrder: ContentOpsQueueLaneId[]): { item: ContentOpsQueueItem; lane: ContentOpsQueueLane } | null {
  for (const laneId of laneOrder) {
    const lane = queueLanes.find(candidate => candidate.id === laneId);
    const item = lane?.items[0];
    if (lane && item) return { item, lane };
  }
  return null;
}

function compactHandoff(project: string, queue: ContentOpsQueueSnapshot) {
  return {
    ...queue.handoff,
    inspectSummaryCommand: `${prefix()} inspect --project ${project} --summary --json`,
    nextQueueCommand: `${prefix()} next --project ${project} --json`,
  };
}

export function getContentOpsQueue(project: string): ContentOpsQueueSnapshot {
  const posts = listContentPosts(project).posts;
  const target = getContentTarget(project);
  const targetPostId = target.target?.post.id;
  const sources = collectAssetSources(project);
  const items = posts.map(post => itemFor(project, post, targetPostId, sources));
  const queueLanes = lanes.map(([id]) => {
    const laneItems = id === 'next_target'
      ? items.filter(item => item.is_target)
      : items.filter(item => item.readiness === id);
    return laneFor(id, laneItems);
  });
  const nextAction = firstLaneItem(queueLanes, actionableLaneOrder);
  const storage = items.reduce((total, item) => addStorage(total, item.asset_storage), emptyStorage());
  const laneTotals = Object.fromEntries(queueLanes.map(lane => [lane.id, lane.total])) as Record<ContentOpsQueueLaneId, number>;
  const contentPrefix = `npm run studio:cli -- content`;
  return {
    fetchedAt: nowIso(),
    handoff: {
      inspectQueueCommand: `${contentPrefix} queue inspect --project ${project} --json`,
      inspectTargetCommand: `${contentPrefix} target inspect --project ${project} --json`,
      listPostsCommand: `${contentPrefix} post list --project ${project} --json`,
    },
    lanes: queueLanes,
    next_action: nextAction?.item || null,
    next_action_lane: nextAction ? laneSummary(nextAction.lane) : null,
    project,
    target: target.target,
    totals: {
      attached_assets: items.reduce((sum, item) => sum + item.attached_asset_count, 0),
      lanes: laneTotals,
      posts: posts.length,
      selected_target: target.selected ? 1 : 0,
      storage,
    },
    warning: target.warning,
  };
}

export function getContentOpsQueueSummary(project: string) {
  const queue = getContentOpsQueue(project);
  const nextAction = queue.next_action && queue.next_action_lane ? { item: queue.next_action, lane: queue.next_action_lane } : null;
  return {
    fetchedAt: queue.fetchedAt,
    handoff: compactHandoff(project, queue),
    lanes: queue.totals.lanes,
    next: compactItem(nextAction?.item),
    next_action: compactItem(nextAction?.item),
    next_action_lane: nextAction?.lane.id || null,
    next_lane: nextAction?.lane.id || null,
    project: queue.project,
    storage: queue.totals.storage,
    target: compactItem(queue.lanes.find(lane => lane.id === 'next_target')?.items[0]),
    totals: {
      attached_assets: queue.totals.attached_assets,
      posts: queue.totals.posts,
      selected_target: queue.totals.selected_target,
    },
    warning: queue.warning,
  };
}

export function getContentOpsQueueNext(project: string) {
  const queue = getContentOpsQueue(project);
  const nextAction = queue.next_action && queue.next_action_lane ? { item: queue.next_action, lane: queue.next_action_lane } : null;
  return {
    fetchedAt: queue.fetchedAt,
    handoff: compactHandoff(project, queue),
    lane: nextAction ? nextAction.lane : null,
    next: compactItem(nextAction?.item),
    next_action: compactItem(nextAction?.item),
    next_action_lane: nextAction?.lane.id || null,
    project: queue.project,
    storage: queue.totals.storage,
    target: compactItem(queue.lanes.find(lane => lane.id === 'next_target')?.items[0]),
    warning: queue.warning || (nextAction ? undefined : 'No actionable content queue item found.'),
  };
}

export function getContentOpsQueueLane(project: string, laneId: ContentOpsQueueLaneId) {
  const queue = getContentOpsQueue(project);
  const lane = queue.lanes.find(item => item.id === laneId);
  if (!lane) throw new Error(`Unknown content queue lane: ${laneId}`);
  return {
    fetchedAt: queue.fetchedAt,
    handoff: compactHandoff(project, queue),
    lane: {
      id: lane.id,
      items: lane.items.map(compactItem),
      label: lane.label,
      total: lane.total,
    },
    project: queue.project,
    storage: queue.totals.storage,
    totals: queue.totals,
    warning: queue.warning,
  };
}
