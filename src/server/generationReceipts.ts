import { existsSync, realpathSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultProject, repoRoot } from './assetCore';
import { getLineageNextAsset, getLineageSnapshot, indexLineageAssets, listLineageRerollRequests, recordLineageRerollAttempt } from './assetLineage';
import { lineageDb, nowIso, type DatabaseSync } from './assetLineageDb';
import { cancelLineageIterateTasksForAssets, listLineageTasks, resolveLineageTask } from './assetLineageTasks';
import { activeLineageWorkspaceRoot } from './assetLineageWorkspaces';
import { contentTypeFor, fileSha256 } from './localReview';
import { lineagePublicPackageCommand, lineageRuntimeSelector } from './lineageRuntimeCommand';
import type {
  GenerationHandoffPacket,
  GenerationImportResponse,
  GenerationInspectResponse,
  GenerationJob,
  GenerationJobInput,
  GenerationJobOutput,
  GenerationJobReceipt,
  GenerationPlanResponse,
  GenerationProvider,
  GenerationSourceMode,
  LineageNextResponse,
  LineageRerollRequest,
} from '../shared/types';

const adapterVersion = 'generation-receipts-v1';
const provider: GenerationProvider = 'codex-handoff';

class GenerationReceiptError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function isGenerationReceiptError(error: unknown): error is GenerationReceiptError {
  return error instanceof GenerationReceiptError;
}

function jobId(): string {
  return `gen-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  return JSON.parse(value) as T;
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function resolveLineageSelection(project: string): LineageNextResponse {
  const rootAssetId = activeLineageWorkspaceRoot(project);
  if (!rootAssetId) throw new GenerationReceiptError('No active lineage workspace for generation planning');
  const next = getLineageNextAsset(project, rootAssetId);
  if (!next.next_asset) throw new GenerationReceiptError(`No clear lineage next asset: ${next.reason}`);
  if (next.strategy !== 'selected') throw new GenerationReceiptError('Generation v1 requires an explicit selected lineage next base');
  if (next.selection_mode !== 'multiple' && next.selection?.asset_id !== next.next_asset.asset_id) throw new GenerationReceiptError('Generation v1 requires one explicit selected lineage next base');
  return next;
}

function selectedParents(next: LineageNextResponse) {
  const parents = next.next_assets.length > 0 ? next.next_assets : next.next_asset ? [next.next_asset] : [];
  if (parents.length === 0) throw new GenerationReceiptError('Missing lineage next base');
  return parents;
}

function parentMappings(next: LineageNextResponse, perBaseCount: number) {
  return selectedParents(next).map((parent, parentIndex) => ({
    parent,
    output_indexes: Array.from({ length: perBaseCount }, (_value, index) => parentIndex * perBaseCount + index),
  }));
}

function buildHandoff(project: string, id: string, prompt: string, count: number, perBaseCount: number, next: LineageNextResponse): GenerationHandoffPacket {
  const parent = next.next_asset;
  if (!parent) throw new GenerationReceiptError('Missing lineage next base');
  const parents = parentMappings(next, perBaseCount);
  const importFilesFlag = parents.length > 1
    ? `--parent-files ${quote(parents.map(mapping => `${mapping.parent.asset_id}=<${mapping.output_indexes.map(index => `file-${index}`).join(',')}>`).join(';'))}`
    : '--files <comma-separated-.asset-scratch-files>';
  const importCommand = `${lineagePublicPackageCommand()} generate image import --project ${quote(project)} --job-id ${quote(id)} ${importFilesFlag} --confirm-write ${lineageRuntimeSelector()} --json`;
  return {
    schema_version: 'lineage.generation_handoff.v1', provider, project, job_id: id, prompt, expected_output_count: count,
    per_base_count: next.selection_mode === 'multiple' ? perBaseCount : undefined,
    lineage: {
      root_asset_id: next.root_asset_id, parent_asset_id: parent.asset_id, selection_strategy: next.strategy,
      parent_title: parent.title, parent_local_path: parent.local_path, parent_s3_key: parent.s3_key,
      parents: parents.length > 1 ? parents.map(mapping => ({
        parent_asset_id: mapping.parent.asset_id, parent_title: mapping.parent.title,
        parent_local_path: mapping.parent.local_path, parent_s3_key: mapping.parent.s3_key, output_indexes: mapping.output_indexes,
      })) : undefined,
    },
    instructions: [
      'Use Codex image generation outside Lineage server code.',
      'Write generated output files under .asset-scratch before import.',
      'Do not call live provider APIs from the CLI or server.',
      'Import the exact expected output count with --confirm-write to persist lineage children.',
      'For multiple selected bases, prefer --parent-files so each generated file is tied to its selected parent.',
    ],
    import_command: importCommand,
    guardrails: { live_generation: false, external_services: false, output_root: '.asset-scratch', confirm_write_required: true },
  };
}

function buildRerollHandoff(project: string, id: string, prompt: string, rootAssetId: string, target: { asset_id: string; title: string; local_path?: string; s3_key?: string }, request: LineageRerollRequest): GenerationHandoffPacket {
  const importCommand = `${lineagePublicPackageCommand()} reroll import --project ${quote(project)} --job-id ${quote(id)} --file <.asset-scratch-file> --confirm-write ${lineageRuntimeSelector()} --json`;
  return {
    schema_version: 'lineage.generation_handoff.v1',
    provider,
    project,
    job_id: id,
    prompt,
    expected_output_count: 1,
    lineage: {
      root_asset_id: rootAssetId,
      parent_asset_id: target.asset_id,
      selection_strategy: 'reroll_request',
      parent_title: target.title,
      parent_local_path: target.local_path,
      parent_s3_key: target.s3_key,
    },
    instructions: [
      'Use Codex image generation outside Lineage server code.',
      'Write the regenerated output file under .asset-scratch before import.',
      'Do not call live provider APIs from the CLI or server.',
      'Import exactly one output with reroll import, not link-child or generate image import.',
      `Resolve re-roll request ${request.id}; do not create a visible lineage child edge.`,
    ],
    import_command: importCommand,
    guardrails: { live_generation: false, external_services: false, output_root: '.asset-scratch', confirm_write_required: true },
  };
}

function inputsFrom(jobIdValue: string, project: string, next: LineageNextResponse): GenerationJobInput[] {
  return selectedParents(next).map((parent, position) => ({
    id: `${jobIdValue}:input:${position}`,
    job_id: jobIdValue,
    project_id: project,
    asset_id: parent.asset_id,
    root_asset_id: next.root_asset_id,
    role: 'lineage_next_base',
    position,
    selection_strategy: next.strategy,
    selection_snapshot: next,
  }));
}

function receiptFrom(row: Record<string, unknown>): GenerationJobReceipt {
  return {
    id: String(row.id),
    job_id: String(row.job_id),
    receipt_type: row.receipt_type as GenerationJobReceipt['receipt_type'],
    status: row.status as GenerationJobReceipt['status'],
    command: String(row.command),
    payload: parseJson(String(row.payload_json), null),
    created_at: String(row.created_at),
  };
}

function outputFrom(row: Record<string, unknown>): GenerationJobOutput {
  const edgeSummary = typeof row.edge_summary === 'string' && row.edge_summary.length > 0 ? row.edge_summary : undefined;
  return {
    id: String(row.id),
    job_id: String(row.job_id),
    project_id: String(row.project_id),
    output_index: Number(row.output_index),
    file_path: String(row.file_path),
    checksum_sha256: String(row.checksum_sha256),
    size_bytes: Number(row.size_bytes),
    content_type: String(row.content_type),
    imported_asset_id: String(row.imported_asset_id),
    parent_asset_id: String(row.parent_asset_id),
    imported_at: String(row.imported_at),
    ...(edgeSummary ? { edge_summary: edgeSummary } : {}),
  };
}

export function loadGenerationJob(database: DatabaseSync, project: string, id: string): GenerationJob {
  const row = database.prepare('select * from generation_jobs where project_id = ? and id = ?').get(project, id) as Record<string, unknown> | undefined;
  if (!row) throw new GenerationReceiptError(`Unknown generation job: ${id}`, 404);
  const inputRows = database.prepare('select * from generation_job_inputs where job_id = ? order by position').all(id) as Array<Record<string, unknown>>;
  const inputs = inputRows.map(input => ({
    id: String(input.id),
    job_id: String(input.job_id),
    project_id: String(input.project_id),
    asset_id: String(input.asset_id),
    root_asset_id: String(input.root_asset_id),
    role: input.role as GenerationJobInput['role'],
    position: Number(input.position),
    selection_strategy: String(input.selection_strategy),
    selection_snapshot: parseJson<LineageNextResponse>(String(input.selection_snapshot_json), {} as LineageNextResponse),
  }));
  const outputs = (database.prepare('select * from generation_job_outputs where job_id = ? order by output_index').all(id) as Array<Record<string, unknown>>).map(outputFrom);
  const receipts = (database.prepare('select * from generation_job_receipts where job_id = ? order by created_at, id').all(id) as Array<Record<string, unknown>>).map(receiptFrom);
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    provider: row.provider as GenerationProvider,
    adapter_version: String(row.adapter_version),
    source_mode: String(row.source_mode) as GenerationSourceMode,
    root_asset_id: String(row.root_asset_id),
    prompt: String(row.prompt),
    expected_output_count: Number(row.expected_output_count),
    status: row.status as GenerationJob['status'],
    output_dir: typeof row.output_dir === 'string' ? row.output_dir : undefined,
    handoff: parseJson<GenerationHandoffPacket>(String(row.handoff_json), {} as GenerationHandoffPacket),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    imported_at: typeof row.imported_at === 'string' ? row.imported_at : undefined,
    inputs,
    outputs,
    receipts,
  };
}

function insertReceipt(database: DatabaseSync, id: string, type: 'plan' | 'import' | 'error', command: string, payload: unknown): void {
  database.prepare(`
    insert into generation_job_receipts (id, job_id, receipt_type, status, command, payload_json, created_at)
    values (?, ?, ?, 'ok', ?, ?, ?)
  `).run(`${id}:receipt:${type}:${Date.now()}`, id, type, command, JSON.stringify(payload), nowIso());
}

export function planImageGeneration(project = defaultProject, fields: { prompt: string; count?: number; dryRun?: boolean; fromLineageSelection: boolean; perBaseCount?: number }): GenerationPlanResponse {
  const prompt = fields.prompt.trim();
  if (!prompt) throw new GenerationReceiptError('Missing --prompt');
  if (!fields.fromLineageSelection) throw new GenerationReceiptError('Generation v1 requires --from-lineage-selection');
  const next = resolveLineageSelection(project);
  const parentCount = selectedParents(next).length;
  if (parentCount > 1 && !positiveInteger(fields.perBaseCount)) throw new GenerationReceiptError('Multi-parent generation requires --per-base-count');
  const perBaseCount = parentCount > 1 ? Number(fields.perBaseCount) : Number(fields.count ?? fields.perBaseCount);
  const count = parentCount * perBaseCount;
  if (!positiveInteger(perBaseCount)) throw new GenerationReceiptError('Generation count must be a positive integer');
  if (fields.count !== undefined && fields.count !== count) throw new GenerationReceiptError(`Generation count mismatch: expected ${count} from selected bases, received ${fields.count}`);
  const id = jobId();
  const handoff = buildHandoff(project, id, prompt, count, perBaseCount, next);
  const inputs = inputsFrom(id, project, next);
  const mappings = parentMappings(next, perBaseCount).map(mapping => ({ parent_asset_id: mapping.parent.asset_id, output_indexes: mapping.output_indexes }));
  const timestamp = nowIso();
  const preview: GenerationJob = {
    id,
    project_id: project,
    provider,
    adapter_version: adapterVersion,
    source_mode: 'lineage_selection',
    root_asset_id: next.root_asset_id,
    prompt,
    expected_output_count: count,
    status: 'planned',
    output_dir: '.asset-scratch',
    handoff,
    created_at: timestamp,
    updated_at: timestamp,
    inputs,
    outputs: [],
    receipts: [{
      id: `${id}:receipt:plan:preview`,
      job_id: id,
      receipt_type: 'plan',
      status: 'ok',
      command: 'generate image plan',
      payload: { prompt, expected_output_count: count, per_base_count: parentCount > 1 ? perBaseCount : undefined, lineage: handoff.lineage, parent_mappings: mappings },
      created_at: timestamp,
    }],
  };
  if (fields.dryRun) return { ok: true, command: 'generate image plan', project, dryRun: true, wouldWrite: true, job: preview };

  const database = lineageDb();
  try {
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare(`
        insert into generation_jobs (
          id, project_id, provider, adapter_version, source_mode, root_asset_id, prompt,
          expected_output_count, status, output_dir, handoff_json, created_at, updated_at
        ) values (?, ?, ?, ?, 'lineage_selection', ?, ?, ?, 'planned', ?, ?, ?, ?)
      `).run(id, project, provider, adapterVersion, next.root_asset_id, prompt, count, '.asset-scratch', JSON.stringify(handoff), timestamp, timestamp);
      const insertInput = database.prepare('insert into generation_job_inputs (id, job_id, project_id, asset_id, root_asset_id, role, position, selection_strategy, selection_snapshot_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const input of inputs) insertInput.run(input.id, id, project, input.asset_id, input.root_asset_id, input.role, input.position, input.selection_strategy, JSON.stringify(next));
      insertReceipt(database, id, 'plan', 'generate image plan', preview.receipts[0].payload);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    return { ok: true, command: 'generate image plan', project, job: loadGenerationJob(database, project, id) };
  } finally {
    database.close();
  }
}

export function planImageReroll(project = defaultProject, fields: { rootAssetId: string; targetAssetId: string; prompt: string; dryRun?: boolean }): GenerationPlanResponse {
  const prompt = fields.prompt.trim();
  if (!prompt) throw new GenerationReceiptError('Missing --prompt');
  if (!fields.rootAssetId) throw new GenerationReceiptError('Missing --root');
  if (!fields.targetAssetId) throw new GenerationReceiptError('Missing --target');
  const snapshot = getLineageSnapshot(project, fields.rootAssetId);
  const target = snapshot.nodes.find(node => node.asset_id === fields.targetAssetId);
  if (!target) throw new GenerationReceiptError(`Re-roll target is not in lineage: ${fields.targetAssetId}`, 404);
  const request = listLineageRerollRequests(project, snapshot.root_asset_id).requests.find(item => item.node_asset_id === fields.targetAssetId);
  if (!request) throw new GenerationReceiptError(`No pending re-roll request for ${fields.targetAssetId}`);
  const id = jobId();
  const timestamp = nowIso();
  const handoff = buildRerollHandoff(project, id, prompt, snapshot.root_asset_id, target, request);
  const input: GenerationJobInput = {
    id: `${id}:input:0`,
    job_id: id,
    project_id: project,
    asset_id: target.asset_id,
    root_asset_id: snapshot.root_asset_id,
    role: 'reroll_target',
    position: 0,
    selection_strategy: 'reroll_request',
    selection_snapshot: {
      project,
      root_asset_id: snapshot.root_asset_id,
      strategy: 'selected',
      selection_mode: 'single',
      recommended_action: 'evolve_variations',
      reason: 'user_selected',
      next_asset: target,
      next_assets: [target],
      latest: snapshot.latest,
      selected: [target.asset_id],
      selection: null,
      selections: [],
      candidates: snapshot.nodes,
      warnings: ['Re-roll target: import output as an attempt, not a lineage child.'],
      fetchedAt: timestamp,
    },
  };
  const preview: GenerationJob = {
    id,
    project_id: project,
    provider,
    adapter_version: adapterVersion,
    source_mode: 'lineage_reroll',
    root_asset_id: snapshot.root_asset_id,
    prompt,
    expected_output_count: 1,
    status: 'planned',
    output_dir: '.asset-scratch',
    handoff,
    created_at: timestamp,
    updated_at: timestamp,
    inputs: [input],
    outputs: [],
    receipts: [{
      id: `${id}:receipt:plan:preview`,
      job_id: id,
      receipt_type: 'plan',
      status: 'ok',
      command: 'reroll plan',
      payload: { prompt, expected_output_count: 1, lineage: handoff.lineage, reroll_request_id: request.id },
      created_at: timestamp,
    }],
  };
  if (fields.dryRun) return { ok: true, command: 'reroll plan', project, dryRun: true, wouldWrite: true, job: preview };
  const database = lineageDb();
  try {
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare(`
        insert into generation_jobs (
          id, project_id, provider, adapter_version, source_mode, root_asset_id, prompt,
          expected_output_count, status, output_dir, handoff_json, created_at, updated_at
        ) values (?, ?, ?, ?, 'lineage_reroll', ?, ?, 1, 'planned', ?, ?, ?, ?)
      `).run(id, project, provider, adapterVersion, snapshot.root_asset_id, prompt, '.asset-scratch', JSON.stringify(handoff), timestamp, timestamp);
      database.prepare('insert into generation_job_inputs (id, job_id, project_id, asset_id, root_asset_id, role, position, selection_strategy, selection_snapshot_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(input.id, id, project, input.asset_id, input.root_asset_id, input.role, input.position, input.selection_strategy, JSON.stringify(input.selection_snapshot));
      insertReceipt(database, id, 'plan', 'reroll plan', preview.receipts[0].payload);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    return { ok: true, command: 'reroll plan', project, job: loadGenerationJob(database, project, id) };
  } finally {
    database.close();
  }
}

function parentForOutput(job: GenerationJob, outputIndex: number): string {
  const inputs = job.inputs.filter(input => input.role === 'lineage_next_base');
  if (inputs.length === 0) throw new GenerationReceiptError('Generation job has no lineage_next_base input');
  if (inputs.length === 1) return inputs[0].asset_id;
  if (job.expected_output_count % inputs.length !== 0) throw new GenerationReceiptError('Generation job has invalid parent mapping');
  return inputs[Math.floor(outputIndex / (job.expected_output_count / inputs.length))]?.asset_id || inputs[inputs.length - 1].asset_id;
}

function parentInputs(job: GenerationJob): GenerationJobInput[] {
  const inputs = job.inputs.filter(input => input.role === 'lineage_next_base');
  if (inputs.length === 0) throw new GenerationReceiptError('Generation job has no lineage_next_base input');
  return inputs;
}

function parentFilesFor(job: GenerationJob, parentFiles: Record<string, string[]>): Array<{ file: string; parentAssetId: string }> {
  const inputs = parentInputs(job);
  const expectedPerParent = job.expected_output_count / inputs.length;
  if (!Number.isInteger(expectedPerParent)) throw new GenerationReceiptError('Generation job has invalid parent mapping');
  const allowedParents = new Set(inputs.map(input => input.asset_id));
  const seenParents = new Set<string>();
  const mapped: Array<{ file: string; parentAssetId: string }> = [];
  for (const parentAssetId of Object.keys(parentFiles)) {
    if (!allowedParents.has(parentAssetId)) throw new GenerationReceiptError(`Unknown generation parent mapping: ${parentAssetId}`);
    if (seenParents.has(parentAssetId)) throw new GenerationReceiptError(`Duplicate generation parent mapping: ${parentAssetId}`);
    seenParents.add(parentAssetId);
  }
  for (const input of inputs) {
    const files = (parentFiles[input.asset_id] || []).map(file => file.trim()).filter(Boolean);
    if (files.length === 0) throw new GenerationReceiptError(`Missing generation parent mapping for ${input.asset_id}`);
    if (files.length !== expectedPerParent) throw new GenerationReceiptError(`Parent ${input.asset_id} requires ${expectedPerParent} output file${expectedPerParent === 1 ? '' : 's'}, received ${files.length}`);
    for (const file of files) mapped.push({ file, parentAssetId: input.asset_id });
  }
  return mapped;
}

function orderedFilesFor(job: GenerationJob, files: string[]): Array<{ file: string; parentAssetId: string }> {
  return files.map((file, index) => ({ file, parentAssetId: parentForOutput(job, index) }));
}

export function inspectImageGeneration(project = defaultProject, jobIdValue: string): GenerationInspectResponse {
  if (!jobIdValue) throw new GenerationReceiptError('Missing --job-id');
  const database = lineageDb();
  try {
    return { ok: true, command: 'generate image inspect', project, job: loadGenerationJob(database, project, jobIdValue) };
  } finally {
    database.close();
  }
}

function isPathInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return Boolean(rel) && !rel.startsWith('..') && !rel.startsWith('/');
}

function resolveScratchFile(file: string): { relativePath: string; checksum: string; size: number; contentType: string; assetId: string } {
  const scratchRoot = resolve(repoRoot, '.asset-scratch');
  const candidate = file.startsWith('.asset-scratch/') || resolve(file).startsWith(scratchRoot)
    ? resolve(repoRoot, file)
    : resolve(scratchRoot, file);
  if (!isPathInside(candidate, scratchRoot)) throw new GenerationReceiptError(`Import file must be under .asset-scratch: ${file}`);
  if (!existsSync(candidate)) throw new GenerationReceiptError(`Missing import file: ${file}`, 404);
  const realScratchRoot = realpathSync(scratchRoot);
  const realCandidate = realpathSync(candidate);
  if (!isPathInside(realCandidate, realScratchRoot)) throw new GenerationReceiptError(`Import file must be under .asset-scratch: ${file}`);
  const stats = statSync(candidate);
  if (!stats.isFile()) throw new GenerationReceiptError(`Import path is not a file: ${file}`);
  const checksum = fileSha256(candidate);
  return {
    relativePath: relative(scratchRoot, candidate),
    checksum,
    size: stats.size,
    contentType: contentTypeFor(candidate),
    assetId: `local-${checksum.slice(0, 12)}`,
  };
}

export function importImageGenerationOutputs(project = defaultProject, fields: { jobId: string; files?: string[]; parentFiles?: Record<string, string[]>; confirmWrite: boolean }): GenerationImportResponse {
  if (!fields.jobId) throw new GenerationReceiptError('Missing --job-id');
  if (!fields.confirmWrite) throw new GenerationReceiptError('Generation import requires --confirm-write');
  const database = lineageDb();
  let job: GenerationJob;
  try {
    job = loadGenerationJob(database, project, fields.jobId);
  } finally {
    database.close();
  }
  if (job.status !== 'planned') throw new GenerationReceiptError(`Generation job is not importable from status: ${job.status}`);
  const hasExplicitParentFiles = Boolean(fields.parentFiles && Object.keys(fields.parentFiles).length > 0);
  const hasOrderedFiles = Boolean(fields.files && fields.files.map(file => file.trim()).filter(Boolean).length > 0);
  if (hasExplicitParentFiles && hasOrderedFiles) throw new GenerationReceiptError('Use --files or --parent-files, not both');
  const parentFileRows = hasExplicitParentFiles
    ? parentFilesFor(job, fields.parentFiles || {})
    : orderedFilesFor(job, (fields.files || []).map(file => file.trim()).filter(Boolean));
  if (parentFileRows.length === 0) throw new GenerationReceiptError('Generation import requires --files or --parent-files');
  if (parentFileRows.length !== job.expected_output_count) {
    throw new GenerationReceiptError(`Output count mismatch: expected ${job.expected_output_count}, received ${parentFileRows.length}`);
  }
  const resolved = parentFileRows.map(row => ({ ...resolveScratchFile(row.file), parentAssetId: row.parentAssetId }));
  const uniquePaths = new Set(resolved.map(file => file.relativePath));
  if (uniquePaths.size !== resolved.length) throw new GenerationReceiptError('Generation import files must be unique');
  cancelLineageIterateTasksForAssets(project, {
    actor: 'system',
    confirmWrite: false,
    rootAssetId: job.root_asset_id,
  });
  indexLineageAssets(project);
  const writeDb = lineageDb();
  try {
    const timestamp = nowIso();
    writeDb.exec('BEGIN IMMEDIATE');
    try {
      for (const [index, file] of resolved.entries()) {
        const assetRow = writeDb.prepare('select id from assets where project_id = ? and id = ?').get(project, file.assetId);
        if (!assetRow) throw new GenerationReceiptError(`Indexed local asset was not found: ${file.relativePath}`);
        const outputId = `${fields.jobId}:output:${index}`;
        writeDb.prepare(`insert into generation_job_outputs (
          id, job_id, project_id, output_index, file_path, checksum_sha256, size_bytes, content_type, imported_asset_id, parent_asset_id, imported_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(outputId, fields.jobId, project, index, file.relativePath, file.checksum, file.size, file.contentType, file.assetId, file.parentAssetId, timestamp);
        writeDb.prepare(`insert into asset_edges (id, project_id, parent_asset_id, child_asset_id, relation_type, created_at)
          values (?, ?, ?, ?, 'derived_from', ?) on conflict(project_id, parent_asset_id, child_asset_id, relation_type) do nothing`)
          .run(`${project}:${file.parentAssetId}:derived_from:${file.assetId}`, project, file.parentAssetId, file.assetId, timestamp);
      }
      writeDb.prepare(`
        update generation_jobs
        set status = 'imported', imported_at = ?, updated_at = ?
        where project_id = ? and id = ?
      `).run(timestamp, timestamp, project, fields.jobId);
      insertReceipt(writeDb, fields.jobId, 'import', 'generate image import', {
        mapping_strategy: hasExplicitParentFiles ? 'explicit_parent_files' : 'ordered_per_base',
        files: resolved.map((file, index) => ({ output_index: index, file_path: file.relativePath, imported_asset_id: file.assetId, parent_asset_id: file.parentAssetId })),
        selection_reset: { root_asset_id: job.root_asset_id, cleared: true },
      });
      writeDb.prepare('delete from asset_selections where project_id = ? and root_asset_id = ?').run(project, job.root_asset_id);
      writeDb.exec('COMMIT');
    } catch (error) {
      writeDb.exec('ROLLBACK');
      throw error;
    }
    cancelLineageIterateTasksForAssets(project, {
      actor: 'system',
      confirmWrite: true,
      rootAssetId: job.root_asset_id,
    });
    const importedJob = loadGenerationJob(writeDb, project, fields.jobId);
    return { ok: true, command: 'generate image import', project, job: importedJob, imported: importedJob.outputs };
  } finally {
    writeDb.close();
  }
}

export function importImageRerollOutput(project = defaultProject, fields: { jobId: string; file: string; confirmWrite: boolean }): GenerationImportResponse {
  if (!fields.jobId) throw new GenerationReceiptError('Missing --job-id');
  if (!fields.confirmWrite) throw new GenerationReceiptError('Generation import requires --confirm-write');
  const database = lineageDb();
  let job: GenerationJob;
  try {
    job = loadGenerationJob(database, project, fields.jobId);
  } finally {
    database.close();
  }
  if (job.status !== 'planned') throw new GenerationReceiptError(`Generation job is not importable from status: ${job.status}`);
  if (job.source_mode !== 'lineage_reroll') throw new GenerationReceiptError(`Generation job is not a re-roll job: ${job.source_mode}`);
  const target = job.inputs.filter(input => input.role === 'reroll_target');
  if (target.length !== 1) throw new GenerationReceiptError('Re-roll import requires exactly one reroll_target input');
  const resolved = resolveScratchFile(fields.file);
  indexLineageAssets(project);
  const writeDb = lineageDb();
  try {
    const timestamp = nowIso();
    writeDb.exec('BEGIN IMMEDIATE');
    try {
      const assetRow = writeDb.prepare('select id from assets where project_id = ? and id = ?').get(project, resolved.assetId);
      if (!assetRow) throw new GenerationReceiptError(`Indexed local asset was not found: ${resolved.relativePath}`);
      const outputId = `${fields.jobId}:output:0`;
      writeDb.prepare(`insert into generation_job_outputs (
        id, job_id, project_id, output_index, file_path, checksum_sha256, size_bytes, content_type, imported_asset_id, parent_asset_id, imported_at
      ) values (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`).run(outputId, fields.jobId, project, resolved.relativePath, resolved.checksum, resolved.size, resolved.contentType, resolved.assetId, target[0].asset_id, timestamp);
      writeDb.prepare(`
        update generation_jobs
        set status = 'imported', imported_at = ?, updated_at = ?
        where project_id = ? and id = ?
      `).run(timestamp, timestamp, project, fields.jobId);
      insertReceipt(writeDb, fields.jobId, 'import', 'reroll import', {
        file: { output_index: 0, file_path: resolved.relativePath, imported_asset_id: resolved.assetId, parent_asset_id: target[0].asset_id },
        reroll: { root_asset_id: job.root_asset_id, node_asset_id: target[0].asset_id },
      });
      writeDb.exec('COMMIT');
    } catch (error) {
      writeDb.exec('ROLLBACK');
      throw error;
    }
    recordLineageRerollAttempt(project, {
      rootAssetId: job.root_asset_id,
      nodeAssetId: target[0].asset_id,
      assetId: resolved.assetId,
      prompt: job.prompt,
      generationJobId: fields.jobId,
      filePath: resolved.relativePath,
      checksumSha256: resolved.checksum,
      confirmWrite: true,
    });
    const rerollTask = listLineageTasks(project, job.root_asset_id).tasks.find(task => task.task_type === 'reroll' && task.target_asset_id === target[0].asset_id);
    if (rerollTask) {
      resolveLineageTask(project, {
        actor: 'agent',
        confirmWrite: true,
        resolvedAssetId: resolved.assetId,
        resolvedGenerationJobId: fields.jobId,
        taskId: rerollTask.id,
      });
    }
    const importedJob = loadGenerationJob(writeDb, project, fields.jobId);
    return { ok: true, command: 'reroll import', project, job: importedJob, imported: importedJob.outputs };
  } finally {
    writeDb.close();
  }
}
