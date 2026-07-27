import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveGenerationTargetPlan } from '../shared/generationTargetMap';
import { GENERATION_TARGET_MAP_SCHEMA } from '../shared/outputTargetTypes';
import type { GenerationHandoffPacket, GenerationJobInput } from '../shared/generationTypes';
import type { DatabaseSync } from './assetLineageDb';
import {
  loadGenerationTargetPlan,
  persistTargetAwareGenerationAggregate,
  type TargetAwareGenerationAggregate,
} from './generationTargetPersistence';

const require = createRequire(import.meta.url);
const { DatabaseSync: NodeDatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
let database: DatabaseSync;

function schema(): string {
  return `
    pragma foreign_keys = on;
    create table projects (id text primary key);
    create table assets (id text primary key, project_id text not null references projects(id));
    create table generation_jobs (
      id text primary key, project_id text not null references projects(id), provider text not null,
      adapter_version text not null, source_mode text not null, root_asset_id text not null references assets(id),
      prompt text not null, expected_output_count integer not null, status text not null, output_dir text,
      handoff_json text, created_at text not null, updated_at text not null, imported_at text
    );
    create table generation_job_inputs (
      id text primary key, job_id text not null references generation_jobs(id) on delete cascade,
      project_id text not null references projects(id), asset_id text not null references assets(id),
      root_asset_id text not null references assets(id), role text not null, position integer not null,
      selection_strategy text not null, selection_snapshot_json text not null
    );
    create table generation_job_receipts (
      id text primary key, job_id text not null references generation_jobs(id) on delete cascade,
      receipt_type text not null, status text not null, command text not null, payload_json text not null, created_at text not null
    );
    create table generation_target_maps (
      job_id text primary key references generation_jobs(id) on delete cascade,
      schema_version text not null, canonical_json text not null, digest_sha256 text not null
    );
    create table generation_target_groups (
      id text primary key, job_id text not null references generation_jobs(id) on delete cascade,
      parent_asset_id text not null references assets(id), media_kind text, width integer, height integer,
      geometry_json text, delivery_surfaces_json text not null, grouping_mode text not null,
      variant_count integer not null, target_map_digest text not null, guidance_json text not null, unlocked integer not null
    );
    create table generation_output_slots (
      id text primary key, job_id text not null references generation_jobs(id) on delete cascade,
      target_group_id text not null references generation_target_groups(id), parent_asset_id text not null references assets(id),
      output_index integer not null, variant_index integer not null, output_spec_json text
    );
    insert into projects values ('project');
    insert into assets values ('root', 'project'), ('asset-a', 'project');
  `;
}

beforeEach(() => {
  database = new NodeDatabaseSync(':memory:');
  database.exec(schema());
});

afterEach(() => database.close());

function aggregate(): TargetAwareGenerationAggregate {
  const timestamp = '2026-07-27T00:00:00.000Z';
  const plan = resolveGenerationTargetPlan('job', {
    schema_version: GENERATION_TARGET_MAP_SCHEMA,
    sources: [{
      asset_id: 'asset-a',
      default_variant_count: 2,
      targets: [{ kind: 'delivery_surface', surface_id: 'instagram.feed_square', surface_version: 1 }],
    }],
  }, ['asset-a']);
  const handoff: GenerationHandoffPacket = {
    schema_version: 'lineage.generation_handoff.v2',
    provider: 'codex-handoff',
    project: 'project',
    job_id: 'job',
    prompt: 'Prompt',
    expected_output_count: 2,
    lineage: {
      root_asset_id: 'root',
      parent_asset_id: 'asset-a',
      selection_strategy: 'selected',
      parent_title: 'Asset',
    },
    instructions: [],
    import_command: 'lineage generate image import',
    guardrails: { live_generation: false, external_services: false, output_root: '.asset-scratch', confirm_write_required: true },
  };
  const input: GenerationJobInput = {
    id: 'job:input:0',
    job_id: 'job',
    project_id: 'project',
    asset_id: 'asset-a',
    root_asset_id: 'root',
    role: 'lineage_next_base',
    position: 0,
    selection_strategy: 'selected',
    selection_snapshot: {} as GenerationJobInput['selection_snapshot'],
  };
  return {
    job: {
      id: 'job', project_id: 'project', provider: 'codex-handoff', adapter_version: 'generation-receipts-v3',
      source_mode: 'lineage_selection', root_asset_id: 'root', prompt: 'Prompt', expected_output_count: 2,
      status: 'planned', output_dir: '.asset-scratch', handoff, created_at: timestamp, updated_at: timestamp, inputs: [input],
    },
    inputs: [input],
    plan,
    receipt: { id: 'job:receipt:plan', command: 'generate image plan', payload: { target_map_digest: plan.digest_sha256 }, created_at: timestamp },
  };
}

describe('generation target persistence', () => {
  it('stores the frozen map, digest, groups, slots, specs, and receipt together', () => {
    const value = aggregate();
    persistTargetAwareGenerationAggregate(database, value);
    const loaded = loadGenerationTargetPlan(database, 'job');
    expect(loaded?.digest_sha256).toBe(value.plan.digest_sha256);
    expect(loaded?.groups).toHaveLength(1);
    expect(loaded?.slots).toHaveLength(2);
    expect(loaded?.slots.every(slot => slot.output_spec?.width === 1080)).toBe(true);
    expect(database.prepare('select count(*) count from generation_job_receipts').get()).toMatchObject({ count: 1 });
  });

  it('rolls back the entire aggregate when its plan receipt cannot commit', () => {
    database.exec(`create trigger reject_plan_receipt before insert on generation_job_receipts begin select raise(abort, 'receipt rejected'); end;`);
    expect(() => persistTargetAwareGenerationAggregate(database, aggregate())).toThrow(/receipt rejected/i);
    for (const table of ['generation_jobs', 'generation_job_inputs', 'generation_target_maps', 'generation_target_groups', 'generation_output_slots']) {
      expect(database.prepare(`select count(*) count from ${table}`).get()).toMatchObject({ count: 0 });
    }
  });
});
