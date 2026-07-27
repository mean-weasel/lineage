import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from './assetLineageDb';
import { writeCanvasGenerationTargetDefaults } from './generationTargetDefaults';
import {
  clearNodeNextOutputTargetSetting,
  initializeChildNextOutputTargetsInTransaction,
  materializeNodeTargetPlan,
  NodeNextOutputTargetError,
  readNodeNextOutputTargetSetting,
  resolveEffectiveNodeNextOutputTargets,
  writeNodeNextOutputTargetSetting,
} from './nodeNextOutputTargets';

const require = createRequire(import.meta.url);
const { DatabaseSync: NodeDatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
let database: DatabaseSync;

beforeEach(() => {
  database = new NodeDatabaseSync(':memory:');
  database.exec(`
    pragma foreign_keys = on;
    create table projects (id text primary key);
    create table assets (id text primary key, project_id text not null references projects(id));
    create table asset_edges (
      id text primary key,
      project_id text not null references projects(id),
      parent_asset_id text not null references assets(id),
      child_asset_id text not null references assets(id),
      relation_type text not null
    );
    create table generation_target_defaults (
      project_id text not null references projects(id),
      root_asset_id text not null references assets(id),
      default_variant_count integer not null,
      targets_json text not null,
      separate_surface_ids_json text not null,
      provenance text not null,
      created_at text not null,
      updated_at text not null,
      primary key(project_id, root_asset_id)
    );
    create table node_next_output_target_settings (
      project_id text not null references projects(id),
      root_asset_id text not null references assets(id),
      node_asset_id text not null references assets(id),
      schema_version text not null,
      revision integer not null,
      targets_json text not null,
      resolved_targets_json text not null,
      provenance_actor text not null,
      provenance_origin text not null,
      digest_sha256 text not null,
      created_at text not null,
      updated_at text not null,
      primary key(project_id, root_asset_id, node_asset_id)
    );
    insert into projects values ('project');
    insert into assets values
      ('root', 'project'),
      ('node', 'project'),
      ('child', 'project');
    insert into asset_edges values
      ('edge-node', 'project', 'root', 'node', 'derived_from'),
      ('edge-child', 'project', 'node', 'child', 'derived_from');
  `);
});

afterEach(() => database.close());

describe('node next-output target settings', () => {
  it('requires compare-and-swap replacement and keeps job-time counts out of the setting', () => {
    const first = writeNodeNextOutputTargetSetting(database, {
      projectId: 'project',
      rootAssetId: 'root',
      nodeAssetId: 'node',
      expectedRevision: null,
      targets: [{ kind: 'custom', width: 1200, height: 628 }],
      provenance: { actor: 'agent', origin: 'cli' },
      timestamp: '2026-07-27T01:00:00.000Z',
    });
    expect(first).toMatchObject({ revision: 1, targets: [{ kind: 'custom', width: 1200, height: 628 }] });
    expect(() => writeNodeNextOutputTargetSetting(database, {
      projectId: 'project',
      rootAssetId: 'root',
      nodeAssetId: 'node',
      expectedRevision: null,
      targets: [{ kind: 'custom', width: 1080, height: 1080 }],
      provenance: { actor: 'agent', origin: 'cli' },
    })).toThrow(NodeNextOutputTargetError);
    expect(() => writeNodeNextOutputTargetSetting(database, {
      projectId: 'project',
      rootAssetId: 'root',
      nodeAssetId: 'node',
      expectedRevision: 1,
      targets: [{ kind: 'custom', width: 1080, height: 1080, variant_count: 2 }],
      provenance: { actor: 'agent', origin: 'cli' },
    })).toThrow(/job-time options/i);
    const replaced = writeNodeNextOutputTargetSetting(database, {
      projectId: 'project',
      rootAssetId: 'root',
      nodeAssetId: 'node',
      expectedRevision: 1,
      targets: [{ kind: 'custom', width: 1080, height: 1080 }],
      provenance: { actor: 'human', origin: 'canvas' },
    });
    expect(replaced.revision).toBe(2);
    expect(replaced.digest_sha256).not.toBe(first.digest_sha256);
    expect(() => writeNodeNextOutputTargetSetting(database, {
      projectId: 'project',
      rootAssetId: 'root',
      nodeAssetId: 'node',
      expectedRevision: 2,
      targets: [{ kind: 'custom', width: 1080, height: 1080 }],
      provenance: { actor: 'agent', origin: 'canvas' },
    })).toThrow(/provenance/i);
  });

  it('consolidates equal platform geometries while preserving frozen surface metadata', () => {
    const setting = writeNodeNextOutputTargetSetting(database, {
      projectId: 'project',
      rootAssetId: 'root',
      nodeAssetId: 'node',
      expectedRevision: null,
      targets: [
        { kind: 'delivery_surface', surface_id: 'instagram.story', surface_version: 1 },
        { kind: 'delivery_surface', surface_id: 'facebook.story', surface_version: 1 },
        { kind: 'delivery_surface', surface_id: 'x.standalone_vertical', surface_version: 1 },
      ],
      provenance: { actor: 'human', origin: 'canvas' },
    });
    expect(setting.resolved_targets).toHaveLength(1);
    expect(setting.resolved_targets[0]).toMatchObject({ width: 1080, height: 1920 });
    expect(setting.resolved_targets[0].delivery_surfaces.map(surface => surface.id)).toEqual([
      'facebook.story',
      'instagram.story',
      'x.standalone_vertical',
    ]);
    expect(setting.resolved_targets[0].delivery_surfaces.every(surface => surface.source_verified_at === '2026-07-27')).toBe(true);
  });

  it('clears to the current human canvas default and ignores default variation counts', () => {
    writeCanvasGenerationTargetDefaults(database, 'project', 'root', {
      actor: 'human',
      origin: 'canvas',
      default_variant_count: 4,
      targets: [{
        kind: 'delivery_surface',
        surface_id: 'instagram.feed_portrait',
        surface_version: 1,
        variant_count: 3,
      }],
    });
    const setting = writeNodeNextOutputTargetSetting(database, {
      projectId: 'project',
      rootAssetId: 'root',
      nodeAssetId: 'node',
      expectedRevision: null,
      targets: [{ kind: 'custom', width: 1200, height: 628 }],
      provenance: { actor: 'human', origin: 'canvas' },
    });
    expect(resolveEffectiveNodeNextOutputTargets(database, 'project', 'root', 'node').origin).toBe('node_override');
    expect(clearNodeNextOutputTargetSetting(database, {
      projectId: 'project',
      rootAssetId: 'root',
      nodeAssetId: 'node',
      expectedRevision: setting.revision,
    })).toBe(true);
    const effective = resolveEffectiveNodeNextOutputTargets(database, 'project', 'root', 'node');
    expect(effective).toMatchObject({
      origin: 'canvas_default',
      resolved_targets: [{ width: 1080, height: 1440 }],
      targets: [{ kind: 'delivery_surface', surface_id: 'instagram.feed_portrait', surface_version: 1 }],
    });
    expect(effective.targets[0]).not.toHaveProperty('variant_count');
  });

  it('initializes a child with only its produced frozen geometry and is idempotent', () => {
    const outputSpec = {
      schema_version: 'lineage.output_spec.v1' as const,
      media_kind: 'static_image' as const,
      width: 1080,
      height: 1920,
      geometry: {
        id: 'static-image.1080x1920',
        version: 1,
        media_kind: 'static_image' as const,
        width: 1080,
        height: 1920,
      },
      delivery_surfaces: [{
        id: 'instagram.story',
        version: 1,
        platform: 'Instagram',
        surface: 'Story',
        media_kind: 'static_image' as const,
        geometry: {
          id: 'static-image.1080x1920',
          version: 1,
          media_kind: 'static_image' as const,
          width: 1080,
          height: 1920,
        },
        guidance: [],
        source_url: 'https://example.test/frozen',
        source_verified_at: '2026-07-27',
        lifecycle: 'active' as const,
      }],
      grouping_mode: 'consolidated' as const,
      target_group_id: 'job:group:0',
      variant_index: 0,
    };
    const first = initializeChildNextOutputTargetsInTransaction(database, {
      projectId: 'project',
      rootAssetId: 'root',
      nodeAssetId: 'child',
      outputSpec,
      timestamp: '2026-07-27T02:00:00.000Z',
    });
    const retry = initializeChildNextOutputTargetsInTransaction(database, {
      projectId: 'project',
      rootAssetId: 'root',
      nodeAssetId: 'child',
      outputSpec,
      timestamp: '2026-07-27T02:00:00.000Z',
    });
    expect(retry.digest_sha256).toBe(first.digest_sha256);
    expect(readNodeNextOutputTargetSetting(database, 'project', 'root', 'child')).toMatchObject({
      provenance: { actor: 'system', origin: 'derived_child' },
      resolved_targets: [{
        width: 1080,
        height: 1920,
        delivery_surfaces: [{ source_url: 'https://example.test/frozen' }],
      }],
    });
  });

  it('materializes jobs from frozen node metadata instead of re-resolving registry geometry', () => {
    const plan = materializeNodeTargetPlan('job-frozen', [{
      parent_asset_id: 'node',
      origin: 'node_override',
      setting_revision: 1,
      setting_digest_sha256: 'setting',
      resolution_digest_sha256: 'resolution',
      targets: [{ kind: 'delivery_surface', surface_id: 'instagram.story', surface_version: 1 }],
      resolved_targets: [{
        media_kind: 'static_image',
        width: 999,
        height: 1776,
        geometry: {
          id: 'frozen.test.geometry',
          version: 7,
          media_kind: 'static_image',
          width: 999,
          height: 1776,
        },
        delivery_surfaces: [{
          id: 'instagram.story',
          version: 1,
          platform: 'Instagram',
          surface: 'Story',
          media_kind: 'static_image',
          geometry: {
            id: 'frozen.test.geometry',
            version: 7,
            media_kind: 'static_image',
            width: 999,
            height: 1776,
          },
          guidance: ['Frozen guidance'],
          source_url: 'https://example.test/historical',
          source_verified_at: '2025-01-01',
          lifecycle: 'active',
        }],
      }],
    }], 2);
    expect(plan).toMatchObject({
      expected_output_count: 2,
      groups: [{
        width: 999,
        height: 1776,
        guidance: ['Frozen guidance'],
      }],
      slots: [
        { output_spec: { width: 999, height: 1776 } },
        { output_spec: { width: 999, height: 1776 } },
      ],
    });
  });
});
