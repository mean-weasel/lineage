import type { ContentPost, ContentPostReadiness, ContentTargetHandoff } from '../shared/types';

export function readinessForPost(post: ContentPost): ContentPostReadiness {
  if (post.phase === 'skipped' || post.phase === 'archived') return 'skipped_or_archived';
  if (post.phase === 'posted') return 'posted';
  if (post.phase === 'scheduled') return 'scheduled';
  if (post.phase === 'review') return 'in_review';
  return post.assets.length === 0 ? 'needs_asset' : 'draft_ready';
}

export function contentPostHandoff(project: string, post?: ContentPost): ContentTargetHandoff {
  const prefix = 'npm run studio:cli -- content';
  const postId = post?.id || '<post-id>';
  const batchId = post?.batch_id;
  return {
    agentPrompt: post
      ? `Continue content iterations for ${post.title} (${post.id}) on ${post.channel}. Inspect the target, generate or choose assets, attach approved candidates, then move the post through review before scheduling.`
      : 'Inspect or set a content target before generating content or asset variations.',
    attachAssetTemplate: `${prefix} post attach-asset --project ${project} --post-id ${postId} --asset-id <asset-id> --role primary --confirm-write --json`,
    clearTargetCommand: `${prefix} target clear --project ${project} --confirm-write --json`,
    ...(batchId ? { inspectBatchCommand: `${prefix} batch inspect --project ${project} --batch-id ${batchId} --json` } : {}),
    inspectTargetCommand: `${prefix} target inspect --project ${project} --json`,
    markPostedTemplate: `${prefix} post phase --project ${project} --post-id ${postId} --phase posted --posted-at <iso> --url <url> --confirm-write --json`,
    moveToReviewCommand: `${prefix} post phase --project ${project} --post-id ${postId} --phase review --confirm-write --json`,
    scheduleTemplate: `${prefix} post phase --project ${project} --post-id ${postId} --phase scheduled --scheduled-at <iso> --confirm-write --json`,
    setTargetTemplate: `${prefix} target set --project ${project} --post-id ${postId} --notes <notes> --confirm-write --json`,
  };
}
