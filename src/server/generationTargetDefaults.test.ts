import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from './assetLineageDb';
import { readCanvasGenerationTargetDefaults, writeCanvasGenerationTargetDefaults } from './generationTargetDefaults';

const require = createRequire(import.meta.url);
const { DatabaseSync: NodeDatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
let database: DatabaseSync;

beforeEach(() => {
  database = new NodeDatabaseSync(':memory:');
  database.exec(`
    create table projects (id text primary key);
    create table assets (id text primary key, project_id text not null references projects(id));
    create table generation_target_defaults (
      project_id text not null references projects(id),
      root_asset_id text not null references assets(id),
      default_variant_count integer not null check (default_variant_count > 0),
      targets_json text not null,
      separate_surface_ids_json text not null,
      provenance text not null check (provenance = 'human'),
      created_at text not null,
      updated_at text not null,
      primary key(project_id, root_asset_id)
    );
    insert into projects values ('project');
    insert into assets values ('root-a', 'project'), ('root-b', 'project');
  `);
});

afterEach(() => database.close());

describe('canvas generation target defaults', () => {
  it('is project-root scoped, explicit, and readable as a detached snapshot', () => {
    const stored = writeCanvasGenerationTargetDefaults(database, 'project', 'root-a', {
      actor: 'human',
      origin: 'canvas',
      default_variant_count: 2,
      targets: [{ kind: 'delivery_surface', surface_id: 'instagram.story', surface_version: 1 }],
    }, '2026-07-27T01:00:00.000Z');
    expect(stored).toMatchObject({ root_asset_id: 'root-a', default_variant_count: 2, provenance: 'human' });
    stored.targets[0] = { kind: 'unlocked' };
    expect(readCanvasGenerationTargetDefaults(database, 'project', 'root-a')?.targets[0]).toMatchObject({ surface_id: 'instagram.story' });
    expect(readCanvasGenerationTargetDefaults(database, 'project', 'root-b')).toBeUndefined();
  });

  it('rejects agent and CLI provenance at runtime', () => {
    const invalid = {
      actor: 'agent',
      origin: 'cli',
      targets: [{ kind: 'unlocked' }],
    };
    expect(() => writeCanvasGenerationTargetDefaults(
      database,
      'project',
      'root-a',
      invalid as unknown as Parameters<typeof writeCanvasGenerationTargetDefaults>[3],
    )).toThrow(/human canvas operation/i);
    expect(readCanvasGenerationTargetDefaults(database, 'project', 'root-a')).toBeUndefined();
  });
});
