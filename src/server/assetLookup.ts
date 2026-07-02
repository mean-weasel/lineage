import { cleanProject, loadCatalog, repoRoot } from './assetCore';
import { listLocalReviewAssets } from './localReview';
import type { AssetLookupSnapshot, GrowthAsset } from '../shared/types';

class AssetLookupError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function isAssetLookupError(error: unknown): error is AssetLookupError {
  return error instanceof AssetLookupError;
}

export function lookupAssets(project: string, assetIds: string[]): AssetLookupSnapshot {
  const ids = [...new Set(assetIds.map(assetId => assetId.trim()).filter(Boolean))];
  if (ids.length > 50) throw new AssetLookupError('Asset lookup is limited to 50 asset IDs');
  const catalog = loadCatalog(cleanProject(project));
  const localAssets = listLocalReviewAssets(repoRoot, catalog.project, catalog);
  const byId = new Map<string, GrowthAsset>();
  for (const asset of [...catalog.assets, ...localAssets]) {
    if (ids.includes(asset.asset_id) && !byId.has(asset.asset_id)) byId.set(asset.asset_id, asset);
  }
  return {
    project: catalog.project,
    assets: ids.flatMap(assetId => byId.get(assetId) || []),
    missing: ids.filter(assetId => !byId.has(assetId)),
    fetchedAt: new Date().toISOString(),
  };
}
