import { describe, expect, it } from 'vitest';
import { listOutputTargets, nodeTargetsFromCli, resolveOutputTargetQuery, targetMapFromShorthand } from './outputTargetCli';

describe('output target CLI contract', () => {
  it('lists a versioned offline registry with exact dimensions', () => {
    const result = listOutputTargets('image');
    expect(result.schema_version).toBe('lineage.output_target_registry.v1');
    expect(result.surfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'instagram.feed_portrait', geometry: expect.objectContaining({ width: 1080, height: 1440 }) }),
      expect.objectContaining({ id: 'linkedin.single_image_landscape', geometry: expect.objectContaining({ width: 1200, height: 628 }) }),
    ]));
  });

  it('never guesses a platform-only query and returns selectable follow-ups', () => {
    const result = resolveOutputTargetQuery('Instagram');
    expect(result).toMatchObject({
      schema_version: 'lineage.output_target_registry.v1',
      status: 'ambiguous',
    });
    if (result.status !== 'ambiguous') throw new Error('Expected ambiguity');
    expect(result.choices.map(item => item.follow_up_query)).toContain('Instagram Feed portrait');
    expect(resolveOutputTargetQuery('Instagram Feed portrait')).toMatchObject({
      status: 'resolved',
      target: { id: 'instagram.feed_portrait', geometry: { width: 1080, height: 1440 } },
    });
    expect(resolveOutputTargetQuery('missing network')).toMatchObject({
      status: 'not_found',
      list_command: 'lineage output-targets list --media image --json',
    });
  });

  it('builds one-source shorthand maps across platforms, custom sizes, splits, and counts', () => {
    expect(targetMapFromShorthand('asset-a', {
      destinations: ['instagram.story', 'facebook.story'],
      customDimensions: ['1200x1500'],
      separateDestinations: ['facebook.story'],
      variantsPerTarget: 2,
    })).toEqual({
      schema_version: 'lineage.generation_target_map.v1',
      sources: [{
        asset_id: 'asset-a',
        default_variant_count: 2,
        targets: [
          { kind: 'delivery_surface', surface_id: 'instagram.story', surface_version: 1 },
          { kind: 'delivery_surface', surface_id: 'facebook.story', surface_version: 1 },
          { kind: 'custom', width: 1200, height: 1500 },
        ],
        separate_surface_ids: ['facebook.story'],
      }],
    });
    expect(() => targetMapFromShorthand('asset-a', { destinations: ['Instagram'] })).toThrow('requires an explicit delivery surface');
    expect(() => targetMapFromShorthand('asset-a', { customDimensions: ['1200-by-1500'] })).toThrow('expected WIDTHxHEIGHT');
  });

  it('builds geometry-only sticky node targets and refuses platform guessing', () => {
    expect(nodeTargetsFromCli({
      destinations: ['instagram.story', 'facebook.story'],
      customDimensions: ['1200x628'],
    })).toEqual([
      { kind: 'delivery_surface', surface_id: 'instagram.story', surface_version: 1 },
      { kind: 'delivery_surface', surface_id: 'facebook.story', surface_version: 1 },
      { kind: 'custom', width: 1200, height: 628 },
    ]);
    expect(() => nodeTargetsFromCli({ destinations: ['Instagram'] })).toThrow(/explicit delivery surface/i);
    expect(() => nodeTargetsFromCli({})).toThrow(/requires --destination or --custom-dimensions/i);
  });
});
