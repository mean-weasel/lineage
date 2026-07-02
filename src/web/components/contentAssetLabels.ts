import type { GrowthAsset } from '../../shared/types';

export function assetStorageLabel(asset?: GrowthAsset): string {
  if (!asset) return 'unresolved';
  if (asset.local && asset.s3) return 'local + S3';
  if (asset.s3) return 'S3';
  if (asset.local) return 'local only';
  return asset.source || 'catalog';
}
