import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listContentPosts } from '../../contentBatches';
import { getContentTarget } from '../../contentTargets';
import { repoRoot } from '../../assetCore';
import { buildBufferPostPayload, createBufferPostingAdapter } from './bufferPostingAdapter';
import type { ContentPost } from '../../../shared/types';
import type { PostingCommandResult } from './types';

export class PostingAdapterError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function isPostingAdapterError(error: unknown): error is PostingAdapterError {
  return error instanceof PostingAdapterError;
}

export interface BufferDryRunFields {
  bufferChannelId: string;
  execute?: boolean;
  postId?: string;
  target?: 'selected';
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'buffer-post';
}

function resolvePost(project: string, fields: BufferDryRunFields): { post: ContentPost; source: 'post' | 'selected_target' } {
  if (fields.postId) {
    const post = listContentPosts(project).posts.find(item => item.id === fields.postId);
    if (!post) throw new PostingAdapterError(`Unknown content post: ${fields.postId}`, 404);
    return { post, source: 'post' };
  }
  if (fields.target === 'selected') {
    const target = getContentTarget(project);
    if (!target.target) throw new PostingAdapterError(`No selected content target exists for ${project}`, 404);
    return { post: target.target.post, source: 'selected_target' };
  }
  throw new PostingAdapterError('Buffer dry run requires postId or target=selected');
}

function payloadPath(project: string, postId: string): string {
  return join(repoRoot, '.asset-scratch', 'buffer-dry-runs', safeSegment(project), `${safeSegment(postId)}.json`);
}

function writePayload(project: string, postId: string, payload: Record<string, unknown>): string {
  const file = payloadPath(project, postId);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

function dryRunCommand(inputPath: string): string[] {
  return ['posts', 'create', '--input', inputPath, '--dry-run', '--output', 'json'];
}

function runner(): (args: string[]) => PostingCommandResult {
  return () => ({ stdout: JSON.stringify({ ok: true, dryRun: true }), stderr: '' });
}

export function dryRunBufferContentPost(project: string, fields: BufferDryRunFields, env: NodeJS.ProcessEnv = process.env) {
  if (!fields.bufferChannelId.trim()) throw new PostingAdapterError('Buffer dry run requires bufferChannelId');
  const { post, source } = resolvePost(project, fields);
  const request = {
    post,
    target: {
      channelId: fields.bufferChannelId,
      label: post.channel,
    },
  };
  const payload = buildBufferPostPayload(request);
  const inputPath = writePayload(project, post.id, payload);
  const attachedAssets = post.assets.map(asset => ({
    asset_id: asset.asset_id,
    role: asset.role,
    publishable_url: null,
    reason: 'No public media URL is attached to the content post yet.',
  }));
  const adapter = createBufferPostingAdapter({
    env,
    runBuffer: runner(),
    writePayload: () => inputPath,
  });
  const status = adapter.status();
  const result = fields.execute ? adapter.dryRunPost(request) : {
    command: dryRunCommand(inputPath),
    output: null,
    payload,
    provider: 'buffer',
  };
  return {
    ok: true as const,
    project,
    provider: 'buffer',
    mode: 'dry-run-only' as const,
    executed: fields.execute === true,
    can_post: false,
    configured: status.configured,
    missing: status.missing,
    source,
    post: {
      id: post.id,
      batch_id: post.batch_id,
      channel: post.channel,
      phase: post.phase,
      scheduled_at: post.scheduled_at,
      title: post.title,
    },
    target: {
      buffer_channel_id: fields.bufferChannelId,
      label: post.channel,
    },
    command: result.command,
    payload_path: inputPath,
    payload: result.payload,
    output: result.output,
    attached_assets: attachedAssets,
    warnings: [
      'Live Buffer posting is disabled for this adapter tranche.',
      ...(attachedAssets.length > 0 ? ['Attached assets are not included as Buffer media until they have public publishable URLs.'] : []),
    ],
    fetchedAt: new Date().toISOString(),
  };
}
