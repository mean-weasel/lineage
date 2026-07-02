import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultProject, repoRoot } from './assetCore';
import { indexLineageAssets, linkLineageAssets, updateSelectedAsset } from './assetLineage';
import { lineageDb } from './assetLineageDb';
import { createLineageWorkspace } from './assetLineageWorkspaces';
import {
  importImageGenerationOutputs,
  inspectImageGeneration,
  planImageGeneration,
} from './generationReceipts';
import { listImageGenerationJobs } from './generationReceiptJobs';
import { fileSha256 } from './localReview';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-generation-receipts');
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

function setupSelectedLineage(prefix = 'generation') {
  const root = writeScratch(`bleep-linkedin-${prefix}-root.png`, `${prefix}-root-${Date.now()}`);
  const selected = writeScratch(`bleep-linkedin-${prefix}-selected.png`, `${prefix}-selected-${Date.now()}`);
  const other = writeScratch(`bleep-linkedin-${prefix}-other.png`, `${prefix}-other-${Date.now()}`);
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
  const root = writeScratch('bleep-linkedin-generation-unselected-root.png', `generation-unselected-root-${Date.now()}`);
  const childA = writeScratch('bleep-linkedin-generation-unselected-a.png', `generation-unselected-a-${Date.now()}`);
  const childB = writeScratch('bleep-linkedin-generation-unselected-b.png', `generation-unselected-b-${Date.now()}`);
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

describe('generation receipts', () => {
  beforeEach(() => {
    rmSync(scratchDir, { recursive: true, force: true });
    mkdirSync(scratchDir, { recursive: true });
    process.env.ASSET_STUDIO_DB = dbFile;
  });

  it('plans, inspects, and imports local generation outputs as lineage children', () => {
    const lineage = setupSelectedLineage();
    const plan = planImageGeneration(defaultProject, {
      count: 2,
      fromLineageSelection: true,
      prompt: 'Create two cleaner image variations from the selected base.',
    });

    expect(plan.job.status).toBe('planned');
    expect(plan.job.inputs).toHaveLength(1);
    expect(plan.job.inputs[0]).toMatchObject({ asset_id: lineage.selectedId, role: 'lineage_next_base' });
    expect(plan.job.handoff.provider).toBe('codex-handoff');
    expect(plan.job.receipts[0]).toMatchObject({ receipt_type: 'plan', status: 'ok' });

    const inspected = inspectImageGeneration(defaultProject, plan.job.id);
    expect(inspected.job.prompt).toContain('cleaner image variations');
    expect(inspected.job.receipts).toHaveLength(1);

    const firstOutput = writeScratch('imports/bleep-linkedin-generation-output-a.png', 'generation-output-a');
    const secondOutput = writeScratch('imports/bleep-linkedin-generation-output-b.png', 'generation-output-b');
    const imported = importImageGenerationOutputs(defaultProject, {
      confirmWrite: true,
      files: [firstOutput, secondOutput],
      jobId: plan.job.id,
    });

    expect(imported.job.status).toBe('imported');
    expect(imported.imported.map(output => output.parent_asset_id)).toEqual([lineage.selectedId, lineage.selectedId]);
    expect(imported.imported.map(output => output.imported_asset_id)).toEqual([localId(firstOutput), localId(secondOutput)]);
    expect(imported.job.receipts.map(receipt => receipt.receipt_type)).toEqual(['plan', 'import']);

    const database = lineageDb();
    try {
      const edges = database.prepare(`
        select child_asset_id from asset_edges
        where project_id = ? and parent_asset_id = ?
        order by child_asset_id
      `).all(defaultProject, lineage.selectedId) as Array<{ child_asset_id: string }>;
      expect(edges.map(edge => edge.child_asset_id).sort()).toEqual([localId(firstOutput), localId(secondOutput)].sort());
    } finally {
      database.close();
    }
  });

  it('lists generation jobs by root and asset involvement for UX proof', () => {
    const lineage = setupSelectedLineage('generation-list');
    const plan = planImageGeneration(defaultProject, { count: 1, fromLineageSelection: true, prompt: 'Create one proof-list output.' });
    const output = writeScratch('imports/bleep-linkedin-generation-listed-output.png', 'generation-listed-output');
    const imported = importImageGenerationOutputs(defaultProject, { confirmWrite: true, files: [output], jobId: plan.job.id });
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
    expect(plan.job.handoff.import_command).toContain('--parent-files');
    expect(plan.job.receipts[0].payload).toMatchObject({
      expected_output_count: 4,
      per_base_count: 2,
      parent_mappings: [{ parent_asset_id: lineage.selectedId, output_indexes: [0, 1] }, { parent_asset_id: lineage.otherId, output_indexes: [2, 3] }],
    });
    const files = ['multi-a1', 'multi-a2', 'multi-b1', 'multi-b2'].map(name => writeScratch(`imports/${name}.png`, name));
    const imported = importImageGenerationOutputs(defaultProject, { confirmWrite: true, files, jobId: plan.job.id });
    expect(imported.imported.map(output => output.parent_asset_id)).toEqual([lineage.selectedId, lineage.selectedId, lineage.otherId, lineage.otherId]);
    const importReceipt = imported.job.receipts.find(receipt => receipt.receipt_type === 'import');
    expect(importReceipt?.payload).toMatchObject({
      mapping_strategy: 'ordered_per_base',
      files: [0, 1, 2, 3].map(output_index => ({ output_index, parent_asset_id: output_index < 2 ? lineage.selectedId : lineage.otherId })),
    });
  }); it('imports explicit parent-keyed files for multi-selected lineage bases', () => {
    const lineage = setupSelectedLineage('explicit-parent-files');
    updateSelectedAsset(defaultProject, { assetIds: [lineage.selectedId, lineage.otherId], confirmWrite: true, mode: 'replace', rootAssetId: lineage.rootId });
    const plan = planImageGeneration(defaultProject, { count: 4, fromLineageSelection: true, perBaseCount: 2, prompt: 'Create two explicit mapped variations from each selected base.' });
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
  });

  it('rejects missing or unknown explicit parent file mappings without output rows', () => {
    const lineage = setupSelectedLineage('bad-parent-files');
    updateSelectedAsset(defaultProject, { assetIds: [lineage.selectedId, lineage.otherId], confirmWrite: true, mode: 'replace', rootAssetId: lineage.rootId });
    const plan = planImageGeneration(defaultProject, { count: 4, fromLineageSelection: true, perBaseCount: 2, prompt: 'Create two explicit mapped variations for negative proof.' });
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
    const output = writeScratch('imports/bleep-linkedin-generation-no-confirm.png', 'generation-no-confirm');

    expect(() => importImageGenerationOutputs(defaultProject, {
      confirmWrite: false,
      files: [output],
      jobId: plan.job.id,
    })).toThrow('requires --confirm-write');

    expect(countRows('generation_job_outputs')).toBe(0);
    expect(countRows('asset_edges', `where parent_asset_id = '${lineage.selectedId}'`)).toBe(0);
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
      files: ['imports/not-created.png'],
      jobId: plan.job.id,
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
      files: [outside],
      jobId: plan.job.id,
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
        files: [symlink],
        jobId: plan.job.id,
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
    const output = writeScratch('imports/bleep-linkedin-generation-only-one.png', 'generation-only-one');

    expect(() => importImageGenerationOutputs(defaultProject, {
      confirmWrite: true,
      files: [output],
      jobId: plan.job.id,
    })).toThrow('Output count mismatch');
    expect(countRows('generation_job_outputs')).toBe(0);
  });
});
