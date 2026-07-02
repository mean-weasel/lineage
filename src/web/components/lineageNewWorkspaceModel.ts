import type { GrowthAsset } from '../../shared/types';

export function lineageAssetSearchPath(project: string, query: string, pageSize = 8): string {
  const params = new URLSearchParams({ page: '1', pageSize: String(pageSize), project, source: 'all' });
  const trimmed = query.trim();
  if (trimmed) params.set('q', trimmed);
  return `/api/assets?${params.toString()}`;
}

export function lineageDefaultWorkspaceTitle(asset: Pick<GrowthAsset, 'asset_id' | 'title'>): string {
  return `${asset.title || asset.asset_id} lineage`;
}

export function lineageCreateWorkspaceBody(project: string, asset: Pick<GrowthAsset, 'asset_id'>, title: string, notes: string) {
  return {
    project,
    rootAssetId: asset.asset_id,
    title: title.trim(),
    notes: notes.trim() || undefined,
    activate: true,
    confirmWrite: true,
  };
}
