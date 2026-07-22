import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLineageTestProfile } from '../test/lineageTestProfile';
import { defaultProject, repoRoot } from './assetCore';
import { lineageDb } from './assetLineageDb';
import { createAgentClaim } from './agentClaims';
import {
  attachContentPostAsset,
  createContentBatch,
  createContentPost,
  detachContentPostAsset,
  getContentBatch,
  listContentBatches,
  listContentPosts,
  updateContentPost,
} from './contentBatches';
import { clearContentTarget, getContentTarget, readinessForPost, setContentTarget } from './contentTargets';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-content-batches');
const dbFile = join(scratchDir, 'content-batches.sqlite');

function resetDb() {
  rmSync(scratchDir, { force: true, recursive: true });
  useLineageTestProfile(dbFile);
}

function seedBatch(batchId = 'demo-priority-june') {
  createContentBatch(defaultProject, {
    batchId,
    campaign: '2026-06-organic-traffic-test',
    channel: 'tiktok',
    confirmWrite: true,
    notes: 'Priority demo content.',
    title: 'Demo priority June',
  });
}

function seedPost(postId = 'tiktok-upload-clean') {
  createContentPost(defaultProject, {
    batchId: 'demo-priority-june',
    campaign: '2026-06-organic-traffic-test',
    channel: 'tiktok',
    confirmWrite: true,
    cta: 'Try Demo That Shit',
    phase: 'draft',
    postId,
    sourcePath: 'demo-project/channels/tiktok/drafts/2026-06-tiktok-upload-demo-export.md',
    title: 'Upload, demo, export',
  });
}

function claimPost(postId = 'tiktok-upload-clean', channel = 'tiktok'): string {
  return createAgentClaim({
    agentName: `test agent for ${postId}`,
    channel,
    project: defaultProject,
    scopeType: 'content_post',
    targetId: postId,
    targetTitle: postId,
  }).claim_token;
}

function claimChannel(channel = 'tiktok'): string {
  return createAgentClaim({
    agentName: `test channel agent for ${channel}`,
    channel,
    project: defaultProject,
    scopeType: 'project_channel',
    targetId: `${defaultProject}:channel:${channel}`,
    targetTitle: `${channel} channel`,
  }).claim_token;
}

describe('content batch ledger', () => {
  beforeEach(resetDb);

  it('previews writes without creating a SQLite file', () => {
    rmSync(dbFile, { force: true });
    const batch = createContentBatch(defaultProject, {
      batchId: 'dry-run-batch',
      confirmWrite: false,
      title: 'Dry run batch',
    });
    const post = createContentPost(defaultProject, {
      batchId: 'dry-run-batch',
      channel: 'linkedin',
      confirmWrite: false,
      postId: 'dry-run-post',
      title: 'Dry run post',
    });

    expect(batch).toMatchObject({ dryRun: true, preview: { id: 'dry-run-batch' } });
    expect(post).toMatchObject({ dryRun: true, preview: { postId: 'dry-run-post', phase: 'draft' } });
    expect(existsSync(dbFile)).toBe(false);
  });

  it('creates batches and posts with attached assets', () => {
    seedBatch();
    seedPost();
    const claimToken = claimPost();

    const attach = attachContentPostAsset(defaultProject, {
      assetId: 'demo-tiktok-upload-demo-export-vertical',
      claimToken,
      confirmWrite: true,
      notes: 'Primary vertical static.',
      postId: 'tiktok-upload-clean',
      role: 'primary',
    });
    const detail = getContentBatch(defaultProject, 'demo-priority-june');

    expect(attach).toMatchObject({ ok: true, post: { id: 'tiktok-upload-clean' } });
    expect(detail.batch).toMatchObject({ channel: 'tiktok', id: 'demo-priority-june' });
    expect(detail.posts[0]).toMatchObject({
      assets: [{ asset_id: 'demo-tiktok-upload-demo-export-vertical', role: 'primary' }],
      handoff: {
        attachAssetTemplate: expect.stringContaining("--post-id 'tiktok-upload-clean'"),
        setTargetTemplate: expect.stringContaining('content target set'),
      },
      phase: 'draft',
      readiness: 'draft_ready',
      source_path: 'demo-project/channels/tiktok/drafts/2026-06-tiktok-upload-demo-export.md',
    });
    expect(detail.handoff.attachAssetTemplate).toContain('content post attach-asset');
  });

  it('tracks post phases without changing asset placement state', () => {
    seedBatch();
    seedPost();
    const claimToken = claimPost();

    const scheduled = updateContentPost(defaultProject, {
      claimToken,
      confirmWrite: true,
      phase: 'scheduled',
      postId: 'tiktok-upload-clean',
      scheduledAt: '2026-06-26T16:00:00-07:00',
    });
    const posted = updateContentPost(defaultProject, {
      claimToken,
      confirmWrite: true,
      phase: 'posted',
      postId: 'tiktok-upload-clean',
      postedAt: '2026-06-27T16:00:00-07:00',
      url: 'https://example.test/post',
    });

    expect(scheduled).toMatchObject({ post: { phase: 'scheduled', scheduled_at: '2026-06-26T16:00:00-07:00' } });
    expect(posted).toMatchObject({ post: { phase: 'posted', posted_at: '2026-06-27T16:00:00-07:00', url: 'https://example.test/post' } });
    expect(listContentBatches(defaultProject).batches[0].phase_counts.posted).toBe(1);
  });

  it('lists posts by batch, channel, and phase filters', () => {
    seedBatch();
    seedPost('tiktok-upload-clean');
    createContentPost(defaultProject, {
      batchId: 'demo-priority-june',
      channel: 'linkedin',
      confirmWrite: true,
      phase: 'review',
      postId: 'linkedin-clean-export',
      title: 'Clean export proof',
    });

    expect(listContentPosts(defaultProject, { channel: 'tiktok' }).posts.map(post => post.id)).toEqual(['tiktok-upload-clean']);
    expect(listContentPosts(defaultProject, { phase: 'review' }).posts.map(post => post.id)).toEqual(['linkedin-clean-export']);
    expect(listContentPosts(defaultProject, { phase: 'review' }).posts[0]).toMatchObject({
      handoff: { moveToReviewCommand: expect.stringContaining('--phase review') },
      readiness: 'in_review',
    });
    expect(listContentPosts(defaultProject, { batchId: 'demo-priority-june' }).posts).toHaveLength(2);
  });

  it('keeps batch ids scoped to each project', () => {
    seedBatch('shared-batch');
    createContentBatch('another-project', {
      batchId: 'shared-batch',
      channel: 'youtube',
      confirmWrite: true,
      title: 'Other project batch',
    });

    expect(getContentBatch(defaultProject, 'shared-batch').batch.channel).toBe('tiktok');
    expect(getContentBatch('another-project', 'shared-batch').batch.channel).toBe('youtube');
  });

  it('rejects moving a post to an unknown batch', () => {
    seedBatch();
    seedPost();

    expect(() =>
      updateContentPost(defaultProject, {
        batchId: 'missing-batch',
        confirmWrite: true,
        postId: 'tiktok-upload-clean',
      })
    ).toThrow('Unknown content batch: missing-batch');
  });

  it('detaches an asset from a post', () => {
    seedBatch();
    seedPost();
    const claimToken = claimPost();
    attachContentPostAsset(defaultProject, {
      assetId: 'demo-tiktok-upload-demo-export-vertical',
      claimToken,
      confirmWrite: true,
      postId: 'tiktok-upload-clean',
    });

    const detached = detachContentPostAsset(defaultProject, {
      assetId: 'demo-tiktok-upload-demo-export-vertical',
      claimToken,
      confirmWrite: true,
      postId: 'tiktok-upload-clean',
    });

    expect(detached).toMatchObject({ post: { assets: [] } });
  });

  it('tracks one selected content target per project with handoff commands', () => {
    seedBatch();
    seedPost();
    const claimToken = claimPost();
    attachContentPostAsset(defaultProject, {
      assetId: 'demo-tiktok-upload-demo-export-vertical',
      claimToken,
      confirmWrite: true,
      postId: 'tiktok-upload-clean',
    });

    const selected = setContentTarget(defaultProject, {
      claimToken,
      confirmWrite: true,
      notes: 'Use this as the next variation base.',
      postId: 'tiktok-upload-clean',
    });
    const inspected = getContentTarget(defaultProject);

    expect(selected).toMatchObject({ ok: true, selected: true });
    expect(inspected.target).toMatchObject({
      batch: { id: 'demo-priority-june' },
      notes: 'Use this as the next variation base.',
      post: { id: 'tiktok-upload-clean' },
      readiness: 'draft_ready',
    });
    expect(inspected.target?.handoff.attachAssetTemplate).toContain("--post-id 'tiktok-upload-clean'");
    expect(inspected.target?.handoff.moveToReviewCommand).toContain('--phase review');
    expect(inspected.target?.handoff.agentPrompt).toContain('Upload, demo, export');
  });

  it('reports no target and clears selected content targets safely', () => {
    seedBatch();
    seedPost();

    expect(getContentTarget(defaultProject)).toMatchObject({ selected: false, target: null });
    expect(setContentTarget(defaultProject, { confirmWrite: false, postId: 'tiktok-upload-clean' })).toMatchObject({ dryRun: true });
    setContentTarget(defaultProject, { confirmWrite: true, postId: 'tiktok-upload-clean' });
    const cleared = clearContentTarget(defaultProject, true);

    expect(cleared).toMatchObject({ ok: true, selected: false, target: null });
  });

  it('requires a matching claim to set or clear an actively claimed content target', () => {
    seedBatch();
    seedPost();
    const claimToken = claimPost();

    expect(setContentTarget(defaultProject, {
      confirmWrite: false,
      postId: 'tiktok-upload-clean',
    })).toMatchObject({ dryRun: true });
    expect(() => setContentTarget(defaultProject, {
      confirmWrite: true,
      postId: 'tiktok-upload-clean',
    })).toThrow('Mutating agent write requires a matching claim token.');
    expect(setContentTarget(defaultProject, {
      claimToken,
      confirmWrite: true,
      postId: 'tiktok-upload-clean',
    })).toMatchObject({ ok: true, target: { post: { id: 'tiktok-upload-clean' } } });
    expect(() => clearContentTarget(defaultProject, true)).toThrow('Mutating agent write requires a matching claim token.');
    expect(clearContentTarget(defaultProject, true, claimToken)).toMatchObject({ ok: true, selected: false, target: null });
  });

  it('rejects selecting an unknown content post', () => {
    seedBatch();

    expect(() => setContentTarget(defaultProject, { confirmWrite: true, postId: 'missing-post' })).toThrow('Unknown content post: missing-post');
  });

  it('clears stale selected content targets instead of crashing inspect', () => {
    seedBatch();
    const database = lineageDb();
    try {
      database.exec('PRAGMA foreign_keys = OFF');
      database.prepare(`
        insert into content_targets (project_id, post_id, notes, selected_at, updated_at)
        values (?, 'deleted-post', 'legacy stale target', '2026-06-25T00:00:00.000Z', '2026-06-25T00:00:00.000Z')
      `).run(defaultProject);
    } finally {
      database.close();
    }

    const stale = getContentTarget(defaultProject);
    const next = getContentTarget(defaultProject);

    expect(stale).toMatchObject({
      selected: false,
      target: null,
      warning: 'Selected content target deleted-post no longer exists and was cleared.',
    });
    expect(next).toMatchObject({ selected: false, target: null });
    expect(next.warning).toBeUndefined();
  });

  it('derives content target readiness from post phase and assets', () => {
    seedBatch();
    seedPost();
    const claimToken = claimPost();
    const draft = getContentBatch(defaultProject, 'demo-priority-june').posts[0]!;
    attachContentPostAsset(defaultProject, { assetId: 'asset-1', claimToken, confirmWrite: true, postId: 'tiktok-upload-clean' });
    const ready = getContentBatch(defaultProject, 'demo-priority-june').posts[0]!;
    const review = updateContentPost(defaultProject, { claimToken, confirmWrite: true, phase: 'review', postId: 'tiktok-upload-clean' }).post!;
    const scheduled = updateContentPost(defaultProject, { claimToken, confirmWrite: true, phase: 'scheduled', postId: 'tiktok-upload-clean' }).post!;
    const posted = updateContentPost(defaultProject, { claimToken, confirmWrite: true, phase: 'posted', postId: 'tiktok-upload-clean' }).post!;
    const archived = updateContentPost(defaultProject, { claimToken, confirmWrite: true, phase: 'archived', postId: 'tiktok-upload-clean' }).post!;

    expect(readinessForPost(draft)).toBe('needs_asset');
    expect(readinessForPost(ready)).toBe('draft_ready');
    expect(readinessForPost(review)).toBe('in_review');
    expect(readinessForPost(scheduled)).toBe('scheduled');
    expect(readinessForPost(posted)).toBe('posted');
    expect(readinessForPost(archived)).toBe('skipped_or_archived');
  });

  it('requires a matching content post claim for asset attachment and post updates', () => {
    seedBatch();
    seedPost();
    const claimToken = claimPost();

    expect(updateContentPost(defaultProject, {
      body: 'Dry-run claimed body edit',
      confirmWrite: false,
      postId: 'tiktok-upload-clean',
    })).toMatchObject({ dryRun: true });
    expect(() =>
      updateContentPost(defaultProject, {
        body: 'Claimed body edit without a token',
        confirmWrite: true,
        postId: 'tiktok-upload-clean',
      })
    ).toThrow('Mutating agent write requires a matching claim token.');
    expect(() =>
      attachContentPostAsset(defaultProject, {
        assetId: 'asset-1',
        confirmWrite: true,
        postId: 'tiktok-upload-clean',
      })
    ).toThrow('Mutating agent write requires a matching claim token.');
    expect(() =>
      updateContentPost(defaultProject, {
        claimToken: 'claim_wrong.secret',
        confirmWrite: true,
        phase: 'review',
        postId: 'tiktok-upload-clean',
      })
    ).toThrow('Unknown or invalid claim token.');
    expect(updateContentPost(defaultProject, {
      body: 'Claimed body edit with a token',
      claimToken,
      confirmWrite: true,
      postId: 'tiktok-upload-clean',
    })).toMatchObject({ ok: true, post: { body: 'Claimed body edit with a token' } });
    expect(updateContentPost(defaultProject, {
      claimToken,
      confirmWrite: true,
      phase: 'review',
      postId: 'tiktok-upload-clean',
    })).toMatchObject({ ok: true, post: { phase: 'review' } });
  });

  it('allows unclaimed content post metadata updates without a claim token', () => {
    seedBatch();
    seedPost();

    expect(updateContentPost(defaultProject, {
      body: 'Unclaimed body edit',
      confirmWrite: true,
      postId: 'tiktok-upload-clean',
    })).toMatchObject({ ok: true, post: { body: 'Unclaimed body edit' } });
  });

  it('uses project channel claims as broad same-channel authority without blocking other channels', () => {
    seedBatch();
    seedPost();
    createContentPost(defaultProject, {
      batchId: 'demo-priority-june',
      channel: 'linkedin',
      confirmWrite: true,
      phase: 'draft',
      postId: 'linkedin-unclaimed',
      title: 'LinkedIn unclaimed',
    });
    const claimToken = claimChannel('tiktok');

    expect(() =>
      attachContentPostAsset(defaultProject, {
        assetId: 'asset-1',
        confirmWrite: true,
        postId: 'tiktok-upload-clean',
      })
    ).toThrow('Mutating agent write requires a matching claim token.');
    expect(attachContentPostAsset(defaultProject, {
      assetId: 'asset-1',
      claimToken,
      confirmWrite: true,
      postId: 'tiktok-upload-clean',
    })).toMatchObject({ ok: true, post: { id: 'tiktok-upload-clean' } });
    expect(attachContentPostAsset(defaultProject, {
      assetId: 'asset-2',
      confirmWrite: true,
      postId: 'linkedin-unclaimed',
    })).toMatchObject({ ok: true, post: { id: 'linkedin-unclaimed' } });
    expect(updateContentPost(defaultProject, {
      body: 'Same-channel body edit',
      claimToken,
      confirmWrite: true,
      postId: 'tiktok-upload-clean',
    })).toMatchObject({ ok: true, post: { body: 'Same-channel body edit' } });
    expect(() =>
      updateContentPost(defaultProject, {
        body: 'Wrong-channel body edit',
        claimToken,
        confirmWrite: true,
        postId: 'linkedin-unclaimed',
      })
    ).toThrow('Claim channel tiktok does not match linkedin.');
  });
});
