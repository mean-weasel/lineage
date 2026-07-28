export const OUTPUT_TARGET_REGISTRY_SCHEMA = 'lineage.output_target_registry.v1' as const;
export const GENERATION_TARGET_MAP_SCHEMA = 'lineage.generation_target_map.v1' as const;
export const NODE_NEXT_OUTPUT_TARGETS_SCHEMA = 'lineage.node_next_output_targets.v1' as const;

type OutputTargetMediaKind = 'static_image';
type OutputTargetLifecycle = 'active' | 'deprecated' | 'removed';

export interface GeometryProfileSnapshot {
  id: string;
  version: number;
  media_kind: OutputTargetMediaKind;
  width: number;
  height: number;
}

export interface DeliverySurfaceSnapshot {
  id: string;
  version: number;
  platform: string;
  surface: string;
  media_kind: OutputTargetMediaKind;
  geometry: GeometryProfileSnapshot;
  guidance: string[];
  source_url: string;
  source_verified_at: string;
  lifecycle: OutputTargetLifecycle;
  replacement?: { surface_id: string; surface_version: number };
}

export type GeometryProfileRecord = GeometryProfileSnapshot;

export interface DeliverySurfaceRecord {
  id: string;
  version: number;
  platform: string;
  surface: string;
  media_kind: OutputTargetMediaKind;
  geometry_profile_id: string;
  geometry_profile_version: number;
  aliases: string[];
  guidance: string[];
  source_url: string;
  source_verified_at: string;
  lifecycle: OutputTargetLifecycle;
  replacement?: { surface_id: string; surface_version: number };
}

export interface OutputTargetRegistry {
  schema_version: typeof OUTPUT_TARGET_REGISTRY_SCHEMA;
  geometries: readonly GeometryProfileRecord[];
  surfaces: readonly DeliverySurfaceRecord[];
}

export type GenerationTarget =
  | { kind: 'delivery_surface'; surface_id: string; surface_version: number; variant_count?: number }
  | { kind: 'custom'; width: number; height: number; variant_count?: number }
  | { kind: 'unlocked'; variant_count?: number };

export interface GenerationSourceTargets {
  asset_id: string;
  default_variant_count?: number;
  targets: GenerationTarget[];
  separate_surface_ids?: string[];
}

export interface GenerationTargetMap {
  schema_version: typeof GENERATION_TARGET_MAP_SCHEMA;
  sources: GenerationSourceTargets[];
}

export interface CanonicalGenerationTargetMap {
  map: GenerationTargetMap;
  canonical_json: string;
  digest_sha256: string;
}

type TargetGroupingMode = 'consolidated' | 'explicit_split';

export interface ResolvedTargetGroup {
  id: string;
  parent_asset_id: string;
  media_kind?: OutputTargetMediaKind;
  width?: number;
  height?: number;
  geometry?: GeometryProfileSnapshot;
  custom_geometry?: GeometryProfileSnapshot;
  delivery_surfaces: DeliverySurfaceSnapshot[];
  grouping_mode: TargetGroupingMode;
  variant_count: number;
  target_map_digest: string;
  guidance: string[];
  unlocked: boolean;
}

export interface GenerationOutputSlot {
  id: string;
  group_id: string;
  parent_asset_id: string;
  output_index: number;
  variant_index: number;
  output_spec?: {
    schema_version: 'lineage.output_spec.v1';
    media_kind: OutputTargetMediaKind;
    width: number;
    height: number;
    geometry?: GeometryProfileSnapshot;
    custom_geometry?: GeometryProfileSnapshot;
    delivery_surfaces: DeliverySurfaceSnapshot[];
    grouping_mode: TargetGroupingMode;
    target_group_id: string;
    variant_index: number;
  };
}

export interface ResolvedGenerationTargetPlan extends CanonicalGenerationTargetMap {
  groups: ResolvedTargetGroup[];
  slots: GenerationOutputSlot[];
  expected_output_count: number;
}

export type NodeNextOutputTarget =
  | { kind: 'delivery_surface'; surface_id: string; surface_version: number }
  | { kind: 'custom'; width: number; height: number };

export interface ResolvedNodeNextOutputTarget {
  media_kind: OutputTargetMediaKind;
  width: number;
  height: number;
  geometry?: GeometryProfileSnapshot;
  custom_geometry?: GeometryProfileSnapshot;
  delivery_surfaces: DeliverySurfaceSnapshot[];
}

type NodeNextOutputTargetOrigin = 'node_override' | 'derived_child' | 'canvas_default' | 'unresolved';

export interface NodeNextOutputTargetSetting {
  schema_version: typeof NODE_NEXT_OUTPUT_TARGETS_SCHEMA;
  project_id: string;
  root_asset_id: string;
  node_asset_id: string;
  revision: number;
  targets: NodeNextOutputTarget[];
  resolved_targets: ResolvedNodeNextOutputTarget[];
  provenance: {
    actor: 'human' | 'agent' | 'system';
    origin: 'canvas' | 'cli' | 'derived_child';
  };
  digest_sha256: string;
  created_at: string;
  updated_at: string;
}

export interface EffectiveNodeNextOutputTargets {
  schema_version: typeof NODE_NEXT_OUTPUT_TARGETS_SCHEMA;
  project_id: string;
  root_asset_id: string;
  node_asset_id: string;
  origin: NodeNextOutputTargetOrigin;
  targets: NodeNextOutputTarget[];
  resolved_targets: ResolvedNodeNextOutputTarget[];
  setting_revision?: number;
  setting_digest_sha256?: string;
  canvas_default_digest_sha256?: string;
  resolution_digest_sha256: string;
}

export interface GenerationJobSourceTargetResolution {
  parent_asset_id: string;
  origin: Exclude<NodeNextOutputTargetOrigin, 'unresolved'>;
  setting_revision?: number;
  setting_digest_sha256?: string;
  canvas_default_digest_sha256?: string;
  resolution_digest_sha256: string;
  targets: NodeNextOutputTarget[];
  resolved_targets: ResolvedNodeNextOutputTarget[];
}

export interface OutputTargetChoice {
  surface_id: string;
  surface_version: number;
  platform: string;
  surface: string;
  width: number;
  height: number;
}

export class OutputTargetResolutionError extends Error {
  constructor(
    public readonly code:
      | 'ambiguous_platform'
      | 'unknown_platform'
      | 'unknown_surface'
      | 'invalid_custom_geometry'
      | 'invalid_target_map'
      | 'variant_count_conflict',
    message: string,
    public readonly choices: OutputTargetChoice[] = [],
  ) {
    super(message);
    this.name = 'OutputTargetResolutionError';
  }
}
