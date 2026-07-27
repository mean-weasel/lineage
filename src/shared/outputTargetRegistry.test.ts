import { describe, expect, it } from 'vitest';
import {
  customGeometrySnapshot,
  outputTargetRegistry,
  resolveDeliverySurface,
  surfaceSnapshot,
} from './outputTargetRegistry';
import { OutputTargetResolutionError } from './outputTargetTypes';

describe('output target registry', () => {
  it('pins the approved multi-platform catalog and geometry snapshots', () => {
    expect(outputTargetRegistry.schema_version).toBe('lineage.output_target_registry.v1');
    expect(outputTargetRegistry.surfaces.map(surface => surface.id)).toEqual([
      'instagram.feed_square',
      'instagram.feed_portrait',
      'instagram.story',
      'facebook.story',
      'linkedin.single_image_landscape',
      'linkedin.single_image_square',
      'linkedin.single_image_portrait',
      'pinterest.standard_pin',
      'x.standalone_square',
      'x.standalone_landscape',
      'x.standalone_portrait',
      'x.standalone_vertical',
      'tiktok.carousel_vertical',
      'google_business.profile_photo_square',
    ]);
    expect(surfaceSnapshot('instagram.feed_portrait', 1).geometry).toMatchObject({ width: 1080, height: 1440 });
    expect(surfaceSnapshot('instagram.story', 1).geometry).toEqual(surfaceSnapshot('facebook.story', 1).geometry);
    expect(outputTargetRegistry.surfaces.every(surface => surface.source_verified_at === '2026-07-27')).toBe(true);
    expect(Object.isFrozen(outputTargetRegistry.surfaces)).toBe(true);
  });

  it('returns structured choices instead of guessing a platform surface', () => {
    try {
      resolveDeliverySurface({ platform: 'Instagram' });
      throw new Error('expected ambiguity');
    } catch (error) {
      expect(error).toBeInstanceOf(OutputTargetResolutionError);
      expect(error).toMatchObject({ code: 'ambiguous_platform' });
      expect((error as OutputTargetResolutionError).choices).toHaveLength(3);
    }
    expect(resolveDeliverySurface({ platform: 'Pinterest' }).id).toBe('pinterest.standard_pin');
  });

  it('enforces custom side and decoded-area bounds', () => {
    expect(customGeometrySnapshot(16, 16).id).toBe('custom.static_image.16x16');
    expect(customGeometrySnapshot(10_000, 10_000)).toMatchObject({ width: 10_000, height: 10_000 });
    for (const [width, height] of [[15, 100], [100, 16_385], [10_001, 10_000], [100.5, 100]]) {
      expect(() => customGeometrySnapshot(width, height)).toThrow(OutputTargetResolutionError);
    }
  });
});
