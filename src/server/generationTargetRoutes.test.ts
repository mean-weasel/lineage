import { describe, expect, it } from 'vitest';
import { canvasDefaultsMutationFromBody } from './generationTargetRoutes';

describe('generation target canvas routes', () => {
  it('stamps explicit human canvas provenance and ignores caller actor claims', () => {
    expect(canvasDefaultsMutationFromBody({
      actor: 'agent',
      origin: 'cli',
      confirmWrite: true,
      default_variant_count: 2,
      targets: [{ kind: 'delivery_surface', surface_id: 'instagram.story', surface_version: 1 }],
      separate_surface_ids: ['instagram.story'],
    })).toEqual({
      actor: 'human',
      origin: 'canvas',
      default_variant_count: 2,
      targets: [{ kind: 'delivery_surface', surface_id: 'instagram.story', surface_version: 1 }],
      separate_surface_ids: ['instagram.story'],
    });
  });

  it('rejects defaults mutation without an explicit human confirmation', () => {
    expect(() => canvasDefaultsMutationFromBody({
      targets: [{ kind: 'unlocked' }],
    })).toThrow(/explicit human action/i);
  });
});
