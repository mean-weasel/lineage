import { describe, expect, it } from 'vitest';
import type { AssetReviewState, LineageNode } from '../../shared/types';
import { lineageReviewConflict } from './lineageReviewConflict';

const selectedNode = {
  asset_id: 'asset-1',
  is_latest: true,
  media_type: 'image',
  project: 'demo-project',
  review_state: 'unreviewed',
  source: 'local',
  status: 'planned',
  title: 'Selected asset',
  user_selected: true,
} satisfies LineageNode;

describe('lineageReviewConflict', () => {
  it.each(['approved', 'needs_revision'] satisfies AssetReviewState[])('keeps next-variation selection for %s', reviewState => {
    expect(lineageReviewConflict(selectedNode, reviewState)).toBeNull();
  });

  it.each(['rejected', 'ignored'] satisfies AssetReviewState[])('requires clearing selected asset for %s', reviewState => {
    expect(lineageReviewConflict(selectedNode, reviewState)).toMatchObject({ clearsSelection: true });
  });

  it('does not warn for assets that are not used for next variation', () => {
    expect(lineageReviewConflict({ ...selectedNode, user_selected: false }, 'rejected')).toBeNull();
  });
});
