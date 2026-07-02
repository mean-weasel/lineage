import type { AssetLibrarySnapshot, AssetSelectionSet } from '../../shared/types';

export function assetBoardContext(
  snapshot: AssetLibrarySnapshot | null,
  source: 'local' | 'catalog' | 'all',
  activeReviewSet?: AssetSelectionSet | null
) {
  const total = snapshot?.pagination.total ?? 0;
  const sourceLabel = source === 'all' ? 'all sources' : source;
  const bucketLabel = `${snapshot?.catalog.default_bucket || 'Loading bucket'} · ${snapshot?.catalog.default_region || 'us-east-1'}`;
  const title = source === 'all' ? `${total} matching assets` : `${total} matching ${sourceLabel} assets`;
  const reviewCandidateCount = activeReviewSet?.items.length || 0;
  const note = total === 0 && reviewCandidateCount > 0
    ? `Active review set still has ${reviewCandidateCount} candidate${reviewCandidateCount === 1 ? '' : 's'} outside this asset filter.`
    : undefined;

  return {
    note,
    subtitle: `${bucketLabel} · filter: ${sourceLabel}`,
    title,
  };
}
