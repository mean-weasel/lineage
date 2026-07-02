import { describe, expect, it } from 'vitest';
import { buildBufferPostPayload, createBufferPostingAdapter } from './bufferPostingAdapter';
import type { PostingDryRunRequest } from './types';

const baseRequest: PostingDryRunRequest = {
  assets: [
    { assetId: 'asset-001', altText: 'Workflow screenshot', url: 'https://assets.example.test/asset-001.png' },
  ],
  post: {
    body: 'A clean export flow for bleeped launch clips.',
    channel: 'linkedin',
    cta: 'Review the workflow',
    id: 'linkedin-export-flow',
    scheduled_at: undefined,
    title: 'Bleep export flow',
  },
  target: {
    channelId: 'buffer-channel-linkedin',
    label: 'LinkedIn company page',
  },
};

describe('buffer posting adapter', () => {
  it('reports dry-run-only status without requiring credentials', () => {
    const adapter = createBufferPostingAdapter({
      env: {},
      runBuffer: () => ({ stdout: '{}', stderr: '' }),
      writePayload: () => 'payload.json',
    });

    expect(adapter.status()).toEqual({
      can_dry_run: true,
      can_post: false,
      configured: false,
      missing: ['BUFFER_API_KEY', 'BUFFER_ORGANIZATION_ID'],
      mode: 'dry-run-only',
      provider: 'buffer',
    });
  });

  it('reports configured status when Buffer env is available but still refuses live posting', () => {
    const adapter = createBufferPostingAdapter({
      env: { BUFFER_API_KEY: 'token', BUFFER_ORGANIZATION_ID: 'org-1' },
      runBuffer: () => ({ stdout: '{}', stderr: '' }),
      writePayload: () => 'payload.json',
    });

    expect(adapter.status()).toMatchObject({ configured: true, missing: [], can_post: false });
    expect(() => adapter.postLive(baseRequest)).toThrow('Live Buffer posting is disabled');
  });

  it('builds an automatic Buffer payload from an internal content post shape', () => {
    expect(buildBufferPostPayload(baseRequest)).toEqual({
      channelId: 'buffer-channel-linkedin',
      media: [{ altText: 'Workflow screenshot', url: 'https://assets.example.test/asset-001.png' }],
      mode: 'addToQueue',
      schedulingType: 'automatic',
      text: 'A clean export flow for bleeped launch clips.\n\nReview the workflow',
    });
  });

  it('builds a scheduled Buffer payload when the internal post is scheduled', () => {
    expect(buildBufferPostPayload({
      ...baseRequest,
      assets: [],
      post: { ...baseRequest.post, scheduled_at: '2026-07-01T16:00:00-07:00' },
    })).toEqual({
      channelId: 'buffer-channel-linkedin',
      mode: 'schedule',
      scheduledAt: '2026-07-01T16:00:00-07:00',
      schedulingType: 'scheduled',
      text: 'A clean export flow for bleeped launch clips.\n\nReview the workflow',
    });
  });

  it('runs the Buffer CLI dry-run command through injected payload writing and runner', () => {
    const payloads: Record<string, unknown>[] = [];
    const commands: string[][] = [];
    const adapter = createBufferPostingAdapter({
      env: {},
      runBuffer: args => {
        commands.push(args);
        return { stdout: JSON.stringify({ ok: true, dryRun: true }), stderr: '' };
      },
      writePayload: payload => {
        payloads.push(payload);
        return '.asset-scratch/buffer/linkedin-export-flow.json';
      },
    });

    expect(adapter.dryRunPost(baseRequest)).toEqual({
      command: ['posts', 'create', '--input', '.asset-scratch/buffer/linkedin-export-flow.json', '--dry-run', '--output', 'json'],
      output: { ok: true, dryRun: true },
      payload: payloads[0],
      provider: 'buffer',
    });
    expect(commands).toEqual([
      ['posts', 'create', '--input', '.asset-scratch/buffer/linkedin-export-flow.json', '--dry-run', '--output', 'json'],
    ]);
    expect(payloads[0]).toMatchObject({ channelId: 'buffer-channel-linkedin', text: expect.stringContaining('clean export flow') });
  });

  it('rejects missing Buffer channel and empty post text before running the CLI', () => {
    const adapter = createBufferPostingAdapter({
      env: {},
      runBuffer: () => { throw new Error('runner should not be called'); },
      writePayload: () => 'payload.json',
    });

    expect(() => adapter.dryRunPost({ ...baseRequest, target: { channelId: '   ' } })).toThrow('Buffer channelId is required');
    expect(() => adapter.dryRunPost({
      ...baseRequest,
      post: { ...baseRequest.post, body: ' ', cta: ' ', title: ' ' },
    })).toThrow('Buffer post text is required');
  });
});
