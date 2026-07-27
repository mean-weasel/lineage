import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { useLineageTestProfile } from '../test/lineageTestProfile';
import { defaultProject, repoRoot } from './assetCore';
import { getLineageAttempts, getLineageSnapshot, indexLineageAssets, linkLineageAssets, markLineageRerollRequest, updateSelectedAsset } from './assetLineage';
import { lineageDb } from './assetLineageDb';
import { listLineageTasks } from './assetLineageTasks';
import { createLineageWorkspace } from './assetLineageWorkspaces';
import {
  importImageGenerationOutputs,
  importImageRerollOutput,
  inspectImageGeneration,
  planImageGeneration,
  planImageReroll,
} from './generationReceipts';
import { listImageGenerationJobs } from './generationReceiptJobs';
import { getLineageSelectionPacket } from './lineageSelectionPacket';
import { fileSha256 } from './localReview';
import type { GenerationJob } from '../shared/types';
import { GENERATION_TARGET_MAP_SCHEMA } from '../shared/outputTargetTypes';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
const scratchDir = join(repoRoot, '.asset-scratch', 'vitest generation receipts');
const dbFile = join(scratchDir, 'generation-receipts.sqlite');

function localId(file: string): string {
  return `local-${fileSha256(file).slice(0, 12)}`;
}

function writeScratch(relativePath: string, content: string): string {
  const file = join(scratchDir, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

async function writeRaster(
  relativePath: string,
  width: number,
  height: number,
  format: 'jpeg' | 'png' | 'webp' = 'png',
): Promise<string> {
  const file = join(scratchDir, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  await sharp({
    create: { background: '#23574a', channels: 4, height, width },
  })[format]().toFile(file);
  return file;
}

function outputManifest(job: GenerationJob, files: string[], summaries?: string[]) {
  const draft = job.handoff.output_manifest;
  if (!draft) throw new Error(`Generation job ${job.id} is missing its output manifest draft`);
  return {
    ...draft,
    outputs: draft.outputs.slice(0, files.length).map((output, index) => ({
      ...output,
      edge_summary: summaries?.[index] || `Variation ${index + 1}`,
      file_path: files[index],
    })),
  };
}

function markGenerationJobLegacy(jobId: string): void {
  const database = lineageDb();
  try {
    database.prepare("update generation_jobs set adapter_version = 'generation-receipts-v1' where id = ?").run(jobId);
  } finally {
    database.close();
  }
}

function setupSelectedLineage(prefix = 'generation') {
  const root = writeScratch(`demo-linkedin-${prefix}-root.png`, `${prefix}-root-${Date.now()}`);
  const selected = writeScratch(`demo-linkedin-${prefix}-selected.png`, `${prefix}-selected-${Date.now()}`);
  const other = writeScratch(`demo-linkedin-${prefix}-other.png`, `${prefix}-other-${Date.now()}`);
  const rootId = localId(root);
  const selectedId = localId(selected);
  const otherId = localId(other);

  indexLineageAssets(defaultProject);
  linkLineageAssets(defaultProject, { childAssetId: selectedId, confirmWrite: true, parentAssetId: rootId });
  linkLineageAssets(defaultProject, { childAssetId: otherId, confirmWrite: true, parentAssetId: rootId });
  createLineageWorkspace(defaultProject, {
    activate: true,
    confirmWrite: true,
    createdBy: 'agent',
    rootAssetId: rootId,
    title: 'Generation receipt test workspace',
  });
  updateSelectedAsset(defaultProject, {
    assetId: selectedId,
    confirmWrite: true,
    notes: 'Use this selected base for generation.',
    rootAssetId: rootId,
  });

  return { otherId, rootId, selectedId };
}

function setupWorkspaceWithoutSelection() {
  const root = writeScratch('demo-linkedin-generation-unselected-root.png', `generation-unselected-root-${Date.now()}`);
  const childA = writeScratch('demo-linkedin-generation-unselected-a.png', `generation-unselected-a-${Date.now()}`);
  const childB = writeScratch('demo-linkedin-generation-unselected-b.png', `generation-unselected-b-${Date.now()}`);
  const rootId = localId(root);
  indexLineageAssets(defaultProject);
  linkLineageAssets(defaultProject, { childAssetId: localId(childA), confirmWrite: true, parentAssetId: rootId });
  linkLineageAssets(defaultProject, { childAssetId: localId(childB), confirmWrite: true, parentAssetId: rootId });
  createLineageWorkspace(defaultProject, {
    activate: true,
    confirmWrite: true,
    createdBy: 'agent',
    rootAssetId: rootId,
    title: 'Generation receipt unselected workspace',
  });
}

function countRows(table: string, where = ''): number {
  const database = lineageDb();
  try {
    const row = database.prepare(`select count(*) count from ${table} ${where}`).get() as { count: number };
    return row.count;
  } finally {
    database.close();
  }
}

function seedProjectWideCurrentSelection(assetIds: string[]): void {
  const database = lineageDb();
  try {
    const timestamp = new Date().toISOString();
    const setId = `${defaultProject}:selection:current`;
    database.prepare(`
      insert into selection_sets (id, project_id, kind, key, label, status, created_by, created_at, updated_at)
      values (?, ?, 'current', 'current', 'Current selection', 'active', 'human', ?, ?)
      on conflict(project_id, kind, key) do update set updated_at = excluded.updated_at
    `).run(setId, defaultProject, timestamp, timestamp);
    for (const [index, assetId] of assetIds.entries()) {
      database.prepare(`
        insert into selection_items (id, set_id, asset_id, role, position, selected_by, selected_at, created_at, updated_at)
        values (?, ?, ?, 'candidate', ?, 'human', ?, ?, ?)
      `).run(`${setId}:${index}`, setId, assetId, index, timestamp, timestamp, timestamp);
    }
  } finally {
    database.close();
  }
}

function setWorkspaceActiveAt(rootAssetId: string, activeAt: string): void {
  const database = lineageDb();
  try {
    database.prepare(`
      update lineage_workspaces set active_at = ?, updated_at = ?
      where project_id = ? and root_asset_id = ?
    `).run(activeAt, activeAt, defaultProject, rootAssetId);
  } finally {
    database.close();
  }
}

function seedLegacyGenerationReceiptDb(file: string): void {
  const database = new DatabaseSync(file);
  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      create table projects (
        id text primary key,
        product text not null,
        catalog_path text,
        created_at text not null,
        updated_at text not null
      );
      create table assets (
        id text primary key,
        project_id text not null references projects(id),
        source text not null check (source in ('local', 'catalog')),
        local_path text,
        s3_key text,
        checksum_sha256 text,
        media_type text not null,
        title text not null,
        status text not null,
        channel text,
        campaign text,
        audience text,
        size_bytes integer,
        content_type text,
        created_at text not null,
        updated_at text not null,
        last_seen_at text not null
      );
      create table generation_jobs (
        id text primary key,
        project_id text not null references projects(id),
        provider text not null default 'codex-handoff',
        adapter_version text not null,
        source_mode text not null check (source_mode in ('lineage_selection')),
        root_asset_id text not null references assets(id),
        prompt text not null,
        expected_output_count integer not null check (expected_output_count > 0),
        status text not null check (status in ('planned', 'imported', 'failed', 'cancelled')),
        output_dir text,
        handoff_json text,
        created_at text not null,
        updated_at text not null,
        imported_at text
      );
      create table generation_job_inputs (
        id text primary key,
        job_id text not null references generation_jobs(id) on delete cascade,
        project_id text not null references projects(id),
        asset_id text not null references assets(id),
        root_asset_id text not null references assets(id),
        role text not null check (role in ('lineage_next_base', 'reference')),
        position integer not null,
        selection_strategy text not null,
        selection_snapshot_json text not null,
        unique(job_id, asset_id, role)
      );
      create table generation_job_outputs (
        id text primary key,
        job_id text not null references generation_jobs(id) on delete cascade,
        project_id text not null references projects(id),
        output_index integer not null,
        file_path text not null,
        checksum_sha256 text not null,
        size_bytes integer not null,
        content_type text not null,
        imported_asset_id text not null references assets(id),
        parent_asset_id text not null references assets(id),
        imported_at text not null,
        unique(job_id, output_index),
        unique(job_id, file_path)
      );
      create table generation_job_receipts (
        id text primary key,
        job_id text not null references generation_jobs(id) on delete cascade,
        receipt_type text not null check (receipt_type in ('plan', 'import', 'error')),
        status text not null check (status in ('ok', 'error')),
        command text not null,
        payload_json text not null,
        created_at text not null
      );
    `);
    const timestamp = '2026-01-01T00:00:00.000Z';
    database.prepare('insert into projects (id, product, created_at, updated_at) values (?, ?, ?, ?)').run(defaultProject, defaultProject, timestamp, timestamp);
    for (const assetId of ['legacy-root', 'legacy-target']) {
      database.prepare(`
        insert into assets (
          id, project_id, source, local_path, media_type, title, status, created_at, updated_at, last_seen_at
        ) values (?, ?, 'local', ?, 'image', ?, 'ready', ?, ?, ?)
      `).run(assetId, defaultProject, `${assetId}.png`, assetId, timestamp, timestamp, timestamp);
    }
    database.prepare(`
      insert into generation_jobs (
        id, project_id, provider, adapter_version, source_mode, root_asset_id, prompt,
        expected_output_count, status, output_dir, handoff_json, created_at, updated_at
      ) values ('legacy-job', ?, 'codex-handoff', 'generation-receipts-v1', 'lineage_selection', 'legacy-root', 'Legacy selection job', 1, 'planned', '.asset-scratch', '{}', ?, ?)
    `).run(defaultProject, timestamp, timestamp);
    database.prepare(`
      insert into generation_job_inputs (
        id, job_id, project_id, asset_id, root_asset_id, role, position, selection_strategy, selection_snapshot_json
      ) values ('legacy-input', 'legacy-job', ?, 'legacy-target', 'legacy-root', 'lineage_next_base', 0, 'selected', '{}')
    `).run(defaultProject);
    database.prepare(`
      insert into generation_job_outputs (
        id, job_id, project_id, output_index, file_path, checksum_sha256, size_bytes,
        content_type, imported_asset_id, parent_asset_id, imported_at
      ) values ('legacy-output', 'legacy-job', ?, 0, 'legacy-output.png', ?, 1, 'image/png', 'legacy-target', 'legacy-root', ?)
    `).run(defaultProject, 'a'.repeat(64), timestamp);
    database.prepare(`
      insert into generation_job_receipts (
        id, job_id, receipt_type, status, command, payload_json, created_at
      ) values ('legacy-receipt', 'legacy-job', 'plan', 'ok', 'generate image plan', '{}', ?)
    `).run(timestamp);
  } finally {
    database.close();
  }
}

describe('generation receipts', () => {
  beforeEach(() => {
    rmSync(scratchDir, { recursive: true, force: true });
    mkdirSync(scratchDir, { recursive: true });
    useLineageTestProfile(dbFile);
  });

  it('plans, inspects, and imports local generation outputs as lineage children', () => {
    const lineage = setupSelectedLineage();
    process.env.LINEAGE_CHANNEL = 'dev';
    const profileManifest = process.env.LINEAGE_PROFILE_MANIFEST!;
    const plan = planImageGeneration(defaultProject, {
      count: 2,
      fromLineageSelection: true,
      prompt: 'Create two cleaner image variations from the selected base.',
    });

    expect(plan.job.status).toBe('planned');
    expect(plan.job.adapter_version).toBe('generation-receipts-v2');
    expect(plan.job.handoff.schema_version).toBe('lineage.generation_handoff.v2');
    expect(plan.job.handoff.output_manifest?.outputs).toHaveLength(2);
    expect(plan.job.inputs).toHaveLength(1);
    expect(plan.job.inputs[0]).toMatchObject({ asset_id: lineage.selectedId, role: 'lineage_next_base' });
    expect(plan.job.handoff.provider).toBe('codex-handoff');
    expect(plan.job.handoff.import_command).toContain(`--profile '${profileManifest}'`);
    expect(plan.job.receipts[0]).toMatchObject({ receipt_type: 'plan', status: 'ok' });

    const inspected = inspectImageGeneration(defaultProject, plan.job.id);
    expect(inspected.job.prompt).toContain('cleaner image variations');
    expect(inspected.job.receipts).toHaveLength(1);

    const firstOutput = writeScratch('imports/demo-linkedin-generation-output-a.png', 'generation-output-a');
    const secondOutput = writeScratch('imports/demo-linkedin-generation-output-b.png', 'generation-output-b');
    const imported = importImageGenerationOutputs(defaultProject, {
      confirmWrite: true,
      jobId: plan.job.id,
      manifest: outputManifest(plan.job, [firstOutput, secondOutput], ['Cleaner type', 'Warmer light']),
    });

    expect(imported.job.status).toBe('imported');
    expect(imported.imported.map(output => output.parent_asset_id)).toEqual([lineage.selectedId, lineage.selectedId]);
    expect(imported.imported.map(output => output.imported_asset_id)).toEqual([localId(firstOutput), localId(secondOutput)]);
    expect(imported.imported.map(output => output.edge_summary)).toEqual(['Cleaner type', 'Warmer light']);
    expect(imported.job.receipts.map(receipt => receipt.receipt_type)).toEqual(['plan', 'import']);

    const database = lineageDb();
    try {
      const edges = database.prepare(`
        select child_asset_id, summary, summary_created_by, summary_updated_by, summary_updated_at from asset_edges
        where project_id = ? and parent_asset_id = ?
        order by child_asset_id
      `).all(defaultProject, lineage.selectedId) as Array<{ child_asset_id: string }>;
      expect(edges).toEqual(expect.arrayContaining([
        expect.objectContaining({ child_asset_id: localId(firstOutput), summary: 'Cleaner type', summary_created_by: 'agent', summary_updated_by: 'agent', summary_updated_at: expect.any(String) }),
        expect.objectContaining({ child_asset_id: localId(secondOutput), summary: 'Warmer light', summary_created_by: 'agent', summary_updated_by: 'agent', summary_updated_at: expect.any(String) }),
      ]));
    } finally {
      database.close();
    }
  });

  it('lists generation jobs by root and asset involvement for UX proof', () => {
    const lineage = setupSelectedLineage('generation-list');
    const plan = planImageGeneration(defaultProject, { count: 1, fromLineageSelection: true, prompt: 'Create one proof-list output.' });
    const output = writeScratch('imports/demo-linkedin-generation-listed-output.png', 'generation-listed-output');
    const imported = importImageGenerationOutputs(defaultProject, { confirmWrite: true, jobId: plan.job.id, manifest: outputManifest(plan.job, [output]) });
    const outputAssetId = imported.imported[0].imported_asset_id;

    const byParent = listImageGenerationJobs(defaultProject, { assetId: lineage.selectedId, rootAssetId: lineage.rootId });
    expect(byParent.jobs.map(job => job.id)).toEqual([plan.job.id]);
    expect(byParent.jobs[0]).toMatchObject({ status: 'imported', prompt: 'Create one proof-list output.' });
    expect(byParent.jobs[0].receipts.map(receipt => receipt.receipt_type)).toEqual(['plan', 'import']);

    const byOutput = listImageGenerationJobs(defaultProject, { assetId: outputAssetId, rootAssetId: lineage.rootId });
    expect(byOutput.jobs.map(job => job.id)).toEqual([plan.job.id]);
    expect(byOutput.jobs[0].outputs[0]).toMatchObject({ imported_asset_id: outputAssetId, parent_asset_id: lineage.selectedId });

    expect(listImageGenerationJobs(defaultProject, { assetId: lineage.otherId, rootAssetId: lineage.rootId }).jobs).toEqual([]);
  });

  it('rejects missing --prompt', () => {
    setupSelectedLineage();
    expect(() => planImageGeneration(defaultProject, {
      count: 1,
      fromLineageSelection: true,
      prompt: '   ',
    })).toThrow('Missing --prompt');
  });

  it('rejects no active lineage selection and no clear next asset', () => {
    expect(() => planImageGeneration(defaultProject, {
      count: 1,
      fromLineageSelection: true,
      prompt: 'Create one variation.',
    })).toThrow('No active lineage workspace');

    setupWorkspaceWithoutSelection();
    expect(() => planImageGeneration(defaultProject, {
      count: 1,
      fromLineageSelection: true,
      prompt: 'Create one variation.',
    })).toThrow('No clear lineage next asset');
  });

  it('keeps dry-run plans out of generation_jobs', () => {
    setupSelectedLineage();
    const preview = planImageGeneration(defaultProject, {
      count: 1,
      dryRun: true,
      fromLineageSelection: true,
      prompt: 'Preview one generation receipt.',
    });

    expect(preview).toMatchObject({ dryRun: true, wouldWrite: true });
    expect(countRows('generation_jobs')).toBe(0);
    expect(countRows('generation_job_inputs')).toBe(0);
    expect(countRows('generation_job_outputs')).toBe(0);
    expect(countRows('generation_job_receipts')).toBe(0);
  });

  it('migrates legacy generation receipt checks to allow re-roll jobs and targets', () => {
    seedLegacyGenerationReceiptDb(dbFile);

    const database = lineageDb();
    try {
      const timestamp = '2026-01-02T00:00:00.000Z';
      database.prepare(`
        insert into generation_jobs (
          id, project_id, provider, adapter_version, source_mode, root_asset_id, prompt,
          expected_output_count, status, output_dir, handoff_json, created_at, updated_at
        ) values ('legacy-reroll-job', ?, 'codex-handoff', 'generation-receipts-v1', 'lineage_reroll', 'legacy-root', 'Legacy reroll job', 1, 'planned', '.asset-scratch', '{}', ?, ?)
      `).run(defaultProject, timestamp, timestamp);
      database.prepare(`
        insert into generation_job_inputs (
          id, job_id, project_id, asset_id, root_asset_id, role, position, selection_strategy, selection_snapshot_json
        ) values ('legacy-reroll-input', 'legacy-reroll-job', ?, 'legacy-target', 'legacy-root', 'reroll_target', 0, 'reroll_request', '{}')
      `).run(defaultProject);

      const jobSql = database.prepare("select sql from sqlite_master where type = 'table' and name = 'generation_jobs'").get() as { sql: string };
      const inputSql = database.prepare("select sql from sqlite_master where type = 'table' and name = 'generation_job_inputs'").get() as { sql: string };
      const outputSql = database.prepare("select sql from sqlite_master where type = 'table' and name = 'generation_job_outputs'").get() as { sql: string };
      const receiptSql = database.prepare("select sql from sqlite_master where type = 'table' and name = 'generation_job_receipts'").get() as { sql: string };
      const legacyJob = database.prepare("select source_mode from generation_jobs where id = 'legacy-job'").get() as { source_mode: string };
      const legacyReceipt = database.prepare("select job_id from generation_job_receipts where id = 'legacy-receipt'").get() as { job_id: string };
      const violations = database.prepare('pragma foreign_key_check').all();

      expect(jobSql.sql).toContain("'lineage_reroll'");
      expect(inputSql.sql).toContain("'reroll_target'");
      expect(outputSql.sql).toContain('references generation_jobs');
      expect(outputSql.sql).not.toContain('generation_jobs_legacy_check');
      expect(receiptSql.sql).toContain('references generation_jobs');
      expect(receiptSql.sql).not.toContain('generation_jobs_legacy_check');
      expect(legacyJob.source_mode).toBe('lineage_selection');
      expect(legacyReceipt.job_id).toBe('legacy-job');
      expect(violations).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('migrates legacy generation output summaries idempotently and reads populated values', () => {
    seedLegacyGenerationReceiptDb(dbFile);

    for (let pass = 0; pass < 2; pass += 1) {
      const database = lineageDb();
      try {
        const columns = database.prepare('pragma table_info(generation_job_outputs)').all() as Array<{ name: string }>;
        expect(columns.filter(column => column.name === 'edge_summary')).toHaveLength(1);
      } finally {
        database.close();
      }
    }

    expect(inspectImageGeneration(defaultProject, 'legacy-job').job.outputs[0]).not.toHaveProperty('edge_summary');
    const database = lineageDb();
    try {
      database.prepare("update generation_job_outputs set edge_summary = 'Cleaner type' where id = 'legacy-output'").run();
    } finally {
      database.close();
    }
    expect(inspectImageGeneration(defaultProject, 'legacy-job').job.outputs[0]).toMatchObject({
      id: 'legacy-output',
      edge_summary: 'Cleaner type',
    });
  });

  it('uses the current active workspace even when older workspaces remain active', () => {
    const older = setupSelectedLineage('generation-older');
    const newer = setupSelectedLineage('generation-newer');
    setWorkspaceActiveAt(older.rootId, '2026-01-01T00:00:00.000Z');
    setWorkspaceActiveAt(newer.rootId, '2026-01-02T00:00:00.000Z');

    const plan = planImageGeneration(defaultProject, {
      count: 1,
      fromLineageSelection: true,
      prompt: 'Create one variation from the current active workspace.',
    });

    expect(plan.job.root_asset_id).toBe(newer.rootId);
    expect(plan.job.inputs[0].asset_id).toBe(newer.selectedId);
    expect(plan.job.inputs[0].asset_id).not.toBe(older.selectedId);
  });

  it('ignores unrelated project-wide multi-selection when lineage has one selected next base', () => {
    const lineage = setupSelectedLineage();
    seedProjectWideCurrentSelection([lineage.selectedId, lineage.otherId]);

    const plan = planImageGeneration(defaultProject, {
      count: 1,
      fromLineageSelection: true,
      prompt: 'Create one lineage variation despite unrelated current selections.',
    });

    expect(plan.job.inputs[0].asset_id).toBe(lineage.selectedId);
    expect(plan.job.receipts).toHaveLength(1);
  });

  it('plans and imports per-parent outputs for multi-selected lineage bases', () => {
    const lineage = setupSelectedLineage();
    updateSelectedAsset(defaultProject, { assetIds: [lineage.selectedId, lineage.otherId], confirmWrite: true, mode: 'replace', rootAssetId: lineage.rootId });
    const plan = planImageGeneration(defaultProject, { count: 4, fromLineageSelection: true, perBaseCount: 2, prompt: 'Create two variations from each selected base.' });
    expect(plan.job.expected_output_count).toBe(4);
    expect(plan.job.inputs.map(input => input.asset_id)).toEqual([lineage.selectedId, lineage.otherId]);
    expect(plan.job.handoff.lineage.parents?.map(parent => parent.parent_asset_id)).toEqual([lineage.selectedId, lineage.otherId]);
    expect(plan.job.handoff.import_command).toContain('--manifest');
    expect(plan.job.handoff.output_manifest?.outputs.map(output => output.parent_asset_id)).toEqual([
      lineage.selectedId, lineage.selectedId, lineage.otherId, lineage.otherId,
    ]);
    expect(plan.job.receipts[0].payload).toMatchObject({
      expected_output_count: 4,
      per_base_count: 2,
      parent_mappings: [{ parent_asset_id: lineage.selectedId, output_indexes: [0, 1] }, { parent_asset_id: lineage.otherId, output_indexes: [2, 3] }],
    });
    const files = ['multi-a1', 'multi-a2', 'multi-b1', 'multi-b2'].map(name => writeScratch(`imports/${name}.png`, name));
    const imported = importImageGenerationOutputs(defaultProject, {
      confirmWrite: true,
      jobId: plan.job.id,
      manifest: outputManifest(plan.job, files, ['Cleaner type', 'New crop', 'Warmer light', 'Bolder type']),
    });
    expect(imported.imported.map(output => output.parent_asset_id)).toEqual([lineage.selectedId, lineage.selectedId, lineage.otherId, lineage.otherId]);
    expect(imported.imported.map(output => output.edge_summary)).toEqual(['Cleaner type', 'New crop', 'Warmer light', 'Bolder type']);
    const importReceipt = imported.job.receipts.find(receipt => receipt.receipt_type === 'import');
    expect(importReceipt?.payload).toMatchObject({
      mapping_strategy: 'generation_output_manifest_v1',
      files: [0, 1, 2, 3].map(output_index => ({ output_index, parent_asset_id: output_index < 2 ? lineage.selectedId : lineage.otherId })),
    });
  }); it('imports explicit parent-keyed files for an already-planned legacy job', () => {
    const lineage = setupSelectedLineage('explicit-parent-files');
    updateSelectedAsset(defaultProject, { assetIds: [lineage.selectedId, lineage.otherId], confirmWrite: true, mode: 'replace', rootAssetId: lineage.rootId });
    const plan = planImageGeneration(defaultProject, { count: 4, fromLineageSelection: true, perBaseCount: 2, prompt: 'Create two explicit mapped variations from each selected base.' });
    markGenerationJobLegacy(plan.job.id);
    const selectedFiles = ['explicit-a1', 'explicit-a2'].map(name => writeScratch(`imports/${name}.png`, name));
    const otherFiles = ['explicit-b1', 'explicit-b2'].map(name => writeScratch(`imports/${name}.png`, name));
    const imported = importImageGenerationOutputs(defaultProject, { confirmWrite: true, jobId: plan.job.id, parentFiles: { [lineage.otherId]: otherFiles, [lineage.selectedId]: selectedFiles } });
    expect(imported.imported.map(output => output.parent_asset_id)).toEqual([lineage.selectedId, lineage.selectedId, lineage.otherId, lineage.otherId]);
    expect(imported.imported.map(output => output.imported_asset_id)).toEqual([...selectedFiles.map(localId), ...otherFiles.map(localId)]);
    const importReceipt = imported.job.receipts.find(receipt => receipt.receipt_type === 'import');
    expect(importReceipt?.payload).toMatchObject({
      mapping_strategy: 'explicit_parent_files',
      files: [0, 1, 2, 3].map(output_index => ({ output_index, parent_asset_id: output_index < 2 ? lineage.selectedId : lineage.otherId })),
    });
    expect(imported.imported.map(output => output.edge_summary)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('requires an explicit target map for multiple selected sources without partial persistence', () => {
    const lineage = setupSelectedLineage('target-aware-multi-source');
    updateSelectedAsset(defaultProject, {
      assetIds: [lineage.selectedId, lineage.otherId],
      confirmWrite: true,
      mode: 'replace',
      rootAssetId: lineage.rootId,
    });
    const jobsBefore = countRows('generation_jobs');
    expect(() => planImageGeneration(defaultProject, {
      fromLineageSelection: true,
      prompt: 'Do not apply shorthand to every source.',
      targetShorthand: { destinations: ['instagram.story'] },
    })).toThrow('requires --target-map');
    expect(countRows('generation_jobs')).toBe(jobsBefore);

    const plan = planImageGeneration(defaultProject, {
      fromLineageSelection: true,
      prompt: 'Create exact per-source target variants.',
      targetMap: {
        schema_version: GENERATION_TARGET_MAP_SCHEMA,
        sources: [
          { asset_id: lineage.selectedId, targets: [{ kind: 'delivery_surface', surface_id: 'instagram.story', surface_version: 1 }] },
          { asset_id: lineage.otherId, targets: [{ kind: 'custom', width: 1200, height: 1500, variant_count: 2 }] },
        ],
      },
    });
    expect(plan.job).toMatchObject({
      adapter_version: 'generation-receipts-v3',
      expected_output_count: 3,
      target_plan: {
        groups: expect.arrayContaining([
          expect.objectContaining({ parent_asset_id: lineage.selectedId, width: 1080, height: 1920, variant_count: 1 }),
          expect.objectContaining({ parent_asset_id: lineage.otherId, width: 1200, height: 1500, variant_count: 2 }),
        ]),
      },
    });
  });

  it('plans and imports a re-roll output as a current attempt without adding a child edge', () => {
    const lineage = setupSelectedLineage('reroll');
    process.env.LINEAGE_CHANNEL = 'dev';
    const profileManifest = process.env.LINEAGE_PROFILE_MANIFEST!;
    const marked = markLineageRerollRequest(defaultProject, {
      rootAssetId: lineage.rootId,
      nodeAssetId: lineage.selectedId,
      notes: 'Fix text',
      requestedBy: 'human',
      confirmWrite: true,
    });
    const output = writeScratch('imports/reroll-output.png', 'reroll-output');

    const plan = planImageReroll(defaultProject, {
      targetAssetId: lineage.selectedId,
      rootAssetId: lineage.rootId,
      prompt: 'Regenerate the same image with readable headline text.',
    });
    expect(plan.job.source_mode).toBe('lineage_reroll');
    expect(plan.job.expected_output_count).toBe(1);
    expect(plan.job.inputs[0]).toMatchObject({ asset_id: lineage.selectedId, role: 'reroll_target' });
    expect(plan.job.handoff.import_command).toContain(`--profile '${profileManifest}'`);

    const beforeEdges = countRows('asset_edges');
    const imported = importImageRerollOutput(defaultProject, {
      jobId: plan.job.id,
      file: output,
      confirmWrite: true,
    });

    expect(imported.imported[0].parent_asset_id).toBe(lineage.selectedId);
    const snapshot = getLineageSnapshot(defaultProject, lineage.rootId);
    const node = snapshot.nodes.find(item => item.asset_id === lineage.selectedId);
    expect(countRows('asset_edges')).toBe(beforeEdges);
    expect(node?.attempt_count).toBe(2);
    expect(node?.current_attempt).toMatchObject({ asset_id: localId(output), source: 'reroll', attempt_index: 2 });
    expect(node?.review_state).toBe('unreviewed');
    expect(node?.reroll_request).toBeUndefined();
    expect(listLineageTasks(defaultProject, lineage.rootId).tasks.find(task => task.id === marked.task_id)).toBeUndefined();
    expect(listLineageTasks(defaultProject, lineage.rootId, ['resolved']).tasks.find(task => task.id === marked.task_id)).toMatchObject({
      resolved_asset_id: localId(output),
      resolved_generation_job_id: plan.job.id,
      status: 'resolved',
    });
    expect(snapshot.edges.some(edge => edge.parent_asset_id === lineage.selectedId && edge.child_asset_id === imported.imported[0].imported_asset_id)).toBe(false);
    const attempts = getLineageAttempts(defaultProject, lineage.rootId, lineage.selectedId).attempts;
    expect(attempts.filter(attempt => attempt.is_current).map(attempt => attempt.attempt_index)).toEqual([2]);
  });

  it('rejects re-roll import without --confirm-write before writing outputs or attempts', () => {
    const lineage = setupSelectedLineage('reroll-no-confirm');
    markLineageRerollRequest(defaultProject, { rootAssetId: lineage.rootId, nodeAssetId: lineage.selectedId, requestedBy: 'human', confirmWrite: true });
    const output = writeScratch('imports/reroll-no-confirm.png', 'reroll-no-confirm');
    const plan = planImageReroll(defaultProject, { rootAssetId: lineage.rootId, targetAssetId: lineage.selectedId, prompt: 'Fix text' });

    expect(() => importImageRerollOutput(defaultProject, { jobId: plan.job.id, file: output, confirmWrite: false })).toThrow('Generation import requires --confirm-write');
    expect(countRows('generation_job_outputs')).toBe(0);
    expect(countRows('asset_attempts')).toBe(0);
  });

  it('rejects re-roll import files outside .asset-scratch before writing outputs or attempts', () => {
    const lineage = setupSelectedLineage('reroll-outside');
    markLineageRerollRequest(defaultProject, { rootAssetId: lineage.rootId, nodeAssetId: lineage.selectedId, requestedBy: 'human', confirmWrite: true });
    const plan = planImageReroll(defaultProject, { rootAssetId: lineage.rootId, targetAssetId: lineage.selectedId, prompt: 'Fix text' });

    expect(() => importImageRerollOutput(defaultProject, { jobId: plan.job.id, file: resolve(repoRoot, 'package.json'), confirmWrite: true })).toThrow('Import file must be under .asset-scratch');
    expect(countRows('generation_job_outputs')).toBe(0);
    expect(countRows('asset_attempts')).toBe(0);
  });

  it('rejects missing or unknown explicit parent file mappings without output rows', () => {
    const lineage = setupSelectedLineage('bad-parent-files');
    updateSelectedAsset(defaultProject, { assetIds: [lineage.selectedId, lineage.otherId], confirmWrite: true, mode: 'replace', rootAssetId: lineage.rootId });
    const plan = planImageGeneration(defaultProject, { count: 4, fromLineageSelection: true, perBaseCount: 2, prompt: 'Create two explicit mapped variations for negative proof.' });
    markGenerationJobLegacy(plan.job.id);
    const output = writeScratch('imports/explicit-missing-a1.png', 'explicit-missing-a1');
    expect(() => importImageGenerationOutputs(defaultProject, { confirmWrite: true, jobId: plan.job.id, parentFiles: { [lineage.selectedId]: [output, output] } })).toThrow(`Missing generation parent mapping for ${lineage.otherId}`);
    expect(countRows('generation_job_outputs')).toBe(0);
    expect(() => importImageGenerationOutputs(defaultProject, { confirmWrite: true, jobId: plan.job.id, parentFiles: { [lineage.selectedId]: [output, output], 'local-unknown-parent': [output, output] } })).toThrow('Unknown generation parent mapping');
    expect(countRows('generation_job_outputs')).toBe(0);
  }); it('rejects import without --confirm-write without outputs or edges', () => {
    const lineage = setupSelectedLineage();
    const plan = planImageGeneration(defaultProject, {
      count: 1,
      fromLineageSelection: true,
      prompt: 'Create one output for confirm-write guardrail.',
    });
    const output = writeScratch('imports/demo-linkedin-generation-no-confirm.png', 'generation-no-confirm');

    expect(() => importImageGenerationOutputs(defaultProject, {
      confirmWrite: false,
      files: [output],
      jobId: plan.job.id,
    })).toThrow('requires --confirm-write');

    expect(countRows('generation_job_outputs')).toBe(0);
    expect(countRows('asset_edges', `where parent_asset_id = '${lineage.selectedId}'`)).toBe(0);
  });

  it('requires manifests for new jobs and rejects mixed manifest and legacy inputs before writes', () => {
    const lineage = setupSelectedLineage('manifest-required');
    const plan = planImageGeneration(defaultProject, {
      count: 1,
      fromLineageSelection: true,
      prompt: 'Create one manifest-required output.',
    });
    const output = writeScratch('imports/manifest-required.png', 'manifest-required');
    const manifest = outputManifest(plan.job, [output]);

    expect(() => importImageGenerationOutputs(defaultProject, {
      confirmWrite: true,
      files: [output],
      jobId: plan.job.id,
    })).toThrow('New generation jobs require --manifest');
    expect(() => importImageGenerationOutputs(defaultProject, {
      confirmWrite: true,
      files: [output],
      jobId: plan.job.id,
      manifest,
    })).toThrow('Use --manifest or legacy --files/--parent-files, not both');
    expect(countRows('generation_job_outputs')).toBe(0);
    expect(countRows('asset_edges', `where parent_asset_id = '${lineage.selectedId}' and child_asset_id = '${localId(output)}'`)).toBe(0);
  });

  it('rolls back a new output when its visible edge has conflicting summary provenance', () => {
    const lineage = setupSelectedLineage('manifest-edge-conflict');
    const plan = planImageGeneration(defaultProject, {
      count: 1,
      fromLineageSelection: true,
      prompt: 'Create one output that collides with a human-labeled edge.',
    });
    const output = writeScratch('imports/manifest-edge-conflict.png', 'manifest-edge-conflict');
    const outputAssetId = localId(output);
    indexLineageAssets(defaultProject);
    linkLineageAssets(defaultProject, {
      childAssetId: outputAssetId,
      confirmWrite: true,
      parentAssetId: lineage.selectedId,
      summary: 'Human label',
      summaryActor: 'human',
    });

    expect(() => importImageGenerationOutputs(defaultProject, {
      confirmWrite: true,
      jobId: plan.job.id,
      manifest: outputManifest(plan.job, [output], ['Agent label']),
    })).toThrow('different output, summary, or provenance');
    expect(inspectImageGeneration(defaultProject, plan.job.id).job).toMatchObject({ status: 'planned', outputs: [] });
    const database = lineageDb();
    try {
      expect(database.prepare(`
        select summary, summary_created_by, summary_updated_by from asset_edges
        where project_id = ? and parent_asset_id = ? and child_asset_id = ?
      `).get(defaultProject, lineage.selectedId, outputAssetId)).toMatchObject({
        summary: 'Human label',
        summary_created_by: 'human',
        summary_updated_by: 'human',
      });
    } finally {
      database.close();
    }
  });

  it('rejects missing import files without output rows', () => {
    setupSelectedLineage();
    const plan = planImageGeneration(defaultProject, {
      count: 1,
      fromLineageSelection: true,
      prompt: 'Create one output for missing-file guardrail.',
    });
    expect(() => importImageGenerationOutputs(defaultProject, {
      confirmWrite: true,
      jobId: plan.job.id,
      manifest: outputManifest(plan.job, ['imports/not-created.png']),
    })).toThrow('Missing import file');
    expect(countRows('generation_job_outputs')).toBe(0);
  });

  it('rejects files outside .asset-scratch without output rows', () => {
    setupSelectedLineage();
    const outside = resolve(repoRoot, 'generation-receipts-outside.png');
    const plan = planImageGeneration(defaultProject, {
      count: 1,
      fromLineageSelection: true,
      prompt: 'Create one output for outside-root guardrail.',
    });

    expect(() => importImageGenerationOutputs(defaultProject, {
      confirmWrite: true,
      jobId: plan.job.id,
      manifest: outputManifest(plan.job, [outside]),
    })).toThrow('under .asset-scratch');
    expect(countRows('generation_job_outputs')).toBe(0);
  });
  it('rejects .asset-scratch symlinks that resolve outside the scratch root', () => {
    setupSelectedLineage();
    const outsideDir = join(repoRoot, '.tmp-generation-receipts-outside');
    const outside = join(outsideDir, 'outside.png');
    const symlink = writeScratch('imports/link-placeholder.png', 'placeholder');
    rmSync(outsideDir, { recursive: true, force: true });
    rmSync(symlink, { force: true });
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(outside, 'outside-generation-output');
    symlinkSync(outside, symlink);
    const plan = planImageGeneration(defaultProject, {
      count: 1,
      fromLineageSelection: true,
      prompt: 'Create one output for symlink guardrail.',
    });

    try {
      expect(() => importImageGenerationOutputs(defaultProject, {
        confirmWrite: true,
        jobId: plan.job.id,
        manifest: outputManifest(plan.job, [symlink]),
      })).toThrow('under .asset-scratch');
      expect(countRows('generation_job_outputs')).toBe(0);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('rejects output count mismatch without output rows', () => {
    setupSelectedLineage();
    const plan = planImageGeneration(defaultProject, {
      count: 2,
      fromLineageSelection: true,
      prompt: 'Create two outputs for count guardrail.',
    });
    const output = writeScratch('imports/demo-linkedin-generation-only-one.png', 'generation-only-one');

    expect(() => importImageGenerationOutputs(defaultProject, {
      confirmWrite: true,
      jobId: plan.job.id,
      manifest: outputManifest(plan.job, [output]),
    })).toThrow('requires 2 outputs, received 1');
    expect(countRows('generation_job_outputs')).toBe(0);
  });

  it('can reject an invalid edge-summary manifest before output indexing or import writes', () => {
    setupSelectedLineage('invalid-edge-summary-manifest');
    const plan = planImageGeneration(defaultProject, {
      count: 1,
      fromLineageSelection: true,
      prompt: 'Create one output for edge-summary manifest validation.',
    });
    const output = writeScratch('imports/invalid-edge-summary-manifest.png', 'invalid-edge-summary-manifest');
    const outputAssetId = localId(output);

    const manifest = outputManifest(plan.job, [output], ['Far too many words']);
    expect(() => importImageGenerationOutputs(defaultProject, {
      confirmWrite: true,
      jobId: plan.job.id,
      manifest,
    })).toThrow('Edge summary must contain at most 2 words');

    expect(countRows('assets', `where id = '${outputAssetId}'`)).toBe(0);
    expect(countRows('generation_job_outputs')).toBe(0);
    expect(countRows('asset_edges', `where child_asset_id = '${outputAssetId}'`)).toBe(0);
    expect(inspectImageGeneration(defaultProject, plan.job.id).job.status).toBe('planned');
  });

  it('makes exact manifest retries idempotent and summary or provenance divergence explicit', () => {
    const lineage = setupSelectedLineage('manifest-retry');
    const plan = planImageGeneration(defaultProject, {
      count: 1,
      fromLineageSelection: true,
      prompt: 'Create one output for exact manifest retries.',
    });
    const output = writeScratch('imports/manifest-retry.png', 'manifest-retry');
    const manifest = outputManifest(plan.job, [output], ['Cleaner type']);
    const imported = importImageGenerationOutputs(defaultProject, { confirmWrite: true, jobId: plan.job.id, manifest });
    const retried = importImageGenerationOutputs(defaultProject, { confirmWrite: true, jobId: plan.job.id, manifest });

    expect(retried).toMatchObject({ idempotent: true, imported: [{ edge_summary: 'Cleaner type' }] });
    expect(retried.job.receipts.map(receipt => receipt.receipt_type)).toEqual(['plan', 'import']);
    expect(retried.imported).toEqual(imported.imported);

    expect(() => importImageGenerationOutputs(defaultProject, {
      confirmWrite: true,
      jobId: plan.job.id,
      manifest: outputManifest(plan.job, [output], ['Warmer light']),
    })).toThrow('different output, summary, or provenance');

    const database = lineageDb();
    try {
      database.prepare(`
        update asset_edges set summary_updated_by = 'human'
        where project_id = ? and parent_asset_id = ? and child_asset_id = ?
      `).run(defaultProject, lineage.selectedId, imported.imported[0].imported_asset_id);
    } finally {
      database.close();
    }
    expect(() => importImageGenerationOutputs(defaultProject, { confirmWrite: true, jobId: plan.job.id, manifest }))
      .toThrow('different output, summary, or provenance');
    expect(inspectImageGeneration(defaultProject, plan.job.id).job.outputs).toEqual(imported.imported);
  });

  it('characterizes the import rollback boundary when edge insertion fails', () => {
    const lineage = setupSelectedLineage('edge-insert-rollback');
    const plan = planImageGeneration(defaultProject, {
      count: 1,
      fromLineageSelection: true,
      prompt: 'Create one output for transaction rollback characterization.',
    });
    const output = writeScratch('imports/edge-insert-rollback.png', 'edge-insert-rollback');
    const outputAssetId = localId(output);
    const database = lineageDb();
    try {
      database.exec(`
        create trigger generation_edge_summary_experiment_abort
        before insert on asset_edges
        begin
          select raise(abort, 'edge-summary experiment abort');
        end;
      `);
    } finally {
      database.close();
    }

    expect(() => importImageGenerationOutputs(defaultProject, {
      confirmWrite: true,
      jobId: plan.job.id,
      manifest: outputManifest(plan.job, [output], ['Sharper type']),
    })).toThrow('edge-summary experiment abort');

    const inspected = inspectImageGeneration(defaultProject, plan.job.id).job;
    expect(inspected.status).toBe('planned');
    expect(inspected.outputs).toEqual([]);
    expect(inspected.receipts.map(receipt => receipt.receipt_type)).toEqual(['plan']);
    expect(countRows('asset_edges', `where parent_asset_id = '${lineage.selectedId}' and child_asset_id = '${outputAssetId}'`)).toBe(0);
    expect(countRows('assets', `where id = '${outputAssetId}'`)).toBe(1);
  });

  it('persists an immutable target-aware plan with its aggregate receipt', () => {
    const lineage = setupSelectedLineage('target-aware-plan');
    const plan = planImageGeneration(defaultProject, {
      fromLineageSelection: true,
      prompt: 'Create locked story variants.',
      targetMap: {
        schema_version: GENERATION_TARGET_MAP_SCHEMA,
        sources: [{
          asset_id: lineage.selectedId,
          default_variant_count: 2,
          targets: [
            { kind: 'delivery_surface', surface_id: 'instagram.story', surface_version: 1 },
            { kind: 'delivery_surface', surface_id: 'facebook.story', surface_version: 1 },
          ],
        }],
      },
    });
    expect(plan.job).toMatchObject({
      adapter_version: 'generation-receipts-v3',
      expected_output_count: 2,
      handoff: {
        schema_version: 'lineage.generation_handoff.v3',
        output_manifest: { schema_version: 'lineage.generation_output_manifest.v2' },
        target_resolution: {
          map: { schema_version: 'lineage.generation_target_map.v1' },
          groups: [{ width: 1080, height: 1920, variant_count: 2 }],
        },
      },
      target_plan: {
        groups: [{ width: 1080, height: 1920, variant_count: 2 }],
        slots: [{ output_index: 0 }, { output_index: 1 }],
      },
    });
    expect(plan.job.receipts[0].payload).toMatchObject({
      target_map_digest: plan.job.target_plan?.digest_sha256,
    });
    const inspected = inspectImageGeneration(defaultProject, plan.job.id).job;
    expect(inspected.target_plan).toEqual(plan.job.target_plan);
    expect(countRows('generation_target_maps', `where job_id = '${plan.job.id}'`)).toBe(1);
    expect(countRows('generation_target_groups', `where job_id = '${plan.job.id}'`)).toBe(1);
    expect(countRows('generation_output_slots', `where job_id = '${plan.job.id}'`)).toBe(2);
    expect(plan.job.handoff.output_manifest?.outputs[0]).toMatchObject({
      output_spec: { schema_version: 'lineage.output_spec.v1', width: 1080, height: 1920 },
    });
    expect(() => planImageGeneration(defaultProject, {
      count: 2,
      fromLineageSelection: true,
      prompt: 'Do not accept a legacy count for a locked plan.',
      targetMap: plan.job.target_plan?.map,
      })).toThrow('does not accept legacy --count');
  });

  it('atomically imports byte-decoded PNG, JPEG, and WebP at exact locked pixels', async () => {
    const lineage = setupSelectedLineage('locked-formats');
    const plan = planImageGeneration(defaultProject, {
      fromLineageSelection: true,
      prompt: 'Create exact locked raster formats.',
      targetMap: {
        schema_version: GENERATION_TARGET_MAP_SCHEMA,
        sources: [{
          asset_id: lineage.selectedId,
          default_variant_count: 3,
          targets: [{ kind: 'custom', width: 23, height: 19 }],
        }],
      },
    });
    const files = await Promise.all([
      writeRaster('imports/locked-format-png.bin', 23, 19, 'png'),
      writeRaster('imports/locked-format-jpeg.bin', 23, 19, 'jpeg'),
      writeRaster('imports/locked-format-webp.bin', 23, 19, 'webp'),
    ]);

    const imported = importImageGenerationOutputs(defaultProject, {
      confirmWrite: true,
      jobId: plan.job.id,
      manifest: outputManifest(plan.job, files),
    });

    expect(imported.imported).toHaveLength(3);
    expect(countRows('asset_output_specs', `where generation_job_id = '${plan.job.id}'`)).toBe(3);
    const database = lineageDb();
    try {
      const rows = database.prepare(`
        select actual_width, actual_height, output_spec_json
        from asset_output_specs where generation_job_id = ? order by output_index
      `).all(plan.job.id) as Array<{ actual_height: number; actual_width: number; output_spec_json: string }>;
      expect(rows.map(row => [row.actual_width, row.actual_height])).toEqual([[23, 19], [23, 19], [23, 19]]);
      expect(rows.every(row => JSON.parse(row.output_spec_json).width === 23)).toBe(true);
    } finally {
      database.close();
    }
  });

  it('preflights the complete locked batch before every persistent effect', async () => {
    const lineage = setupSelectedLineage('locked-atomic');
    const plan = planImageGeneration(defaultProject, {
      fromLineageSelection: true,
      prompt: 'Reject the whole batch if one file is wrong.',
      targetMap: {
        schema_version: GENERATION_TARGET_MAP_SCHEMA,
        sources: [{
          asset_id: lineage.selectedId,
          default_variant_count: 2,
          targets: [{ kind: 'custom', width: 23, height: 19 }],
        }],
      },
    });
    const valid = await writeRaster('imports/locked-atomic-valid.png', 23, 19);
    const wrong = await writeRaster('imports/locked-atomic-wrong.png', 24, 19);
    const validId = localId(valid);
    const wrongId = localId(wrong);

    expect(() => importImageGenerationOutputs(defaultProject, {
      confirmWrite: true,
      jobId: plan.job.id,
      manifest: outputManifest(plan.job, [valid, wrong]),
    })).toThrow(/requires 23x19 pixels, decoded 24x19/);

    expect(inspectImageGeneration(defaultProject, plan.job.id).job).toMatchObject({ status: 'planned', outputs: [] });
    expect(countRows('assets', `where id in ('${validId}', '${wrongId}')`)).toBe(0);
    expect(countRows('asset_edges', `where child_asset_id in ('${validId}', '${wrongId}')`)).toBe(0);
    expect(countRows('asset_output_specs', `where generation_job_id = '${plan.job.id}'`)).toBe(0);
    expect(getLineageSnapshot(defaultProject, lineage.rootId).selected).toEqual([lineage.selectedId]);
  });

  it('rolls back target-aware indexing when a late persistent effect fails', async () => {
    const lineage = setupSelectedLineage('locked-rollback');
    const plan = planImageGeneration(defaultProject, {
      fromLineageSelection: true,
      prompt: 'Prove the target-aware transaction rolls back.',
      targetMap: {
        schema_version: GENERATION_TARGET_MAP_SCHEMA,
        sources: [{ asset_id: lineage.selectedId, targets: [{ kind: 'custom', width: 23, height: 19 }] }],
      },
    });
    const output = await writeRaster('imports/locked-rollback.png', 23, 19);
    const outputAssetId = localId(output);
    const database = lineageDb();
    try {
      database.exec(`
        create trigger locked_output_spec_abort
        before insert on asset_output_specs
        begin
          select raise(abort, 'locked-output-spec abort');
        end;
      `);
    } finally {
      database.close();
    }

    expect(() => importImageGenerationOutputs(defaultProject, {
      confirmWrite: true,
      jobId: plan.job.id,
      manifest: outputManifest(plan.job, [output]),
    })).toThrow('locked-output-spec abort');

    expect(countRows('assets', `where id = '${outputAssetId}'`)).toBe(0);
    expect(countRows('asset_edges', `where child_asset_id = '${outputAssetId}'`)).toBe(0);
    expect(countRows('generation_job_outputs', `where job_id = '${plan.job.id}'`)).toBe(0);
    expect(inspectImageGeneration(defaultProject, plan.job.id).job.status).toBe('planned');
  });

  it('keeps locked imports idempotent and rejects divergent retries', async () => {
    const lineage = setupSelectedLineage('locked-retry');
    const plan = planImageGeneration(defaultProject, {
      fromLineageSelection: true,
      prompt: 'Import one locked output exactly once.',
      targetMap: {
        schema_version: GENERATION_TARGET_MAP_SCHEMA,
        sources: [{ asset_id: lineage.selectedId, targets: [{ kind: 'custom', width: 23, height: 19 }] }],
      },
    });
    const output = await writeRaster('imports/locked-retry.png', 23, 19);
    const manifest = outputManifest(plan.job, [output], ['Exact lock']);
    importImageGenerationOutputs(defaultProject, { confirmWrite: true, jobId: plan.job.id, manifest });

    expect(importImageGenerationOutputs(defaultProject, {
      confirmWrite: true,
      jobId: plan.job.id,
      manifest,
    }).idempotent).toBe(true);

    const divergent = await writeRaster('imports/locked-retry-divergent.png', 23, 19, 'webp');
    expect(() => importImageGenerationOutputs(defaultProject, {
      confirmWrite: true,
      jobId: plan.job.id,
      manifest: outputManifest(plan.job, [divergent], ['Exact lock']),
    })).toThrow(/already exists with different output/);
  });

  it('inherits immutable reroll locks and routes geometry changes to child variations', async () => {
    const lineage = setupSelectedLineage('locked-reroll');
    const originalPlan = planImageGeneration(defaultProject, {
      fromLineageSelection: true,
      prompt: 'Create the locked node.',
      targetMap: {
        schema_version: GENERATION_TARGET_MAP_SCHEMA,
        sources: [{ asset_id: lineage.selectedId, targets: [{ kind: 'custom', width: 23, height: 19 }] }],
      },
    });
    const original = await writeRaster('imports/locked-reroll-original.png', 23, 19);
    const imported = importImageGenerationOutputs(defaultProject, {
      confirmWrite: true,
      jobId: originalPlan.job.id,
      manifest: outputManifest(originalPlan.job, [original]),
    });
    const lockedNodeId = imported.imported[0].imported_asset_id;
    updateSelectedAsset(defaultProject, {
      assetId: lockedNodeId,
      confirmWrite: true,
      rootAssetId: lineage.rootId,
    });
    const selectionPacket = getLineageSelectionPacket(defaultProject, { rootAssetId: lineage.rootId });
    expect(selectionPacket.assets[0].dimensions).toEqual({ height: 19, width: 23 });
    expect(selectionPacket.warnings).not.toContain('Image dimensions are unavailable for one or more selected assets.');
    markLineageRerollRequest(defaultProject, {
      confirmWrite: true,
      nodeAssetId: lockedNodeId,
      rootAssetId: lineage.rootId,
    });

    const reroll = planImageReroll(defaultProject, {
      prompt: 'Try another treatment without changing geometry.',
      rootAssetId: lineage.rootId,
      targetAssetId: lockedNodeId,
    });
    expect(reroll.job).toMatchObject({
      adapter_version: 'generation-receipts-v3',
      source_mode: 'lineage_reroll',
      target_plan: { slots: [{ output_spec: { height: 19, width: 23 } }] },
    });
    const wrong = await writeRaster('imports/locked-reroll-wrong.png', 24, 19);
    expect(() => importImageRerollOutput(defaultProject, {
      confirmWrite: true,
      file: wrong,
      jobId: reroll.job.id,
    })).toThrow(/cannot mutate locked node.*23x19 to 24x19/);
    expect(inspectImageGeneration(defaultProject, reroll.job.id).job.status).toBe('planned');
    expect(getLineageAttempts(defaultProject, lineage.rootId, lockedNodeId).attempts).toHaveLength(1);

    const variation = planImageReroll(defaultProject, {
      prompt: 'Create a wider child instead.',
      requestedDimensions: { height: 19, width: 24 },
      rootAssetId: lineage.rootId,
      targetAssetId: lockedNodeId,
    });
    expect(variation).toMatchObject({
      command: 'generate image plan',
      job: {
        source_mode: 'lineage_selection',
        target_plan: { slots: [{ output_spec: { height: 19, width: 24 } }] },
      },
    });
    const correct = await writeRaster('imports/locked-reroll-correct.webp', 23, 19, 'webp');
    const rerolled = importImageRerollOutput(defaultProject, {
      confirmWrite: true,
      file: correct,
      jobId: reroll.job.id,
    });
    expect(rerolled.job.status).toBe('imported');
    expect(getLineageAttempts(defaultProject, lineage.rootId, lockedNodeId).attempts).toHaveLength(2);
    expect(importImageRerollOutput(defaultProject, {
      confirmWrite: true,
      file: correct,
      jobId: reroll.job.id,
    }).idempotent).toBe(true);
    const database = lineageDb();
    try {
      const frozen = database.prepare('select output_spec_json from asset_output_specs where asset_id = ?').get(lockedNodeId) as { output_spec_json: string };
      expect(JSON.parse(frozen.output_spec_json)).toMatchObject({ height: 19, width: 23 });
    } finally {
      database.close();
    }
  });
});
