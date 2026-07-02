import { describe, expect, it } from 'vitest';
import type { GrowthAsset } from '../../shared/types';
import { lineageAssetSearchPath, lineageCreateWorkspaceBody, lineageDefaultWorkspaceTitle } from './lineageNewWorkspaceModel';

const asset = {
  asset_id: 'local-explicit-root',
  title: 'Explicit root concept',
} as GrowthAsset;

describe('lineage new workspace helpers', () => {
  it('searches local and catalog assets without live S3 reads', () => {
    const path = lineageAssetSearchPath('bleep-that-shit', 'hook idea', 8);
    const url = new URL(path, 'http://asset-studio.local');

    expect(url.pathname).toBe('/api/assets');
    expect(url.searchParams.get('project')).toBe('bleep-that-shit');
    expect(url.searchParams.get('source')).toBe('all');
    expect(url.searchParams.get('pageSize')).toBe('8');
    expect(url.searchParams.get('q')).toBe('hook idea');
    expect(url.searchParams.get('live')).toBeNull();
  });

  it('prefills titles from the explicitly chosen root asset', () => {
    expect(lineageDefaultWorkspaceTitle(asset)).toBe('Explicit root concept lineage');
  });

  it('creates workspace payloads from the explicit selected asset', () => {
    expect(lineageCreateWorkspaceBody('bleep-that-shit', asset, ' Root exploration ', ' Try vertical variations ')).toEqual({
      project: 'bleep-that-shit',
      rootAssetId: 'local-explicit-root',
      title: 'Root exploration',
      notes: 'Try vertical variations',
      activate: true,
      confirmWrite: true,
    });
  });
});
