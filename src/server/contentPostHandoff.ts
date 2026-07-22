import type { ContentPost, ContentPostReadiness, ContentTargetHandoff } from '../shared/types';
import { lineageCliCommand, shellQuote } from './lineageRuntimeCommand';

export function readinessForPost(post: ContentPost): ContentPostReadiness {
  if (post.phase === 'skipped' || post.phase === 'archived') return 'skipped_or_archived';
  if (post.phase === 'posted') return 'posted';
  if (post.phase === 'scheduled') return 'scheduled';
  if (post.phase === 'review') return 'in_review';
  return post.assets.length === 0 ? 'needs_asset' : 'draft_ready';
}

export function contentPostHandoff(project: string, post?: ContentPost): ContentTargetHandoff {
  const quotedProject = shellQuote(project);
  const postId = post ? shellQuote(post.id) : '<post-id>';
  const batchId = post?.batch_id ? shellQuote(post.batch_id) : undefined;
  return {
    agentPrompt: post
      ? `Continue content iterations for ${post.title} (${post.id}) on ${post.channel}. Inspect the target, generate or choose assets, attach approved candidates, then move the post through review before scheduling.`
      : 'Inspect or set a content target before generating content or asset variations.',
    attachAssetTemplate: lineageCliCommand(`content post attach-asset --project ${quotedProject} --post-id ${postId} --asset-id <asset-id> --role primary --confirm-write`),
    clearTargetCommand: lineageCliCommand(`content target clear --project ${quotedProject} --confirm-write`),
    ...(batchId ? { inspectBatchCommand: lineageCliCommand(`content batch inspect --project ${quotedProject} --batch-id ${batchId}`) } : {}),
    inspectTargetCommand: lineageCliCommand(`content target inspect --project ${quotedProject}`),
    markPostedTemplate: lineageCliCommand(`content post phase --project ${quotedProject} --post-id ${postId} --phase posted --posted-at <iso> --url <url> --confirm-write`),
    moveToReviewCommand: lineageCliCommand(`content post phase --project ${quotedProject} --post-id ${postId} --phase review --confirm-write`),
    scheduleTemplate: lineageCliCommand(`content post phase --project ${quotedProject} --post-id ${postId} --phase scheduled --scheduled-at <iso> --confirm-write`),
    setTargetTemplate: lineageCliCommand(`content target set --project ${quotedProject} --post-id ${postId} --notes <notes> --confirm-write`),
  };
}
