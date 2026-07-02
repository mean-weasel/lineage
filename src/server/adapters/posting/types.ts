import type { ContentPost } from '../../../shared/types';

export interface PostingCommandResult {
  stdout: string;
  stderr: string;
}

export interface PostingAdapterStatus {
  can_dry_run: boolean;
  can_post: boolean;
  configured: boolean;
  missing: string[];
  mode: 'dry-run-only';
  provider: string;
}

export interface PostingAdapter {
  dryRunPost(request: PostingDryRunRequest): PostingDryRunResult;
  postLive(request: PostingDryRunRequest): never;
  status(): PostingAdapterStatus;
}

export interface PostingDryRunRequest {
  assets?: PostingPostAsset[];
  post: Pick<ContentPost, 'body' | 'channel' | 'cta' | 'id' | 'scheduled_at' | 'title'>;
  target: PostingPostTarget;
}

interface PostingPostAsset {
  altText?: string;
  assetId: string;
  url: string;
}

interface PostingPostTarget {
  channelId: string;
  label?: string;
}

export interface PostingDryRunResult {
  command: string[];
  output: unknown;
  payload: Record<string, unknown>;
  provider: string;
}
