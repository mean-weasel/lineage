import express, { type Express } from 'express';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultProject, repoRoot } from './assetCore';
import { createAgentClaim } from './agentClaims';
import { fileSha256 } from './localReview';
import { attachContentPostAsset, createContentBatch, createContentPost, updateContentPost } from './contentBatches';
import { contentBatchRouter } from './contentBatchRoutes';
import { getContentOpsQueue, getContentOpsQueueLane, getContentOpsQueueNext, getContentOpsQueueSummary } from './contentOpsQueue';
import { setContentTarget } from './contentTargets';
import type { ContentOpsQueueLaneId, ContentOpsQueueSnapshot } from '../shared/types';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-content-ops-queue');
const dbFile = join(scratchDir, 'content-ops-queue.sqlite');
let server: ReturnType<Express['listen']> | null = null;
let postClaimTokens: Record<string, string> = {};

function resetDb() {
  rmSync(scratchDir, { force: true, recursive: true });
  process.env.LINEAGE_DB = dbFile;
  postClaimTokens = {};
}

function appWithContentRoutes() {
  const app = express();
  app.use(express.json());
  app.use('/api/content', contentBatchRouter(input => {
    const candidate = input.body?.project || input.query?.project;
    return typeof candidate === 'string' ? candidate : defaultProject;
  }));
  server = app.listen(0);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function seedLocalAsset(): string {
  const file = join(scratchDir, 'demo-tiktok-local-queue.png');
  mkdirSync(scratchDir, { recursive: true });
  writeFileSync(file, Buffer.from('content-ops-queue-local'));
  return `local-${fileSha256(file).slice(0, 12)}`;
}

function claimPost(postId: string): string {
  postClaimTokens[postId] ||= createAgentClaim({
    agentName: `queue test agent for ${postId}`,
    channel: 'tiktok',
    project: defaultProject,
    scopeType: 'content_post',
    targetId: postId,
    targetTitle: postId,
  }).claim_token;
  return postClaimTokens[postId];
}

function seedQueuePosts() {
  const localAssetId = seedLocalAsset();
  createContentBatch(defaultProject, {
    batchId: 'queue-batch',
    campaign: '2026-06-organic-traffic-test',
    channel: 'tiktok',
    confirmWrite: true,
    title: 'Queue batch',
  });
  for (const [postId, phase] of [
    ['needs-post', 'draft'],
    ['ready-local-post', 'draft'],
    ['review-s3-post', 'review'],
    ['scheduled-unresolved-post', 'scheduled'],
    ['posted-post', 'posted'],
    ['skipped-post', 'skipped'],
  ] as const) {
    createContentPost(defaultProject, {
      batchId: 'queue-batch',
      channel: 'tiktok',
      confirmWrite: true,
      phase,
      postId,
      title: postId,
    });
  }
  attachContentPostAsset(defaultProject, { assetId: localAssetId, claimToken: claimPost('ready-local-post'), confirmWrite: true, postId: 'ready-local-post' });
  attachContentPostAsset(defaultProject, {
    assetId: 'demo-tiktok-upload-demo-export-vertical',
    claimToken: claimPost('review-s3-post'),
    confirmWrite: true,
    postId: 'review-s3-post',
  });
  attachContentPostAsset(defaultProject, { assetId: 'missing-queue-asset', claimToken: claimPost('scheduled-unresolved-post'), confirmWrite: true, postId: 'scheduled-unresolved-post' });
  setContentTarget(defaultProject, { claimToken: claimPost('review-s3-post'), confirmWrite: true, notes: 'Next review handoff', postId: 'review-s3-post' });
}

function lane(queue: ContentOpsQueueSnapshot, id: ContentOpsQueueLaneId) {
  const found = queue.lanes.find(item => item.id === id);
  if (!found) throw new Error(`Missing queue lane ${id}`);
  return found;
}

describe('content ops queue', () => {
  beforeEach(resetDb);

  afterEach(() => {
    server?.close();
    server = null;
  });

  it('groups SQLite content posts into daily operating lanes with storage cues', () => {
    seedQueuePosts();
    const queue = getContentOpsQueue(defaultProject);

    expect(queue.target?.post.id).toBe('review-s3-post');
    expect(queue.totals).toMatchObject({
      attached_assets: 3,
      posts: 6,
      selected_target: 1,
      storage: { local: 1, s3: 1, total: 3, unresolved: 1 },
    });
    expect(lane(queue, 'next_target').items.map(item => item.post.id)).toEqual(['review-s3-post']);
    expect(queue.next_action?.post.id).toBe('needs-post');
    expect(queue.next_action_lane).toMatchObject({ id: 'needs_asset', total: 1 });
    expect(lane(queue, 'needs_asset').items.map(item => item.post.id)).toEqual(['needs-post']);
    expect(lane(queue, 'draft_ready').items.map(item => item.post.id)).toEqual(['ready-local-post']);
    expect(lane(queue, 'draft_ready').items[0].backup_cue).toMatchObject({
      label: '1 local-only · 1 need review before backup',
      local_only: 1,
      needs_review: 1,
    });
    expect(lane(queue, 'draft_ready').items[0].backup_cue?.local_review_command).toContain('local review');
    expect(lane(queue, 'draft_ready').items[0].backup_cue?.local_backup_command).toContain('--dry-run');
    expect(lane(queue, 'in_review').items[0]).toMatchObject({
      asset_storage: { s3: 1 },
      backup_cue: { label: '1 S3 backed', s3_backed: 1 },
      handoff: { moveToReviewCommand: expect.stringContaining('--phase review') },
      is_target: true,
      post: { id: 'review-s3-post' },
    });
    expect(lane(queue, 'scheduled').items[0]).toMatchObject({
      asset_storage: { unresolved: 1 },
      post: { id: 'scheduled-unresolved-post' },
    });
    expect(lane(queue, 'posted').total).toBe(1);
    expect(lane(queue, 'skipped_or_archived').total).toBe(1);
    expect(queue.handoff.inspectQueueCommand).toContain('content queue inspect');
  });

  it('serves the queue over the content HTTP API', async () => {
    seedQueuePosts();
    const baseUrl = appWithContentRoutes();
    const response = await fetch(`${baseUrl}/api/content/queue?project=${defaultProject}`);
    const queue = await response.json() as ContentOpsQueueSnapshot;

    expect(response.ok).toBe(true);
    expect(queue.lanes.map(item => item.id)).toContain('next_target');
    expect(queue.totals.lanes.in_review).toBe(1);
    expect(queue.target?.readiness).toBe('in_review');
  });

  it('updates queue lanes as post phases change', () => {
    seedQueuePosts();
    updateContentPost(defaultProject, { claimToken: claimPost('ready-local-post'), confirmWrite: true, phase: 'review', postId: 'ready-local-post' });
    const queue = getContentOpsQueue(defaultProject);

    expect(lane(queue, 'draft_ready').total).toBe(0);
    expect(lane(queue, 'in_review').items.map(item => item.post.id).sort()).toEqual(['ready-local-post', 'review-s3-post']);
  });

  it('returns compact next, lane, and summary queue projections for agents', () => {
    seedQueuePosts();
    const next = getContentOpsQueueNext(defaultProject);
    const reviewLane = getContentOpsQueueLane(defaultProject, 'in_review');
    const summary = getContentOpsQueueSummary(defaultProject);

    expect(next.next).toMatchObject({
      post_id: 'needs-post',
      readiness: 'needs_asset',
      asset_storage: { total: 0 },
    });
    expect(next.next_action).toMatchObject({ post_id: 'needs-post' });
    expect(next.next_action_lane).toBe('needs_asset');
    expect(next.target).toMatchObject({ post_id: 'review-s3-post', readiness: 'in_review' });
    expect(next.lane).toMatchObject({ id: 'needs_asset', total: 1 });
    expect(reviewLane.lane.items).toHaveLength(1);
    expect(reviewLane.lane.items[0]).toMatchObject({
      backup_cue: { label: '1 S3 backed' },
      next_commands: { moveToReviewCommand: expect.stringContaining('--phase review') },
      post_id: 'review-s3-post',
    });
    expect(summary).toMatchObject({
      lanes: { next_target: 1, draft_ready: 1, needs_asset: 1 },
      next: { post_id: 'needs-post' },
      next_action: { post_id: 'needs-post' },
      next_action_lane: 'needs_asset',
      next_lane: 'needs_asset',
      storage: { local: 1, s3: 1, unresolved: 1 },
      target: { post_id: 'review-s3-post' },
      totals: { posts: 6, selected_target: 1 },
    });
    expect(summary.handoff.nextQueueCommand).toContain('content queue next');
  }, 15000);

  it('keeps a scheduled selected target separate from next actionable work', () => {
    seedQueuePosts();
    updateContentPost(defaultProject, {
      claimToken: claimPost('review-s3-post'),
      confirmWrite: true,
      phase: 'scheduled',
      postId: 'review-s3-post',
      scheduledAt: '2026-06-26T16:00:00-07:00',
    });
    const next = getContentOpsQueueNext(defaultProject);
    const summary = getContentOpsQueueSummary(defaultProject);

    expect(next.target).toMatchObject({ post_id: 'review-s3-post', readiness: 'scheduled' });
    expect(next.next).toMatchObject({ post_id: 'needs-post', readiness: 'needs_asset' });
    expect(next.next_action).toMatchObject({ post_id: 'needs-post', readiness: 'needs_asset' });
    expect(next.lane).toMatchObject({ id: 'needs_asset' });
    expect(summary.target).toMatchObject({ post_id: 'review-s3-post', readiness: 'scheduled' });
    expect(summary.next_action).toMatchObject({ post_id: 'needs-post', readiness: 'needs_asset' });
    expect(summary.next_action_lane).toBe('needs_asset');
  });
});
