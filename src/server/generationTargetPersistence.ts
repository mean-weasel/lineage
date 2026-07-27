import type { DatabaseSync } from './assetLineageDb';
import type { GenerationJob, GenerationJobInput } from '../shared/generationTypes';
import type { ResolvedGenerationTargetPlan } from '../shared/outputTargetTypes';

export interface TargetAwareGenerationAggregate {
  job: Omit<GenerationJob, 'outputs' | 'receipts' | 'target_plan'>;
  inputs: GenerationJobInput[];
  plan: ResolvedGenerationTargetPlan;
  receipt: { id: string; command: string; payload: unknown; created_at: string };
}

export function persistGenerationTargetPlan(
  database: DatabaseSync,
  jobId: string,
  plan: ResolvedGenerationTargetPlan,
): void {
  database.prepare(`
    insert into generation_target_maps (job_id, schema_version, canonical_json, digest_sha256)
    values (?, ?, ?, ?)
  `).run(jobId, plan.map.schema_version, plan.canonical_json, plan.digest_sha256);
  const insertGroup = database.prepare(`
    insert into generation_target_groups (
      id, job_id, parent_asset_id, media_kind, width, height, geometry_json,
      delivery_surfaces_json, grouping_mode, variant_count, target_map_digest,
      guidance_json, unlocked
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSlot = database.prepare(`
    insert into generation_output_slots (
      id, job_id, target_group_id, parent_asset_id, output_index, variant_index, output_spec_json
    ) values (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const group of plan.groups) {
    insertGroup.run(
      group.id,
      jobId,
      group.parent_asset_id,
      group.media_kind || null,
      group.width || null,
      group.height || null,
      group.geometry || group.custom_geometry ? JSON.stringify(group.geometry || group.custom_geometry) : null,
      JSON.stringify(group.delivery_surfaces),
      group.grouping_mode,
      group.variant_count,
      group.target_map_digest,
      JSON.stringify(group.guidance),
      group.unlocked ? 1 : 0,
    );
  }
  for (const slot of plan.slots) {
    insertSlot.run(
      slot.id, jobId, slot.group_id, slot.parent_asset_id, slot.output_index,
      slot.variant_index, slot.output_spec ? JSON.stringify(slot.output_spec) : null,
    );
  }
}

export function loadGenerationTargetPlan(
  database: DatabaseSync,
  jobId: string,
): ResolvedGenerationTargetPlan | undefined {
  const mapRow = database.prepare('select * from generation_target_maps where job_id = ?').get(jobId) as Record<string, unknown> | undefined;
  if (!mapRow) return undefined;
  const groups = (database.prepare('select * from generation_target_groups where job_id = ? order by rowid').all(jobId) as Array<Record<string, unknown>>).map(row => ({
    id: String(row.id),
    parent_asset_id: String(row.parent_asset_id),
    ...(row.media_kind ? { media_kind: 'static_image' as const } : {}),
    ...(row.width ? { width: Number(row.width) } : {}),
    ...(row.height ? { height: Number(row.height) } : {}),
    ...(row.geometry_json ? {
      [String(JSON.parse(String(row.geometry_json)).id).startsWith('custom.') ? 'custom_geometry' : 'geometry']:
        JSON.parse(String(row.geometry_json)),
    } : {}),
    delivery_surfaces: JSON.parse(String(row.delivery_surfaces_json)),
    grouping_mode: row.grouping_mode as 'consolidated' | 'explicit_split',
    variant_count: Number(row.variant_count),
    target_map_digest: String(row.target_map_digest),
    guidance: JSON.parse(String(row.guidance_json)),
    unlocked: Number(row.unlocked) === 1,
  }));
  const slots = (database.prepare('select * from generation_output_slots where job_id = ? order by output_index').all(jobId) as Array<Record<string, unknown>>).map(row => ({
    id: String(row.id),
    group_id: String(row.target_group_id),
    parent_asset_id: String(row.parent_asset_id),
    output_index: Number(row.output_index),
    variant_index: Number(row.variant_index),
    ...(row.output_spec_json ? { output_spec: JSON.parse(String(row.output_spec_json)) } : {}),
  }));
  return {
    map: JSON.parse(String(mapRow.canonical_json)),
    canonical_json: String(mapRow.canonical_json),
    digest_sha256: String(mapRow.digest_sha256),
    groups,
    slots,
    expected_output_count: slots.length,
  };
}

export function persistTargetAwareGenerationAggregate(
  database: DatabaseSync,
  aggregate: TargetAwareGenerationAggregate,
): void {
  database.exec('BEGIN IMMEDIATE');
  try {
    const { job } = aggregate;
    database.prepare(`
      insert into generation_jobs (
        id, project_id, provider, adapter_version, source_mode, root_asset_id, prompt,
        expected_output_count, status, output_dir, handoff_json, created_at, updated_at, imported_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      job.id, job.project_id, job.provider, job.adapter_version, job.source_mode, job.root_asset_id,
      job.prompt, job.expected_output_count, job.status, job.output_dir || null, JSON.stringify(job.handoff),
      job.created_at, job.updated_at, job.imported_at || null,
    );
    const insertInput = database.prepare(`
      insert into generation_job_inputs (
        id, job_id, project_id, asset_id, root_asset_id, role, position,
        selection_strategy, selection_snapshot_json
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const input of aggregate.inputs) {
      insertInput.run(
        input.id, input.job_id, input.project_id, input.asset_id, input.root_asset_id,
        input.role, input.position, input.selection_strategy, JSON.stringify(input.selection_snapshot),
      );
    }
    persistGenerationTargetPlan(database, job.id, aggregate.plan);
    database.prepare(`
      insert into generation_job_receipts (
        id, job_id, receipt_type, status, command, payload_json, created_at
      ) values (?, ?, 'plan', 'ok', ?, ?, ?)
    `).run(aggregate.receipt.id, job.id, aggregate.receipt.command, JSON.stringify(aggregate.receipt.payload), aggregate.receipt.created_at);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
