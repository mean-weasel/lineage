import type { PostingAdapter, PostingAdapterStatus, PostingCommandResult, PostingDryRunRequest, PostingDryRunResult } from './types';

interface BufferPostingAdapterDependencies {
  env?: NodeJS.ProcessEnv;
  runBuffer(args: string[]): PostingCommandResult;
  writePayload(payload: Record<string, unknown>): string;
}

function missingConfig(env: NodeJS.ProcessEnv): string[] {
  return ['LINEAGE_SCHEDULER_TOKEN', 'LINEAGE_SCHEDULER_ORGANIZATION_ID'].filter(key => !env[key]);
}

function textForPost(request: PostingDryRunRequest): string {
  const body = request.post.body?.trim() || request.post.title.trim();
  const cta = request.post.cta?.trim();
  const parts = [body, cta].filter(Boolean);
  const text = parts.join('\n\n').trim();
  if (!text) throw new Error('Buffer post text is required');
  return text;
}

export function buildBufferPostPayload(request: PostingDryRunRequest): Record<string, unknown> {
  const channelId = request.target.channelId.trim();
  if (!channelId) throw new Error('Buffer channelId is required');
  const scheduledAt = request.post.scheduled_at?.trim();
  const payload: Record<string, unknown> = {
    channelId,
    mode: scheduledAt ? 'schedule' : 'addToQueue',
    schedulingType: scheduledAt ? 'scheduled' : 'automatic',
    text: textForPost(request),
  };
  if (scheduledAt) payload.scheduledAt = scheduledAt;
  const media = (request.assets || [])
    .filter(asset => asset.url.trim())
    .map(asset => ({
      altText: asset.altText || asset.assetId,
      url: asset.url,
    }));
  if (media.length > 0) payload.media = media;
  return payload;
}

export function createBufferPostingAdapter(deps: BufferPostingAdapterDependencies): PostingAdapter {
  return {
    dryRunPost(request: PostingDryRunRequest): PostingDryRunResult {
      const payload = buildBufferPostPayload(request);
      const inputPath = deps.writePayload(payload);
      const command = ['posts', 'create', '--input', inputPath, '--dry-run', '--output', 'json'];
      const result = deps.runBuffer(command);
      return {
        command,
        output: result.stdout.trim() ? JSON.parse(result.stdout) as unknown : null,
        payload,
        provider: 'buffer',
      };
    },

    postLive(): never {
      throw new Error('Live Buffer posting is disabled for this adapter tranche. Use dryRunPost and record reviewed scheduling/posted state in SQLite.');
    },

    status(): PostingAdapterStatus {
      const missing = missingConfig(deps.env || process.env);
      return {
        can_dry_run: true,
        can_post: false,
        configured: missing.length === 0,
        missing,
        mode: 'dry-run-only',
        provider: 'buffer',
      };
    },
  };
}
