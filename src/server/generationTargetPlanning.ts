import { resolveGenerationTargetPlan } from '../shared/generationTargetMap';
import {
  GENERATION_TARGET_MAP_SCHEMA,
  OutputTargetResolutionError,
  type GenerationTargetMap,
  type ResolvedGenerationTargetPlan,
} from '../shared/outputTargetTypes';
import type { CanvasGenerationTargetDefaults } from './generationTargetDefaults';

export interface GenerationTargetPlanningRequest {
  jobId: string;
  sourceAssetIds: string[];
  targetMap?: GenerationTargetMap;
  canvasDefaults?: CanvasGenerationTargetDefaults;
}

export function planGenerationTargets(request: GenerationTargetPlanningRequest): ResolvedGenerationTargetPlan | undefined {
  const sourceIds = [...new Set(request.sourceAssetIds)];
  if (sourceIds.length !== request.sourceAssetIds.length || sourceIds.length === 0) {
    throw new OutputTargetResolutionError('invalid_target_map', 'Generation planning requires unique selected source assets');
  }
  let map = request.targetMap;
  if (!map && request.canvasDefaults) {
    if (sourceIds.length !== 1) {
      throw new OutputTargetResolutionError(
        'invalid_target_map',
        'Target-aware multi-source requests require an explicit per-source target map',
      );
    }
    map = {
      schema_version: GENERATION_TARGET_MAP_SCHEMA,
      sources: [{
        asset_id: sourceIds[0],
        default_variant_count: request.canvasDefaults.default_variant_count,
        targets: structuredClone(request.canvasDefaults.targets),
        separate_surface_ids: [...request.canvasDefaults.separate_surface_ids],
      }],
    };
  }
  if (!map) return undefined;
  return resolveGenerationTargetPlan(request.jobId, map, sourceIds);
}
