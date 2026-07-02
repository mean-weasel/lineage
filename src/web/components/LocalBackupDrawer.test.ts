import { describe, expect, it } from 'vitest';
import type { AssetReviewState, GrowthAsset, ReviewableAsset } from '../../shared/types';
import { isApprovedLocal } from './LocalBackupDrawer';

function localAsset(reviewState?: AssetReviewState): GrowthAsset {
  return {
    asset_id: `local-${reviewState || 'unknown'}`,
    audience: 'local-review',
    campaign: 'local-review',
    channel: 'tiktok',
    content_type: 'image',
    cta: 'Review before upload',
    hook: 'Hook',
    local: {
      absolute_path: '/tmp/local.png',
      checksum_sha256: 'abc123',
      content_type: 'image/png',
      relative_path: 'local-review/local.png',
      size_bytes: 12,
      updated_at: '2026-06-24T00:00:00.000Z',
    },
    product: 'demo-project',
    project: 'demo-project',
    source: 'local',
    status: 'working',
    title: 'Local asset',
    utm_content: 'local_asset',
    ...(reviewState ? { review: { review_state: reviewState } } : {}),
  } as ReviewableAsset;
}

describe('LocalBackupDrawer approval gate', () => {
  it('allows only approved reviewed local assets through backup gating', () => {
    expect(isApprovedLocal(localAsset('approved'))).toBe(true);
    expect(isApprovedLocal(localAsset('needs_revision'))).toBe(false);
    expect(isApprovedLocal(localAsset('rejected'))).toBe(false);
    expect(isApprovedLocal(localAsset())).toBe(false);
  });
});
