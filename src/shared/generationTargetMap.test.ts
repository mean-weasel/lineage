import { describe, expect, it } from 'vitest';
import { canonicalizeGenerationTargetMap, resolveGenerationTargetPlan } from './generationTargetMap';
import { GENERATION_TARGET_MAP_SCHEMA, OutputTargetResolutionError, type GenerationTargetMap } from './outputTargetTypes';

function map(targets: GenerationTargetMap['sources'][number]['targets'], separate_surface_ids: string[] = []): GenerationTargetMap {
  return {
    schema_version: GENERATION_TARGET_MAP_SCHEMA,
    sources: [{ asset_id: 'asset-a', targets, separate_surface_ids }],
  };
}

describe('generation target maps', () => {
  it('canonicalizes deterministically and consolidates identical geometry', () => {
    const input = map([
      { kind: 'delivery_surface', surface_id: 'facebook.story', surface_version: 1 },
      { kind: 'delivery_surface', surface_id: 'instagram.story', surface_version: 1 },
    ]);
    const first = resolveGenerationTargetPlan('job-a', input, ['asset-a']);
    const second = canonicalizeGenerationTargetMap({
      ...input,
      sources: [{ ...input.sources[0], targets: [...input.sources[0].targets].reverse() }],
    });
    expect(first.digest_sha256).toBe(second.digest_sha256);
    expect(first.groups).toHaveLength(1);
    expect(first.groups[0]).toMatchObject({ width: 1080, height: 1920, grouping_mode: 'consolidated', variant_count: 1 });
    expect(first.groups[0].delivery_surfaces).toHaveLength(2);
    expect(first.slots).toHaveLength(1);
  });

  it('preserves explicit splits and per-group counts', () => {
    const plan = resolveGenerationTargetPlan('job-a', map([
      { kind: 'delivery_surface', surface_id: 'facebook.story', surface_version: 1, variant_count: 2 },
      { kind: 'delivery_surface', surface_id: 'instagram.story', surface_version: 1 },
    ], ['facebook.story']), ['asset-a']);
    expect(plan.groups).toHaveLength(2);
    expect(plan.groups.map(group => group.grouping_mode)).toContain('explicit_split');
    expect(plan.expected_output_count).toBe(3);
    expect(plan.slots.map(slot => slot.output_index)).toEqual([0, 1, 2]);
  });

  it('rejects conflicting consolidated counts and mixed lock state', () => {
    expect(() => resolveGenerationTargetPlan('job-a', map([
      { kind: 'delivery_surface', surface_id: 'facebook.story', surface_version: 1, variant_count: 2 },
      { kind: 'delivery_surface', surface_id: 'instagram.story', surface_version: 1, variant_count: 1 },
    ]), ['asset-a'])).toThrow(/same variant count/i);
    expect(() => canonicalizeGenerationTargetMap(map([
      { kind: 'unlocked' },
      { kind: 'custom', width: 100, height: 100 },
    ]))).toThrow(OutputTargetResolutionError);
  });

  it('requires explicit exact per-source mapping and keeps unlocked slots unlocked', () => {
    expect(() => canonicalizeGenerationTargetMap(map([{ kind: 'unlocked' }]), ['asset-a', 'asset-b'])).toThrow(/every selected source/i);
    const plan = resolveGenerationTargetPlan('job-a', map([{ kind: 'unlocked', variant_count: 2 }]), ['asset-a']);
    expect(plan.groups[0]).toMatchObject({ unlocked: true });
    expect(plan.groups[0]).not.toHaveProperty('width');
    expect(plan.groups[0]).not.toHaveProperty('height');
    expect(plan.slots).toHaveLength(2);
    expect(plan.slots.every(slot => slot.output_spec === undefined)).toBe(true);
  });

  it('rejects unknown root, source, and per-kind target fields before canonicalization', () => {
    expect(() => canonicalizeGenerationTargetMap({
      ...map([{ kind: 'unlocked' }]),
      future_root: true,
    } as GenerationTargetMap)).toThrow(/Generation target map contains unknown field: future_root/);
    expect(() => canonicalizeGenerationTargetMap({
      ...map([{ kind: 'unlocked' }]),
      sources: [{ ...map([{ kind: 'unlocked' }]).sources[0], inferred: true }],
    } as unknown as GenerationTargetMap)).toThrow(/Target-map source contains unknown field: inferred/);
    expect(() => canonicalizeGenerationTargetMap(map([{
      kind: 'delivery_surface', surface_id: 'instagram.story', surface_version: 1, platform: 'Instagram',
    } as GenerationTargetMap['sources'][number]['targets'][number]]))).toThrow(/Delivery-surface target contains unknown field: platform/);
    expect(() => canonicalizeGenerationTargetMap(map([{
      kind: 'custom', width: 1080, height: 1920, safe_zone: true,
    } as GenerationTargetMap['sources'][number]['targets'][number]]))).toThrow(/Custom target contains unknown field: safe_zone/);
    expect(() => canonicalizeGenerationTargetMap(map([{
      kind: 'unlocked', width: 1080,
    } as GenerationTargetMap['sources'][number]['targets'][number]]))).toThrow(/Unlocked target contains unknown field: width/);
  });

  it('accepts every documented v1 field and deterministically groups equal custom and named geometry', () => {
    const plan = resolveGenerationTargetPlan('job-custom', {
      schema_version: GENERATION_TARGET_MAP_SCHEMA,
      sources: [{
        asset_id: 'asset-a',
        default_variant_count: 2,
        separate_surface_ids: [],
        targets: [
          { kind: 'custom', width: 1080, height: 1920 },
          { kind: 'delivery_surface', surface_id: 'instagram.story', surface_version: 1 },
        ],
      }],
    }, ['asset-a']);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]).toMatchObject({
      width: 1080,
      height: 1920,
      variant_count: 2,
      custom_geometry: { id: 'custom.static_image.1080x1920' },
      delivery_surfaces: [expect.objectContaining({ id: 'instagram.story' })],
    });
    expect(plan.expected_output_count).toBe(2);
  });
});
