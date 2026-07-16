import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLineageTestProfile } from '../../../test/lineageTestProfile';
import { defaultProject, repoRoot } from '../../assetCore';
import { attachContentPostAsset, createContentBatch, createContentPost } from '../../contentBatches';
import { setContentTarget } from '../../contentTargets';
import { dryRunBufferContentPost } from './bufferPostingService';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-buffer-posting-service');
const dbFile = join(scratchDir, 'buffer-posting-service.sqlite');

function resetDb() {
  rmSync(scratchDir, { force: true, recursive: true });
  useLineageTestProfile(dbFile);
}

function seedPost() {
  createContentBatch(defaultProject, {
    batchId: 'buffer-batch',
    campaign: 'buffer-campaign',
    channel: 'linkedin',
    confirmWrite: true,
    title: 'Buffer batch',
  });
  createContentPost(defaultProject, {
    batchId: 'buffer-batch',
    body: 'Show the clean review workflow for Demo.',
    channel: 'linkedin',
    confirmWrite: true,
    cta: 'Try the workflow',
    phase: 'scheduled',
    postId: 'linkedin-review-workflow',
    scheduledAt: '2026-07-01T16:00:00-07:00',
    title: 'Demo review workflow',
  });
}

describe('Buffer posting service', () => {
  beforeEach(resetDb);

  it('previews a Buffer dry-run payload from an explicit content post without credentials', () => {
    seedPost();
    attachContentPostAsset(defaultProject, {
      assetId: 'demo-linkedin-review-ready-carousel',
      confirmWrite: true,
      postId: 'linkedin-review-workflow',
      role: 'primary',
    });

    const result = dryRunBufferContentPost(defaultProject, {
      bufferChannelId: 'buffer-linkedin-page',
      postId: 'linkedin-review-workflow',
    }, {});

    expect(result).toMatchObject({
      can_post: false,
      configured: false,
      executed: false,
      mode: 'dry-run-only',
      missing: ['LINEAGE_SCHEDULER_TOKEN', 'LINEAGE_SCHEDULER_ORGANIZATION_ID'],
      post: { id: 'linkedin-review-workflow', phase: 'scheduled' },
      provider: 'buffer',
      source: 'post',
      target: { buffer_channel_id: 'buffer-linkedin-page' },
    });
    expect(result.command).toEqual(['posts', 'create', '--input', result.payload_path, '--dry-run', '--output', 'json']);
    expect(result.payload).toMatchObject({
      channelId: 'buffer-linkedin-page',
      mode: 'schedule',
      scheduledAt: '2026-07-01T16:00:00-07:00',
      text: 'Show the clean review workflow for Demo.\n\nTry the workflow',
    });
    expect(result.attached_assets).toEqual([
      expect.objectContaining({
        asset_id: 'demo-linkedin-review-ready-carousel',
        publishable_url: null,
      }),
    ]);
    expect(existsSync(result.payload_path)).toBe(true);
    expect(JSON.parse(readFileSync(result.payload_path, 'utf8'))).toEqual(result.payload);
  });

  it('can resolve the selected content target and optionally execute the injected dry-run runner', () => {
    seedPost();
    setContentTarget(defaultProject, { confirmWrite: true, postId: 'linkedin-review-workflow' });

    const result = dryRunBufferContentPost(defaultProject, {
      bufferChannelId: 'buffer-linkedin-page',
      execute: true,
      target: 'selected',
    }, { LINEAGE_SCHEDULER_TOKEN: 'token', LINEAGE_SCHEDULER_ORGANIZATION_ID: 'org' });

    expect(result).toMatchObject({
      configured: true,
      executed: true,
      missing: [],
      output: { ok: true, dryRun: true },
      source: 'selected_target',
    });
  });

  it('rejects ambiguous requests, missing posts, and missing Buffer channel ids before writing', () => {
    seedPost();

    expect(() => dryRunBufferContentPost(defaultProject, { bufferChannelId: 'buffer' })).toThrow('requires postId or target=selected');
    expect(() => dryRunBufferContentPost(defaultProject, { bufferChannelId: 'buffer', postId: 'missing-post' })).toThrow('Unknown content post');
    expect(() => dryRunBufferContentPost(defaultProject, { bufferChannelId: ' ', postId: 'linkedin-review-workflow' })).toThrow('requires bufferChannelId');
  });
});
