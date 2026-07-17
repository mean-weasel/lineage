import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLineageTestProfile } from '../test/lineageTestProfile';
import { defaultProject, repoRoot } from './assetCore';
import { indexLineageAssets, updateAssetReview } from './assetLineage';
import { getReviewQueue } from './assetReviewQueue';
import { fileSha256 } from './localReview';

const dbDir = join(repoRoot, '.asset-scratch', 'vitest-review-queue-db');
const dbFile = join(dbDir, 'asset-lineage.sqlite');

describe('asset review queue', () => {
  beforeEach(() => {
    rmSync(dbDir, { force: true, recursive: true });
    useLineageTestProfile(dbFile);
  });

  it('summarizes local QA and posting state without live S3 access', () => {
    const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-review-queue');
    rmSync(scratchDir, { force: true, recursive: true });
    mkdirSync(scratchDir, { recursive: true });
    writeFileSync(join(scratchDir, 'demo-tiktok-vertical-review.png'), Buffer.from('queue-local'));

    try {
      const queue = getReviewQueue(defaultProject, { channel: 'tiktok', limit: 2 });
      const tiktok = queue.lanes.find(lane => lane.channel === 'tiktok');

      expect(queue.project).toBe(defaultProject);
      expect(queue.handoff.queueCommand).toContain('review queue');
      expect(queue.handoff.localListCommand).toContain('local list');
      expect(tiktok?.totals.needsQa).toBeGreaterThanOrEqual(1);
      expect(tiktok?.totals.readyToPost).toBeGreaterThanOrEqual(1);
      expect(tiktok?.needsQa.length).toBeLessThanOrEqual(2);
      expect(tiktok?.readyToPost.length).toBeLessThanOrEqual(2);
    } finally {
      rmSync(scratchDir, { force: true, recursive: true });
    }
  });

  it('splits local assets by review decision', () => {
    const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-review-queue-decisions');
    rmSync(scratchDir, { force: true, recursive: true });
    mkdirSync(scratchDir, { recursive: true });
    const approvedFile = join(scratchDir, 'demo-tiktok-approved-local.png');
    const revisionFile = join(scratchDir, 'demo-tiktok-needs-revision-local.png');
    writeFileSync(approvedFile, Buffer.from('approved-local'));
    writeFileSync(revisionFile, Buffer.from('needs-revision-local'));

    try {
      const approvedId = `local-${fileSha256(approvedFile).slice(0, 12)}`;
      const revisionId = `local-${fileSha256(revisionFile).slice(0, 12)}`;
      indexLineageAssets(defaultProject);
      updateAssetReview(defaultProject, { assetId: approvedId, confirmWrite: true, reviewState: 'approved' });
      updateAssetReview(defaultProject, {
        assetId: revisionId,
        confirmWrite: true,
        notes: 'Make the contrast stronger.',
        reviewState: 'needs_revision',
      });

      const queue = getReviewQueue(defaultProject, { channel: 'tiktok', limit: 8 });
      const tiktok = queue.lanes.find(lane => lane.channel === 'tiktok');

      expect(tiktok?.approvedLocal.map(asset => asset.asset_id)).toContain(approvedId);
      expect(tiktok?.needsRevision.map(asset => asset.asset_id)).toContain(revisionId);
      expect(tiktok?.needsQa.map(asset => asset.asset_id)).not.toContain(approvedId);
      expect(tiktok?.needsQa.map(asset => asset.asset_id)).not.toContain(revisionId);
      expect(tiktok?.needsRevision.find(asset => asset.asset_id === revisionId)?.review?.notes).toBe('Make the contrast stronger.');
    } finally {
      rmSync(scratchDir, { force: true, recursive: true });
    }
  });

  it('keeps scheduled catalog assets out of ready-to-post lanes', () => {
    const queue = getReviewQueue(defaultProject, { channel: 'linkedin', limit: 8 });
    const linkedin = queue.lanes.find(lane => lane.channel === 'linkedin');

    expect(linkedin?.scheduled.some(asset => asset.asset_id === 'demo-linkedin-upload-demo-done-static-grounded-v2')).toBe(true);
    expect(linkedin?.readyToPost.some(asset => asset.asset_id === 'demo-linkedin-upload-demo-done-static-grounded-v2')).toBe(false);
  });
});
