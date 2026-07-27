import type { DatabaseSync } from '../server/assetLineageDb';
import { readCanvasGenerationTargetDefaults } from '../server/generationTargetDefaults';
import { outputTargetRegistry, surfaceSnapshot } from '../shared/outputTargetRegistry';
import {
  OutputTargetResolutionError,
  type DeliverySurfaceSnapshot,
  type OutputTargetChoice,
} from '../shared/outputTargetTypes';
import {
  generationTargetMapFromShorthand,
  type OutputTargetShorthand,
} from '../shared/generationTargetMap';

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
