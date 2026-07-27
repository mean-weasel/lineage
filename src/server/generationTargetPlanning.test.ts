import { describe, expect, it } from 'vitest';
import { planGenerationTargets } from './generationTargetPlanning';
import type { CanvasGenerationTargetDefaults } from './generationTargetDefaults';
import { GENERATION_TARGET_MAP_SCHEMA } from '../shared/outputTargetTypes';

const defaults: CanvasGenerationTargetDefaults = {
  project_id: 'project',
  root_asset_id: 'root',
  default_variant_count: 1,
  targets: [{ kind: 'delivery_surface', surface_id: 'instagram.feed_square', surface_version: 1 }],
  separate_surface_ids: [],
  provenance: 'human',
  created_at: '2026-07-27T00:00:00.000Z',
  updated_at: '2026-07-27T00:00:00.000Z',
};

describe('generation target planning', () => {
  it('preserves legacy unlocked planning when no target intent exists', () => {
    expect(planGenerationTargets({ jobId: 'job', sourceAssetIds: ['asset'] })).toBeUndefined();
  });

  it('snapshots human defaults for one source instead of live-linking them', () => {
    const plan = planGenerationTargets({ jobId: 'job', sourceAssetIds: ['asset'], canvasDefaults: defaults });
    expect(plan?.map.sources[0].targets[0]).toMatchObject({ surface_id: 'instagram.feed_square' });
    defaults.targets[0] = { kind: 'custom', width: 500, height: 500 };
    expect(plan?.map.sources[0].targets[0]).toMatchObject({ surface_id: 'instagram.feed_square' });
  });

  it('requires per-source target intent for multiple sources', () => {
    expect(() => planGenerationTargets({ jobId: 'job', sourceAssetIds: ['a', 'b'], canvasDefaults: defaults })).toThrow(/explicit per-source/i);
    const plan = planGenerationTargets({
      jobId: 'job',
      sourceAssetIds: ['a', 'b'],
      targetMap: {
        schema_version: GENERATION_TARGET_MAP_SCHEMA,
        sources: [
          { asset_id: 'a', targets: [{ kind: 'custom', width: 100, height: 200 }] },
          { asset_id: 'b', targets: [{ kind: 'unlocked' }] },
        ],
      },
    });
    expect(plan?.groups.map(group => [group.parent_asset_id, group.unlocked])).toEqual([['a', false], ['b', true]]);
  });
});
