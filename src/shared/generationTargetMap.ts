import { createHash } from 'node:crypto';
import { customGeometrySnapshot, outputTargetRegistry, surfaceSnapshot } from './outputTargetRegistry';
import {
  GENERATION_TARGET_MAP_SCHEMA,
  OutputTargetResolutionError,
  type CanonicalGenerationTargetMap,
  type DeliverySurfaceSnapshot,
  type GenerationOutputSlot,
  type GenerationSourceTargets,
  type GenerationTarget,
  type GenerationTargetMap,
  type ResolvedGenerationTargetPlan,
  type ResolvedTargetGroup,
} from './outputTargetTypes';

export interface OutputTargetShorthand {
  destinations?: string[];
  customDimensions?: string[];
  separateDestinations?: string[];
  variantsPerTarget?: number;
}

function normalizedQuery(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, ' ');
}

function shorthandSurface(value: string) {
  const query = normalizedQuery(value);
  const records = outputTargetRegistry.surfaces.filter(surface => surface.lifecycle !== 'removed');
  const platformMatches = records.filter(surface => normalizedQuery(surface.platform) === query);
  if (platformMatches.length > 0) {
    throw new OutputTargetResolutionError(
      'ambiguous_platform',
      `${value} requires an explicit delivery surface`,
      platformMatches.map(surface => {
        const snapshot = surfaceSnapshot(surface.id, surface.version);
        return {
          surface_id: snapshot.id,
          surface_version: snapshot.version,
          platform: snapshot.platform,
          surface: snapshot.surface,
          width: snapshot.geometry.width,
          height: snapshot.geometry.height,
        };
      }),
    );
  }
  const match = records.find(surface => [
    surface.id,
    `${surface.platform} ${surface.surface}`,
    ...surface.aliases,
  ].some(alias => normalizedQuery(alias) === query));
  if (!match) throw new OutputTargetResolutionError('unknown_surface', `Unknown delivery surface: ${value}`);
  return surfaceSnapshot(match.id, match.version);
}

function shorthandDimensions(value: string): { width: number; height: number } {
  const match = /^(\d+)x(\d+)$/i.exec(value.trim());
  if (!match) throw new OutputTargetResolutionError('invalid_custom_geometry', `Invalid custom dimensions "${value}"; expected WIDTHxHEIGHT`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

export function generationTargetMapFromShorthand(sourceAssetId: string, input: OutputTargetShorthand): GenerationTargetMap | undefined {
  const destinations = input.destinations ?? [];
  const customDimensions = input.customDimensions ?? [];
  const separateDestinations = input.separateDestinations ?? [];
  if (destinations.length === 0 && customDimensions.length === 0 && separateDestinations.length === 0 && input.variantsPerTarget === undefined) return undefined;
  if (destinations.length === 0 && customDimensions.length === 0) {
    throw new OutputTargetResolutionError('invalid_target_map', 'Target-aware planning requires at least one --destination or --custom-dimensions');
  }
  if (input.variantsPerTarget !== undefined && (!Number.isInteger(input.variantsPerTarget) || input.variantsPerTarget <= 0)) {
    throw new OutputTargetResolutionError('invalid_target_map', '--variants-per-target must be a positive integer');
  }
  const surfaces = destinations.map(shorthandSurface);
  const splitSurfaces = separateDestinations.map(shorthandSurface);
  const selectedSurfaceIds = new Set(surfaces.map(surface => surface.id));
  for (const split of splitSurfaces) {
    if (!selectedSurfaceIds.has(split.id)) throw new OutputTargetResolutionError('invalid_target_map', `Cannot split unselected destination ${split.id}`);
  }
  return {
    schema_version: GENERATION_TARGET_MAP_SCHEMA,
    sources: [{
      asset_id: sourceAssetId,
      default_variant_count: input.variantsPerTarget ?? 1,
      targets: [
        ...surfaces.map(surface => ({ kind: 'delivery_surface' as const, surface_id: surface.id, surface_version: surface.version })),
        ...customDimensions.map(value => ({ kind: 'custom' as const, ...shorthandDimensions(value) })),
      ],
      separate_surface_ids: splitSurfaces.map(surface => surface.id),
    }],
  };
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new OutputTargetResolutionError('invalid_target_map', `${label} must be a positive integer`);
  }
  return Number(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalTarget(target: GenerationTarget): GenerationTarget {
  const variantCount = target.variant_count === undefined ? undefined : positiveInteger(target.variant_count, 'variant_count');
  if (target.kind === 'delivery_surface') {
    surfaceSnapshot(target.surface_id, positiveInteger(target.surface_version, 'surface_version'));
    return {
      kind: 'delivery_surface',
      surface_id: target.surface_id,
      surface_version: target.surface_version,
      ...(variantCount ? { variant_count: variantCount } : {}),
    };
  }
  if (target.kind === 'custom') {
    customGeometrySnapshot(target.width, target.height);
    return { kind: 'custom', width: target.width, height: target.height, ...(variantCount ? { variant_count: variantCount } : {}) };
  }
  if (target.kind === 'unlocked') return { kind: 'unlocked', ...(variantCount ? { variant_count: variantCount } : {}) };
  throw new OutputTargetResolutionError('invalid_target_map', 'Unknown output target kind');
}

function targetKey(target: GenerationTarget): string {
  if (target.kind === 'delivery_surface') return `surface:${target.surface_id}@${target.surface_version}`;
  if (target.kind === 'custom') return `custom:${target.width}x${target.height}`;
  return 'unlocked';
}

function canonicalSource(source: GenerationSourceTargets): GenerationSourceTargets {
  if (!source.asset_id?.trim()) throw new OutputTargetResolutionError('invalid_target_map', 'Every target-map source requires asset_id');
  if (!Array.isArray(source.targets) || source.targets.length === 0) {
    throw new OutputTargetResolutionError('invalid_target_map', `Source ${source.asset_id} requires at least one target`);
  }
  const defaultCount = source.default_variant_count === undefined ? 1 : positiveInteger(source.default_variant_count, 'default_variant_count');
  const targets = source.targets.map(canonicalTarget);
  const hasUnlocked = targets.some(target => target.kind === 'unlocked');
  if (hasUnlocked && (targets.length !== 1 || targets[0].kind !== 'unlocked')) {
    throw new OutputTargetResolutionError('invalid_target_map', `Source ${source.asset_id} cannot mix unlocked and locked targets`);
  }
  const byKey = new Map<string, GenerationTarget>();
  for (const target of targets) {
    const key = targetKey(target);
    const existing = byKey.get(key);
    if (existing && (existing.variant_count ?? defaultCount) !== (target.variant_count ?? defaultCount)) {
      throw new OutputTargetResolutionError('variant_count_conflict', `Duplicate target ${key} has conflicting variant counts`);
    }
    if (!existing) byKey.set(key, target);
  }
  const surfaceIds = new Set([...byKey.values()].filter(target => target.kind === 'delivery_surface').map(target => target.surface_id));
  const separateSurfaceIds = [...new Set(source.separate_surface_ids || [])].sort();
  for (const id of separateSurfaceIds) {
    if (!surfaceIds.has(id)) throw new OutputTargetResolutionError('invalid_target_map', `Split surface ${id} is not selected for source ${source.asset_id}`);
  }
  return {
    asset_id: source.asset_id,
    default_variant_count: defaultCount,
    targets: [...byKey.values()].sort((a, b) => targetKey(a).localeCompare(targetKey(b))),
    separate_surface_ids: separateSurfaceIds,
  };
}

export function canonicalizeGenerationTargetMap(
  input: GenerationTargetMap,
  expectedSourceAssetIds?: readonly string[],
): CanonicalGenerationTargetMap {
  if (input?.schema_version !== GENERATION_TARGET_MAP_SCHEMA || !Array.isArray(input.sources) || input.sources.length === 0) {
    throw new OutputTargetResolutionError('invalid_target_map', `Expected ${GENERATION_TARGET_MAP_SCHEMA} with at least one source`);
  }
  const sources = input.sources.map(canonicalSource);
  const sourceIds = sources.map(source => source.asset_id);
  if (new Set(sourceIds).size !== sourceIds.length) throw new OutputTargetResolutionError('invalid_target_map', 'Each source asset must appear exactly once');
  if (expectedSourceAssetIds) {
    const expected = [...new Set(expectedSourceAssetIds)].sort();
    const received = [...sourceIds].sort();
    if (stableJson(expected) !== stableJson(received)) {
      throw new OutputTargetResolutionError(
        'invalid_target_map',
        `Target-aware requests require an explicit mapping for every selected source (expected ${expected.join(', ')})`,
      );
    }
  }
  const map: GenerationTargetMap = {
    schema_version: GENERATION_TARGET_MAP_SCHEMA,
    sources: sources.sort((a, b) => a.asset_id.localeCompare(b.asset_id)),
  };
  const canonicalJson = stableJson(map);
  return {
    map,
    canonical_json: canonicalJson,
    digest_sha256: createHash('sha256').update(canonicalJson).digest('hex'),
  };
}

interface PendingGroup {
  parentAssetId: string;
  width?: number;
  height?: number;
  geometry?: ReturnType<typeof surfaceSnapshot>['geometry'];
  customGeometry?: ReturnType<typeof customGeometrySnapshot>;
  surfaces: DeliverySurfaceSnapshot[];
  groupingMode: ResolvedTargetGroup['grouping_mode'];
  variantCount: number;
  unlocked: boolean;
}

function targetCount(target: GenerationTarget, source: GenerationSourceTargets): number {
  return target.variant_count ?? source.default_variant_count ?? 1;
}

function groupsForSource(source: GenerationSourceTargets): PendingGroup[] {
  const unlocked = source.targets[0];
  if (unlocked.kind === 'unlocked') {
    return [{
      parentAssetId: source.asset_id, surfaces: [], groupingMode: 'consolidated',
      variantCount: targetCount(unlocked, source), unlocked: true,
    }];
  }
  const groups = new Map<string, PendingGroup>();
  const splitIds = new Set(source.separate_surface_ids);
  for (const target of source.targets) {
    const count = targetCount(target, source);
    if (target.kind === 'unlocked') continue;
    if (target.kind === 'custom') {
      const geometry = customGeometrySnapshot(target.width, target.height);
      const key = `geometry:${geometry.width}x${geometry.height}`;
      const existing = groups.get(key);
      if (existing && existing.variantCount !== count) {
        throw new OutputTargetResolutionError(
          'variant_count_conflict',
          `Same-sized targets for ${source.asset_id} must use the same variant count or be explicitly split`,
        );
      }
      if (!existing) groups.set(key, {
        parentAssetId: source.asset_id, width: geometry.width, height: geometry.height,
        customGeometry: geometry, surfaces: [], groupingMode: 'consolidated', variantCount: count, unlocked: false,
      });
      continue;
    }
    const surface = surfaceSnapshot(target.surface_id, target.surface_version);
    const isSplit = splitIds.has(target.surface_id);
    const key = isSplit ? `split:${target.surface_id}@${target.surface_version}` : `geometry:${surface.geometry.width}x${surface.geometry.height}`;
    const existing = groups.get(key);
    if (existing && existing.variantCount !== count) {
      throw new OutputTargetResolutionError(
        'variant_count_conflict',
        `Same-sized targets for ${source.asset_id} must use the same variant count or be explicitly split`,
      );
    }
    if (existing) existing.surfaces.push(surface);
    else groups.set(key, {
      parentAssetId: source.asset_id,
      width: surface.geometry.width,
      height: surface.geometry.height,
      geometry: surface.geometry,
      surfaces: [surface],
      groupingMode: isSplit ? 'explicit_split' : 'consolidated',
      variantCount: count,
      unlocked: false,
    });
  }
  return [...groups.values()];
}

export function resolveGenerationTargetPlan(
  jobId: string,
  input: GenerationTargetMap,
  expectedSourceAssetIds?: readonly string[],
): ResolvedGenerationTargetPlan {
  if (!jobId) throw new OutputTargetResolutionError('invalid_target_map', 'Target planning requires a job id');
  const canonical = canonicalizeGenerationTargetMap(input, expectedSourceAssetIds);
  const pending = canonical.map.sources.flatMap(groupsForSource);
  const groups: ResolvedTargetGroup[] = [];
  const slots: GenerationOutputSlot[] = [];
  let outputIndex = 0;
  for (const [groupIndex, group] of pending.entries()) {
    const id = `${jobId}:target-group:${groupIndex}`;
    const resolved: ResolvedTargetGroup = {
      id,
      parent_asset_id: group.parentAssetId,
      ...(group.unlocked ? {} : { media_kind: 'static_image' as const, width: group.width, height: group.height }),
      ...(group.geometry ? { geometry: structuredClone(group.geometry) } : {}),
      ...(group.customGeometry ? { custom_geometry: structuredClone(group.customGeometry) } : {}),
      delivery_surfaces: group.surfaces.map(surface => structuredClone(surface)),
      grouping_mode: group.groupingMode,
      variant_count: group.variantCount,
      target_map_digest: canonical.digest_sha256,
      guidance: [...new Set(group.surfaces.flatMap(surface => surface.guidance))],
      unlocked: group.unlocked,
    };
    groups.push(resolved);
    for (let variantIndex = 0; variantIndex < group.variantCount; variantIndex += 1) {
      const slot: GenerationOutputSlot = {
        id: `${id}:slot:${variantIndex}`,
        group_id: id,
        parent_asset_id: group.parentAssetId,
        output_index: outputIndex,
        variant_index: variantIndex,
        ...(!group.unlocked && group.width && group.height ? {
          output_spec: {
            schema_version: 'lineage.output_spec.v1' as const,
            media_kind: 'static_image' as const,
            width: group.width,
            height: group.height,
            ...(group.geometry ? { geometry: structuredClone(group.geometry) } : {}),
            ...(group.customGeometry ? { custom_geometry: structuredClone(group.customGeometry) } : {}),
            delivery_surfaces: group.surfaces.map(surface => structuredClone(surface)),
            grouping_mode: group.groupingMode,
            target_group_id: id,
            variant_index: variantIndex,
          },
        } : {}),
      };
      slots.push(slot);
      outputIndex += 1;
    }
  }
  return { ...canonical, groups, slots, expected_output_count: slots.length };
}
