import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultProject, listAssets, repoRoot } from './assetCore';
import { chooseReviewSetLabels, createReviewSet } from './assetSelections';
import { getAssetSelectionWorkPacket } from './assetSelectionWorkPacket';
import type { AssetLibrarySnapshot, GrowthAsset } from '../shared/types';

vi.mock('./assetCore', async importOriginal => {
  const actual = await importOriginal<typeof import('./assetCore')>();
  return { ...actual, listAssets: vi.fn(actual.listAssets) };
});

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-selection-work-packet');
const dbFile = join(scratchDir, 'selection-work-packet.sqlite');
const catalogAsset = 'demo-meta-short-form-upload-demo-post-static';
const mockedListAssets = vi.mocked(listAssets);

function resetDb() {
  rmSync(scratchDir, { force: true, recursive: true });
  process.env.LINEAGE_DB = dbFile;
  mockedListAssets.mockClear();
}

function asset(fields: Partial<GrowthAsset>): GrowthAsset {
  return {
    asset_id: fields.asset_id || 'asset',
    audience: 'reviewers',
    campaign: 'packet-test',
    channel: 'meta',
    content_type: 'image',
    cta: 'Review it',
    hook: 'Choose a variation',
    product: defaultProject,
    project: defaultProject,
    source: 'catalog',
    status: 'working',
    title: fields.title || 'Packet test asset',
    utm_content: 'packet_test_asset',
    ...fields,
  };
}

function page(assets: GrowthAsset[], pageNumber: number, totalPages: number): AssetLibrarySnapshot {
  return {
    assets,
    catalog: {
      asset_count: assets.length,
      default_bucket: '',
      default_region: '',
      product: defaultProject,
      project: defaultProject,
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
    fetchedAt: new Date().toISOString(),
    liveObjects: [],
    orphanObjects: [],
    pagination: { page: pageNumber, pageSize: 100, total: 101, totalPages },
  };
}

describe('asset selection work packet', () => {
  beforeEach(resetDb);

  it('returns a typed packet for an active review set with catalog and missing assets', () => {
    createReviewSet(defaultProject, {
      assetIds: [catalogAsset, 'missing-packet-asset'],
      confirmWrite: true,
      key: 'packet-a',
      label: 'Packet A',
    });

    const packet = getAssetSelectionWorkPacket(defaultProject);

    expect(packet).toMatchObject({
      kind: 'asset_selection_work_packet',
      project: defaultProject,
      review_set: {
        id: `${defaultProject}:review:packet-a`,
        key: 'packet-a',
        label: 'Packet A',
        selected_count: 0,
        status: 'active',
        total_candidates: 2,
      },
      selected_assets: [],
      suggested_next_action: 'choose_variations',
    });
    expect(packet.candidates).toHaveLength(2);
    expect(packet.candidates[0]).toMatchObject({
      asset_id: catalogAsset,
      label: 'A',
      selected: false,
      source: 'catalog',
      storage_state: 's3_backed',
      title: 'Meta short-form demo post static',
    });
    expect(packet.candidates[0].s3_key).toContain(catalogAsset);
    expect(packet.candidates[1]).toMatchObject({
      asset_id: 'missing-packet-asset',
      label: 'B',
      selected: false,
      source: 'unknown',
      storage_state: 'unresolved',
      title: 'missing-packet-asset',
    });
    expect(packet.commands.chooseLabelsTemplate).toContain('selections review-set choose');
    expect(packet.commands.currentSelectionCommand).toContain('selections current');
    expect(packet.commands.inspectReviewSetCommand).toContain('selections review-set inspect');
    expect(packet.commands.plainEnglishContinue).toContain("agent 'keep working on my selections'");
    expect(packet.commands.setNextCommand).toContain('selections review-set set-next');
  });

  it('enriches a review-set asset found beyond the first asset page', () => {
    createReviewSet(defaultProject, {
      assetIds: ['page-two-asset'],
      confirmWrite: true,
      key: 'packet-pagination',
      label: 'Packet pagination',
    });
    mockedListAssets
      .mockImplementationOnce(() => page([], 1, 2))
      .mockImplementationOnce(() => page([
        asset({
          asset_id: 'page-two-asset',
          s3: {
            bucket: 'packet-bucket',
            key: 'products/packet/page-two-asset.png',
            region: 'us-east-1',
            version_id: '1',
          },
          title: 'Page two asset',
        }),
      ], 2, 2));

    const packet = getAssetSelectionWorkPacket(defaultProject);

    expect(mockedListAssets).toHaveBeenNthCalledWith(1, defaultProject, { page: 1, pageSize: 100, source: 'all' });
    expect(mockedListAssets).toHaveBeenNthCalledWith(2, defaultProject, { page: 2, pageSize: 100, source: 'all' });
    expect(packet.candidates[0]).toMatchObject({
      asset_id: 'page-two-asset',
      source: 'catalog',
      storage_state: 's3_backed',
      title: 'Page two asset',
    });
  });

  it('shell-quotes review-set ids in generated commands', () => {
    createReviewSet(defaultProject, {
      assetIds: [catalogAsset],
      confirmWrite: true,
      key: 'packet unsafe; key',
      label: 'Packet unsafe key',
    });

    const packet = getAssetSelectionWorkPacket(defaultProject);
    const quotedSetId = `'${defaultProject}:review:packet unsafe; key'`;

    expect(packet.commands.chooseLabelsTemplate).toContain(`--set-id ${quotedSetId}`);
    expect(packet.commands.inspectReviewSetCommand).toContain(`--set-id ${quotedSetId}`);
    expect(packet.commands.setNextCommand).toContain(`--set-id ${quotedSetId}`);
    expect(packet.commands.setNextCommand).toContain(`--project '${defaultProject}'`);
  });

  it('marks selected labels after choosing review set variations', () => {
    createReviewSet(defaultProject, {
      assetIds: ['asset-a', 'asset-b', 'asset-c'],
      confirmWrite: true,
      key: 'packet-labels',
      label: 'Packet labels',
    });

    chooseReviewSetLabels(defaultProject, {
      confirmWrite: true,
      labels: ['B', 'C'],
      selectedBy: 'human',
    });

    const packet = getAssetSelectionWorkPacket(defaultProject);

    expect(packet.selected_assets).toEqual(['asset-b', 'asset-c']);
    expect(packet.suggested_next_action).toBe('continue_selected_assets');
    expect(packet.review_set).toMatchObject({
      id: `${defaultProject}:review:packet-labels`,
      selected_count: 2,
      total_candidates: 3,
    });
    expect(packet.candidates.map(candidate => [candidate.label, candidate.asset_id, candidate.selected])).toEqual([
      ['A', 'asset-a', false],
      ['B', 'asset-b', true],
      ['C', 'asset-c', true],
    ]);
  });
});
