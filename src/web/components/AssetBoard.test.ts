import { describe, expect, it } from 'vitest';
import type { AssetLibrarySnapshot, AssetSelectionSet } from '../../shared/types';
import { assetBoardContext } from './assetBoardContext';

const snapshot = {
  assets: [],
  catalog: {
    asset_count: 27,
    default_bucket: 'lineage-demo-assets',
    default_region: 'us-east-1',
    product: 'demo-project',
    project: 'demo-project',
  },
  facets: {
    audiences: [],
    campaigns: [],
    channels: [],
    contentTypes: [],
    placementStatuses: [],
    statuses: [],
    totalSizeBytes: 0,
  },
  fetchedAt: '2026-06-26T00:00:00.000Z',
  liveObjects: [],
  orphanObjects: [],
  pagination: {
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1,
  },
} satisfies AssetLibrarySnapshot;

const reviewSet = {
  created_at: '2026-06-26T00:00:00.000Z',
  created_by: 'agent',
  id: 'demo-project:review:pass-02',
  items: [
    reviewItem('A', 'asset-a', 0),
    reviewItem('B', 'asset-b', 1),
  ],
  key: 'pass-02',
  kind: 'review',
  label: 'Pass 02',
  project: 'demo-project',
  status: 'active',
  updated_at: '2026-06-26T00:00:00.000Z',
} satisfies AssetSelectionSet;

describe('assetBoardContext', () => {
  it('names the current asset filter instead of implying the whole library is empty', () => {
    const context = assetBoardContext(snapshot, 'local', reviewSet);

    expect(context.title).toBe('0 matching local assets');
    expect(context.subtitle).toContain('filter: local');
    expect(context.note).toBe('Active review set still has 2 candidates outside this asset filter.');
  });

  it('keeps the note hidden when there is no off-filter review context', () => {
    const context = assetBoardContext({ ...snapshot, pagination: { ...snapshot.pagination, total: 3 } }, 'all', null);

    expect(context.title).toBe('3 matching assets');
    expect(context.subtitle).toContain('filter: all sources');
    expect(context.note).toBeUndefined();
  });
});

function reviewItem(label: string, assetId: string, position: number) {
  return {
    asset_id: assetId,
    created_at: '2026-06-26T00:00:00.000Z',
    id: `candidate-${label}`,
    position,
    role: 'candidate',
    set_id: 'set-review',
    updated_at: '2026-06-26T00:00:00.000Z',
    variation_label: label,
  } as const;
}
