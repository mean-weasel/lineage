import { describe, expect, it } from 'vitest';
import type { GrowthAsset } from '../../shared/types';
import { assetStorageLabel } from './contentAssetLabels';

function asset(fields: Partial<GrowthAsset>): GrowthAsset {
  return {
    asset_id: 'asset-1',
    audience: 'founders',
    campaign: 'test',
    channel: 'tiktok',
    content_type: 'image',
    cta: 'Try it',
    hook: 'Hook',
    product: 'bleep-that-shit',
    project: 'bleep-that-shit',
    status: 'working',
    title: 'Asset',
    utm_content: 'asset',
    ...fields,
  };
}

describe('content asset storage labels', () => {
  it('labels local, s3, combined, and unresolved assets', () => {
    expect(assetStorageLabel(undefined)).toBe('unresolved');
    expect(assetStorageLabel(asset({ source: 'catalog' }))).toBe('catalog');
    expect(assetStorageLabel(asset({ local: {} as GrowthAsset['local'] }))).toBe('local only');
    expect(assetStorageLabel(asset({ s3: {} as GrowthAsset['s3'] }))).toBe('S3');
    expect(assetStorageLabel(asset({ local: {} as GrowthAsset['local'], s3: {} as GrowthAsset['s3'] }))).toBe('local + S3');
  });
});
