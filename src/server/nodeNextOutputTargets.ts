import { createHash } from 'node:crypto';
import type { DatabaseSync } from './assetLineageDb';
import { readCanvasGenerationTargetDefaults } from './generationTargetDefaults';
import { canonicalizeGenerationTargetMap, resolveGenerationTargetPlan } from '../shared/generationTargetMap';
import {
  GENERATION_TARGET_MAP_SCHEMA,
  NODE_NEXT_OUTPUT_TARGETS_SCHEMA,
  OutputTargetResolutionError,
  type EffectiveNodeNextOutputTargets,
  type GenerationJobSourceTargetResolution,
  type GenerationOutputSlot,
  type GenerationTarget,
  type NodeNextOutputTarget,
  type NodeNextOutputTargetSetting,
  type ResolvedNodeNextOutputTarget,
  type ResolvedGenerationTargetPlan,
  type ResolvedTargetGroup,
} from '../shared/outputTargetTypes';
import type { GenerationAssetOutputSpec } from '../shared/generationTypes';

export class NodeNextOutputTargetError extends Error {
  constructor(
    public readonly code: 'revision_conflict' | 'unresolved_targets' | 'invalid_targets' | 'unknown_asset',
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'NodeNextOutputTargetError';
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function nodeTargetResolutionsDigest(
  resolutions: readonly Pick<GenerationJobSourceTargetResolution, 'parent_asset_id' | 'resolution_digest_sha256'>[],
): string {
  return digest([...resolutions]
    .map(resolution => ({
      parent_asset_id: resolution.parent_asset_id,
      resolution_digest_sha256: resolution.resolution_digest_sha256,
    }))
    .sort((a, b) => a.parent_asset_id.localeCompare(b.parent_asset_id)));
}

export function materializeNodeTargetPlan(
  jobId: string,
  resolutions: readonly GenerationJobSourceTargetResolution[],
  variantsPerTarget = 1,
): ResolvedGenerationTargetPlan {
  if (!jobId || !Number.isInteger(variantsPerTarget) || variantsPerTarget <= 0 || resolutions.length === 0) {
    throw new NodeNextOutputTargetError('invalid_targets', 'Locked node planning requires a job id, sources, and a positive variant count');
  }
  const canonical = canonicalizeGenerationTargetMap({
    schema_version: GENERATION_TARGET_MAP_SCHEMA,
    sources: resolutions.map(resolution => ({
      asset_id: resolution.parent_asset_id,
      default_variant_count: variantsPerTarget,
      targets: structuredClone(resolution.targets),
    })),
  }, resolutions.map(resolution => resolution.parent_asset_id));
  const byParent = new Map(resolutions.map(resolution => [resolution.parent_asset_id, resolution]));
  const groups: ResolvedTargetGroup[] = [];
  const slots: GenerationOutputSlot[] = [];
  let outputIndex = 0;
  for (const source of canonical.map.sources) {
    const resolution = byParent.get(source.asset_id);
    if (!resolution || resolution.resolved_targets.length === 0) {
      throw new NodeNextOutputTargetError('unresolved_targets', `Node ${source.asset_id} has no frozen exact-pixel resolution`);
    }
    for (const frozen of resolution.resolved_targets) {
      const groupId = `${jobId}:target-group:${groups.length}`;
      const group: ResolvedTargetGroup = {
        id: groupId,
        parent_asset_id: source.asset_id,
        media_kind: frozen.media_kind,
        width: frozen.width,
        height: frozen.height,
        ...(frozen.geometry ? { geometry: structuredClone(frozen.geometry) } : {}),
        ...(frozen.custom_geometry ? { custom_geometry: structuredClone(frozen.custom_geometry) } : {}),
        delivery_surfaces: structuredClone(frozen.delivery_surfaces),
        grouping_mode: 'consolidated',
        variant_count: variantsPerTarget,
        target_map_digest: canonical.digest_sha256,
        guidance: [...new Set(frozen.delivery_surfaces.flatMap(surface => surface.guidance))],
        unlocked: false,
      };
      groups.push(group);
      for (let variantIndex = 0; variantIndex < variantsPerTarget; variantIndex += 1) {
        slots.push({
          id: `${groupId}:slot:${variantIndex}`,
          group_id: groupId,
          parent_asset_id: source.asset_id,
          output_index: outputIndex,
          variant_index: variantIndex,
          output_spec: {
            schema_version: 'lineage.output_spec.v1',
            media_kind: frozen.media_kind,
            width: frozen.width,
            height: frozen.height,
            ...(frozen.geometry ? { geometry: structuredClone(frozen.geometry) } : {}),
            ...(frozen.custom_geometry ? { custom_geometry: structuredClone(frozen.custom_geometry) } : {}),
            delivery_surfaces: structuredClone(frozen.delivery_surfaces),
            grouping_mode: 'consolidated',
            target_group_id: groupId,
            variant_index: variantIndex,
          },
        });
        outputIndex += 1;
      }
    }
  }
  return {
    ...canonical,
    groups,
    slots,
    expected_output_count: slots.length,
  };
}

function assertScopedAssets(database: DatabaseSync, projectId: string, rootAssetId: string, nodeAssetId: string): void {
  const rows = database.prepare(
    'select id from assets where project_id = ? and id in (?, ?)',
  ).all(projectId, rootAssetId, nodeAssetId) as Array<{ id: string }>;
  const ids = new Set(rows.map(row => row.id));
  if (!ids.has(rootAssetId) || !ids.has(nodeAssetId)) {
    throw new NodeNextOutputTargetError('unknown_asset', 'Root and node assets must both exist in the project', 404);
  }
  const lineageNode = database.prepare(`
    with recursive descendants(asset_id) as (
      select ?
      union
      select edge.child_asset_id
      from asset_edges edge
      join descendants parent on parent.asset_id = edge.parent_asset_id
      where edge.project_id = ? and edge.relation_type = 'derived_from'
    )
    select asset_id from descendants where asset_id = ?
  `).get(rootAssetId, projectId, nodeAssetId);
  if (!lineageNode) {
    throw new NodeNextOutputTargetError('unknown_asset', `Node ${nodeAssetId} is not in lineage rooted at ${rootAssetId}`, 404);
  }
}

function assertProvenance(provenance: NodeNextOutputTargetSetting['provenance']): void {
  const valid = (
    (provenance.actor === 'human' && provenance.origin === 'canvas')
    || (provenance.actor === 'agent' && provenance.origin === 'cli')
    || (provenance.actor === 'system' && provenance.origin === 'derived_child')
  );
  if (!valid) {
    throw new NodeNextOutputTargetError(
      'invalid_targets',
      'Node target provenance must be human/canvas, agent/cli, or system/derived_child',
    );
  }
}

function canonicalTargets(input: readonly GenerationTarget[], options: { ignoreVariantCounts?: boolean } = {}): NodeNextOutputTarget[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new NodeNextOutputTargetError('invalid_targets', 'At least one locked static-image target is required');
  }
  for (const target of input) {
    if (target.kind === 'unlocked') {
      throw new NodeNextOutputTargetError('invalid_targets', 'Node next-output settings cannot be unlocked');
    }
    if (target.variant_count !== undefined && !options.ignoreVariantCounts) {
      throw new NodeNextOutputTargetError('invalid_targets', 'Variation counts are job-time options, not sticky node settings');
    }
  }
  const geometryOnly = input.map(target => {
    if (target.kind === 'custom') return { kind: 'custom' as const, width: target.width, height: target.height };
    if (target.kind === 'delivery_surface') {
      return {
        kind: 'delivery_surface' as const,
        surface_id: target.surface_id,
        surface_version: target.surface_version,
      };
    }
    return { kind: 'unlocked' as const };
  });
  try {
    const plan = resolveGenerationTargetPlan('__node_next_output_targets__', {
      schema_version: GENERATION_TARGET_MAP_SCHEMA,
      sources: [{ asset_id: '__node__', default_variant_count: 1, targets: geometryOnly }],
    }, ['__node__']);
    return plan.map.sources[0].targets.map(target => {
      if (target.kind === 'unlocked') {
        throw new NodeNextOutputTargetError('invalid_targets', 'Node next-output settings cannot be unlocked');
      }
      if (target.kind === 'custom') return { kind: 'custom', width: target.width, height: target.height };
      return { kind: 'delivery_surface', surface_id: target.surface_id, surface_version: target.surface_version };
    });
  } catch (error) {
    if (error instanceof NodeNextOutputTargetError) throw error;
    if (error instanceof OutputTargetResolutionError) {
      throw new NodeNextOutputTargetError('invalid_targets', error.message);
    }
    throw error;
  }
}

function resolveTargets(targets: NodeNextOutputTarget[]): ResolvedNodeNextOutputTarget[] {
  const plan = resolveGenerationTargetPlan('__node_next_output_targets__', {
    schema_version: GENERATION_TARGET_MAP_SCHEMA,
    sources: [{ asset_id: '__node__', default_variant_count: 1, targets }],
  }, ['__node__']);
  return plan.groups.map(group => {
    if (group.unlocked || !group.media_kind || !group.width || !group.height) {
      throw new NodeNextOutputTargetError('unresolved_targets', 'Node next-output targets must resolve to exact pixels');
    }
    return {
      media_kind: group.media_kind,
      width: group.width,
      height: group.height,
      ...(group.geometry ? { geometry: structuredClone(group.geometry) } : {}),
      ...(group.custom_geometry ? { custom_geometry: structuredClone(group.custom_geometry) } : {}),
      delivery_surfaces: structuredClone(group.delivery_surfaces),
    };
  });
}

function settingFrom(row: Record<string, unknown>): NodeNextOutputTargetSetting {
  return {
    schema_version: NODE_NEXT_OUTPUT_TARGETS_SCHEMA,
    project_id: String(row.project_id),
    root_asset_id: String(row.root_asset_id),
    node_asset_id: String(row.node_asset_id),
    revision: Number(row.revision),
    targets: JSON.parse(String(row.targets_json)),
    resolved_targets: JSON.parse(String(row.resolved_targets_json)),
    provenance: {
      actor: row.provenance_actor as NodeNextOutputTargetSetting['provenance']['actor'],
      origin: row.provenance_origin as NodeNextOutputTargetSetting['provenance']['origin'],
    },
    digest_sha256: String(row.digest_sha256),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function readNodeNextOutputTargetSetting(
  database: DatabaseSync,
  projectId: string,
  rootAssetId: string,
  nodeAssetId: string,
): NodeNextOutputTargetSetting | undefined {
  const row = database.prepare(`
    select * from node_next_output_target_settings
    where project_id = ? and root_asset_id = ? and node_asset_id = ?
  `).get(projectId, rootAssetId, nodeAssetId) as Record<string, unknown> | undefined;
  return row ? settingFrom(row) : undefined;
}

export function writeNodeNextOutputTargetSetting(
  database: DatabaseSync,
  fields: {
    projectId: string;
    rootAssetId: string;
    nodeAssetId: string;
    expectedRevision: number | null;
    targets: readonly GenerationTarget[];
    provenance: NodeNextOutputTargetSetting['provenance'];
    timestamp?: string;
  },
): NodeNextOutputTargetSetting {
  assertScopedAssets(database, fields.projectId, fields.rootAssetId, fields.nodeAssetId);
  assertProvenance(fields.provenance);
  const existing = readNodeNextOutputTargetSetting(database, fields.projectId, fields.rootAssetId, fields.nodeAssetId);
  const actualRevision = existing?.revision ?? null;
  if (fields.expectedRevision !== actualRevision) {
    throw new NodeNextOutputTargetError(
      'revision_conflict',
      `Node next-output target revision conflict: expected ${String(fields.expectedRevision)}, current ${String(actualRevision)}`,
      409,
    );
  }
  const targets = canonicalTargets(fields.targets);
  const resolvedTargets = resolveTargets(targets);
  const revision = (existing?.revision ?? 0) + 1;
  const timestamp = fields.timestamp ?? new Date().toISOString();
  const digestSha256 = digest({
    schema_version: NODE_NEXT_OUTPUT_TARGETS_SCHEMA,
    project_id: fields.projectId,
    root_asset_id: fields.rootAssetId,
    node_asset_id: fields.nodeAssetId,
    revision,
    targets,
    resolved_targets: resolvedTargets,
    provenance: fields.provenance,
  });
  const values = [
    fields.projectId,
    fields.rootAssetId,
    fields.nodeAssetId,
    NODE_NEXT_OUTPUT_TARGETS_SCHEMA,
    revision,
    JSON.stringify(targets),
    JSON.stringify(resolvedTargets),
    fields.provenance.actor,
    fields.provenance.origin,
    digestSha256,
    existing?.created_at ?? timestamp,
    timestamp,
  ] as const;
  if (!existing) {
    try {
      database.prepare(`
        insert into node_next_output_target_settings (
          project_id, root_asset_id, node_asset_id, schema_version, revision, targets_json,
          resolved_targets_json, provenance_actor, provenance_origin, digest_sha256, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(...values);
    } catch (error) {
      const raced = readNodeNextOutputTargetSetting(database, fields.projectId, fields.rootAssetId, fields.nodeAssetId);
      if (raced) {
        throw new NodeNextOutputTargetError(
          'revision_conflict',
          `Node next-output target revision conflict: expected null, current ${raced.revision}`,
          409,
        );
      }
      throw error;
    }
  } else {
    const result = database.prepare(`
      update node_next_output_target_settings
      set schema_version = ?, revision = ?, targets_json = ?, resolved_targets_json = ?,
        provenance_actor = ?, provenance_origin = ?, digest_sha256 = ?, updated_at = ?
      where project_id = ? and root_asset_id = ? and node_asset_id = ? and revision = ?
    `).run(
      NODE_NEXT_OUTPUT_TARGETS_SCHEMA,
      revision,
      JSON.stringify(targets),
      JSON.stringify(resolvedTargets),
      fields.provenance.actor,
      fields.provenance.origin,
      digestSha256,
      timestamp,
      fields.projectId,
      fields.rootAssetId,
      fields.nodeAssetId,
      fields.expectedRevision,
    );
    if (Number(result.changes) !== 1) {
      const raced = readNodeNextOutputTargetSetting(database, fields.projectId, fields.rootAssetId, fields.nodeAssetId);
      throw new NodeNextOutputTargetError(
        'revision_conflict',
        `Node next-output target revision conflict: expected ${fields.expectedRevision}, current ${String(raced?.revision ?? null)}`,
        409,
      );
    }
  }
  return readNodeNextOutputTargetSetting(database, fields.projectId, fields.rootAssetId, fields.nodeAssetId)!;
}

export function clearNodeNextOutputTargetSetting(
  database: DatabaseSync,
  fields: { projectId: string; rootAssetId: string; nodeAssetId: string; expectedRevision: number },
): boolean {
  const current = readNodeNextOutputTargetSetting(database, fields.projectId, fields.rootAssetId, fields.nodeAssetId);
  if (!current || current.revision !== fields.expectedRevision) {
    throw new NodeNextOutputTargetError(
      'revision_conflict',
      `Node next-output target revision conflict: expected ${fields.expectedRevision}, current ${String(current?.revision ?? null)}`,
      409,
    );
  }
  return Number(database.prepare(`
    delete from node_next_output_target_settings
    where project_id = ? and root_asset_id = ? and node_asset_id = ? and revision = ?
  `).run(fields.projectId, fields.rootAssetId, fields.nodeAssetId, fields.expectedRevision).changes) === 1;
}

export function resolveEffectiveNodeNextOutputTargets(
  database: DatabaseSync,
  projectId: string,
  rootAssetId: string,
  nodeAssetId: string,
): EffectiveNodeNextOutputTargets {
  assertScopedAssets(database, projectId, rootAssetId, nodeAssetId);
  const setting = readNodeNextOutputTargetSetting(database, projectId, rootAssetId, nodeAssetId);
  if (setting) {
    const origin = setting.provenance.origin === 'derived_child' ? 'derived_child' : 'node_override';
    const payload = {
      schema_version: NODE_NEXT_OUTPUT_TARGETS_SCHEMA,
      project_id: projectId,
      root_asset_id: rootAssetId,
      node_asset_id: nodeAssetId,
      origin,
      targets: structuredClone(setting.targets),
      resolved_targets: structuredClone(setting.resolved_targets),
      setting_revision: setting.revision,
      setting_digest_sha256: setting.digest_sha256,
    } satisfies Omit<EffectiveNodeNextOutputTargets, 'resolution_digest_sha256'>;
    return { ...payload, resolution_digest_sha256: digest(payload) };
  }
  const defaults = readCanvasGenerationTargetDefaults(database, projectId, rootAssetId);
  if (defaults) {
    try {
      const targets = canonicalTargets(defaults.targets, { ignoreVariantCounts: true });
      const resolvedTargets = resolveTargets(targets);
      const defaultDigest = digest({ targets, resolved_targets: resolvedTargets });
      const payload = {
        schema_version: NODE_NEXT_OUTPUT_TARGETS_SCHEMA,
        project_id: projectId,
        root_asset_id: rootAssetId,
        node_asset_id: nodeAssetId,
        origin: 'canvas_default' as const,
        targets,
        resolved_targets: resolvedTargets,
        canvas_default_digest_sha256: defaultDigest,
      };
      return { ...payload, resolution_digest_sha256: digest(payload) };
    } catch (error) {
      if (!(error instanceof NodeNextOutputTargetError)) throw error;
    }
  }
  const payload = {
    schema_version: NODE_NEXT_OUTPUT_TARGETS_SCHEMA,
    project_id: projectId,
    root_asset_id: rootAssetId,
    node_asset_id: nodeAssetId,
    origin: 'unresolved' as const,
    targets: [],
    resolved_targets: [],
  };
  return { ...payload, resolution_digest_sha256: digest(payload) };
}

export function initializeChildNextOutputTargetsInTransaction(
  database: DatabaseSync,
  fields: {
    projectId: string;
    rootAssetId: string;
    nodeAssetId: string;
    outputSpec: GenerationAssetOutputSpec['output_spec'];
    timestamp: string;
  },
): NodeNextOutputTargetSetting {
  const targets: NodeNextOutputTarget[] = fields.outputSpec.delivery_surfaces.length > 0
    ? fields.outputSpec.delivery_surfaces.map(surface => ({
        kind: 'delivery_surface',
        surface_id: surface.id,
        surface_version: surface.version,
      }))
    : [{ kind: 'custom', width: fields.outputSpec.width, height: fields.outputSpec.height }];
  const resolvedTargets: ResolvedNodeNextOutputTarget[] = [{
    media_kind: 'static_image',
    width: fields.outputSpec.width,
    height: fields.outputSpec.height,
    ...(fields.outputSpec.geometry ? { geometry: structuredClone(fields.outputSpec.geometry) } : {}),
    ...(fields.outputSpec.custom_geometry ? { custom_geometry: structuredClone(fields.outputSpec.custom_geometry) } : {}),
    delivery_surfaces: structuredClone(fields.outputSpec.delivery_surfaces),
  }];
  const provenance = { actor: 'system' as const, origin: 'derived_child' as const };
  const settingDigest = digest({
    schema_version: NODE_NEXT_OUTPUT_TARGETS_SCHEMA,
    project_id: fields.projectId,
    root_asset_id: fields.rootAssetId,
    node_asset_id: fields.nodeAssetId,
    revision: 1,
    targets,
    resolved_targets: resolvedTargets,
    provenance,
  });
  database.prepare(`
    insert into node_next_output_target_settings (
      project_id, root_asset_id, node_asset_id, schema_version, revision, targets_json,
      resolved_targets_json, provenance_actor, provenance_origin, digest_sha256, created_at, updated_at
    ) values (?, ?, ?, ?, 1, ?, ?, 'system', 'derived_child', ?, ?, ?)
    on conflict(project_id, root_asset_id, node_asset_id) do nothing
  `).run(
    fields.projectId,
    fields.rootAssetId,
    fields.nodeAssetId,
    NODE_NEXT_OUTPUT_TARGETS_SCHEMA,
    JSON.stringify(targets),
    JSON.stringify(resolvedTargets),
    settingDigest,
    fields.timestamp,
    fields.timestamp,
  );
  const stored = readNodeNextOutputTargetSetting(database, fields.projectId, fields.rootAssetId, fields.nodeAssetId);
  if (!stored || stored.digest_sha256 !== settingDigest) {
    throw new NodeNextOutputTargetError('revision_conflict', `Child ${fields.nodeAssetId} already has different next-output targets`, 409);
  }
  return stored;
}
