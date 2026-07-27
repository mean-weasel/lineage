import type { DatabaseSync } from '../server/assetLineageDb';
import { readCanvasGenerationTargetDefaults } from '../server/generationTargetDefaults';
import { outputTargetRegistry, surfaceSnapshot } from '../shared/outputTargetRegistry';
import {
  OutputTargetResolutionError,
  type DeliverySurfaceSnapshot,
  type GenerationTarget,
  type OutputTargetChoice,
} from '../shared/outputTargetTypes';
import {
  generationTargetMapFromShorthand,
  type OutputTargetShorthand,
} from '../shared/generationTargetMap';
import {
  clearNodeNextOutputTargetSetting,
  readNodeNextOutputTargetSetting,
  resolveEffectiveNodeNextOutputTargets,
  writeNodeNextOutputTargetSetting,
} from '../server/nodeNextOutputTargets';

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, ' ');
}

function choice(surface: DeliverySurfaceSnapshot): OutputTargetChoice & { follow_up_query: string } {
  return {
    surface_id: surface.id,
    surface_version: surface.version,
    platform: surface.platform,
    surface: surface.surface,
    width: surface.geometry.width,
    height: surface.geometry.height,
    follow_up_query: `${surface.platform} ${surface.surface}`,
  };
}

export function listOutputTargets(media: string | undefined = 'image') {
  if (media !== 'image' && media !== 'static_image') {
    throw new OutputTargetResolutionError('invalid_target_map', 'output-targets list --media must be image');
  }
  return {
    schema_version: outputTargetRegistry.schema_version,
    media_kind: 'static_image' as const,
    geometries: outputTargetRegistry.geometries.map(geometry => structuredClone(geometry)),
    surfaces: outputTargetRegistry.surfaces.map(record => ({
      ...structuredClone(record),
      geometry: surfaceSnapshot(record.id, record.version).geometry,
    })),
  };
}

export function resolveOutputTargetQuery(query: string):
  | { schema_version: typeof outputTargetRegistry.schema_version; status: 'resolved' | 'deprecated'; target: DeliverySurfaceSnapshot; replacement?: DeliverySurfaceSnapshot }
  | { schema_version: typeof outputTargetRegistry.schema_version; status: 'ambiguous'; query: string; choices: Array<ReturnType<typeof choice>> }
  | { schema_version: typeof outputTargetRegistry.schema_version; status: 'not_found'; query: string; list_command: string } {
  const value = normalized(query);
  if (!value) throw new OutputTargetResolutionError('unknown_surface', 'output-targets resolve requires a query');
  const records = outputTargetRegistry.surfaces.filter(surface => surface.lifecycle !== 'removed');
  const platformMatches = records.filter(surface => normalized(surface.platform) === value);
  if (platformMatches.length > 0) {
    return {
      schema_version: outputTargetRegistry.schema_version,
      status: 'ambiguous',
      query,
      choices: platformMatches.map(surface => choice(surfaceSnapshot(surface.id, surface.version))),
    };
  }
  const match = records.find(surface => [
    surface.id,
    `${surface.platform} ${surface.surface}`,
    ...surface.aliases,
  ].some(alias => normalized(alias) === value));
  if (!match) {
    const partial = records.filter(surface =>
      normalized(`${surface.platform} ${surface.surface}`).includes(value)
      || value.includes(normalized(`${surface.platform} ${surface.surface}`)),
    );
    if (partial.length > 1) {
      return {
        schema_version: outputTargetRegistry.schema_version,
        status: 'ambiguous',
        query,
        choices: partial.map(surface => choice(surfaceSnapshot(surface.id, surface.version))),
      };
    }
    return {
      schema_version: outputTargetRegistry.schema_version,
      status: 'not_found',
      query,
      list_command: 'lineage output-targets list --media image --json',
    };
  }
  const target = surfaceSnapshot(match.id, match.version);
  if (target.lifecycle === 'deprecated' && target.replacement) {
    return {
      schema_version: outputTargetRegistry.schema_version,
      status: 'deprecated',
      target,
      replacement: surfaceSnapshot(target.replacement.surface_id, target.replacement.surface_version),
    };
  }
  return { schema_version: outputTargetRegistry.schema_version, status: 'resolved', target };
}

export function readOutputTargetDefaults(database: DatabaseSync, project: string, rootAssetId: string) {
  return {
    schema_version: outputTargetRegistry.schema_version,
    project_id: project,
    root_asset_id: rootAssetId,
    defaults: readCanvasGenerationTargetDefaults(database, project, rootAssetId) ?? null,
    read_only: true as const,
  };
}

export function targetMapFromShorthand(sourceAssetId: string, input: OutputTargetShorthand) {
  return generationTargetMapFromShorthand(sourceAssetId, input);
}

export function nodeTargetsFromCli(input: {
  destinations?: string[];
  customDimensions?: string[];
}): GenerationTarget[] {
  const map = generationTargetMapFromShorthand('__node__', {
    destinations: input.destinations,
    customDimensions: input.customDimensions,
  });
  if (!map) throw new OutputTargetResolutionError('invalid_target_map', 'Node target mutation requires --destination or --custom-dimensions');
  return map.sources[0].targets;
}

export function readNodeOutputTargets(
  database: DatabaseSync,
  project: string,
  rootAssetId: string,
  nodeAssetId: string,
) {
  return {
    ok: true as const,
    command: 'output-targets node get' as const,
    project,
    root_asset_id: rootAssetId,
    node_asset_id: nodeAssetId,
    setting: readNodeNextOutputTargetSetting(database, project, rootAssetId, nodeAssetId) ?? null,
    effective: resolveEffectiveNodeNextOutputTargets(database, project, rootAssetId, nodeAssetId),
  };
}

export function setNodeOutputTargets(
  database: DatabaseSync,
  fields: {
    project: string;
    rootAssetId: string;
    nodeAssetId: string;
    targets: readonly GenerationTarget[];
  },
) {
  const setting = writeNodeNextOutputTargetSetting(database, {
    projectId: fields.project,
    rootAssetId: fields.rootAssetId,
    nodeAssetId: fields.nodeAssetId,
    expectedRevision: null,
    targets: fields.targets,
    provenance: { actor: 'agent', origin: 'cli' },
  });
  return {
    ok: true as const,
    command: 'output-targets node set' as const,
    setting,
    effective: resolveEffectiveNodeNextOutputTargets(
      database,
      fields.project,
      fields.rootAssetId,
      fields.nodeAssetId,
    ),
  };
}

export function replaceNodeOutputTargets(
  database: DatabaseSync,
  fields: {
    project: string;
    rootAssetId: string;
    nodeAssetId: string;
    expectedRevision: number;
    targets: readonly GenerationTarget[];
  },
) {
  const setting = writeNodeNextOutputTargetSetting(database, {
    projectId: fields.project,
    rootAssetId: fields.rootAssetId,
    nodeAssetId: fields.nodeAssetId,
    expectedRevision: fields.expectedRevision,
    targets: fields.targets,
    provenance: { actor: 'agent', origin: 'cli' },
  });
  return {
    ok: true as const,
    command: 'output-targets node replace' as const,
    setting,
    effective: resolveEffectiveNodeNextOutputTargets(
      database,
      fields.project,
      fields.rootAssetId,
      fields.nodeAssetId,
    ),
  };
}

export function clearNodeOutputTargets(
  database: DatabaseSync,
  fields: {
    project: string;
    rootAssetId: string;
    nodeAssetId: string;
    expectedRevision: number;
  },
) {
  clearNodeNextOutputTargetSetting(database, {
    projectId: fields.project,
    rootAssetId: fields.rootAssetId,
    nodeAssetId: fields.nodeAssetId,
    expectedRevision: fields.expectedRevision,
  });
  return {
    ok: true as const,
    command: 'output-targets node clear' as const,
    cleared: true as const,
    effective: resolveEffectiveNodeNextOutputTargets(
      database,
      fields.project,
      fields.rootAssetId,
      fields.nodeAssetId,
    ),
  };
}
