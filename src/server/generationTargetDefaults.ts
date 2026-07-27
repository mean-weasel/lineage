import type { DatabaseSync } from './assetLineageDb';
import type { GenerationTarget } from '../shared/outputTargetTypes';
import { canonicalizeGenerationTargetMap } from '../shared/generationTargetMap';
import { GENERATION_TARGET_MAP_SCHEMA, OutputTargetResolutionError } from '../shared/outputTargetTypes';

export interface CanvasGenerationTargetDefaults {
  project_id: string;
  root_asset_id: string;
  default_variant_count: number;
  targets: GenerationTarget[];
  separate_surface_ids: string[];
  provenance: 'human';
  created_at: string;
  updated_at: string;
}

export interface CanvasDefaultsMutation {
  actor: 'human';
  origin: 'canvas';
  default_variant_count?: number;
  targets: GenerationTarget[];
  separate_surface_ids?: string[];
}

function parseDefaults(row: Record<string, unknown>): CanvasGenerationTargetDefaults {
  return {
    project_id: String(row.project_id),
    root_asset_id: String(row.root_asset_id),
    default_variant_count: Number(row.default_variant_count),
    targets: JSON.parse(String(row.targets_json)) as GenerationTarget[],
    separate_surface_ids: JSON.parse(String(row.separate_surface_ids_json)) as string[],
    provenance: 'human',
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function readCanvasGenerationTargetDefaults(
  database: DatabaseSync,
  projectId: string,
  rootAssetId: string,
): CanvasGenerationTargetDefaults | undefined {
  const row = database.prepare(`
    select * from generation_target_defaults where project_id = ? and root_asset_id = ?
  `).get(projectId, rootAssetId) as Record<string, unknown> | undefined;
  return row ? parseDefaults(row) : undefined;
}

export function writeCanvasGenerationTargetDefaults(
  database: DatabaseSync,
  projectId: string,
  rootAssetId: string,
  mutation: CanvasDefaultsMutation,
  timestamp = new Date().toISOString(),
): CanvasGenerationTargetDefaults {
  if (
    (mutation as { actor?: string }).actor !== 'human'
    || (mutation as { origin?: string }).origin !== 'canvas'
  ) {
    throw new OutputTargetResolutionError('invalid_target_map', 'Canvas defaults may only be changed by an explicit human canvas operation');
  }
  const canonical = canonicalizeGenerationTargetMap({
    schema_version: GENERATION_TARGET_MAP_SCHEMA,
    sources: [{
      asset_id: '__canvas_default__',
      default_variant_count: mutation.default_variant_count,
      targets: mutation.targets,
      separate_surface_ids: mutation.separate_surface_ids,
    }],
  });
  const source = canonical.map.sources[0];
  database.prepare(`
    insert into generation_target_defaults (
      project_id, root_asset_id, default_variant_count, targets_json,
      separate_surface_ids_json, provenance, created_at, updated_at
    ) values (?, ?, ?, ?, ?, 'human', ?, ?)
    on conflict(project_id, root_asset_id) do update set
      default_variant_count = excluded.default_variant_count,
      targets_json = excluded.targets_json,
      separate_surface_ids_json = excluded.separate_surface_ids_json,
      provenance = 'human',
      updated_at = excluded.updated_at
  `).run(
    projectId,
    rootAssetId,
    source.default_variant_count ?? 1,
    JSON.stringify(source.targets),
    JSON.stringify(source.separate_surface_ids || []),
    timestamp,
    timestamp,
  );
  const stored = readCanvasGenerationTargetDefaults(database, projectId, rootAssetId);
  if (!stored) throw new Error('Canvas generation target defaults were not stored');
  return stored;
}
