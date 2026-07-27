import { createHash } from 'node:crypto';
import { EdgeSummaryValidationError, requireEdgeSummary } from './edgeSummary';
import type { GenerationJob, GenerationJobInput } from './generationTypes';
import type { GenerationOutputSlot } from './outputTargetTypes';

export const generationOutputManifestSchemaVersion = 'lineage.generation_output_manifest.v1' as const;
export const targetAwareGenerationOutputManifestSchemaVersion = 'lineage.generation_output_manifest.v2' as const;

interface LegacyGenerationOutputManifestEntry {
  output_index: number;
  file_path: string;
  parent_asset_id: string;
  edge_summary: string;
}

interface TargetAwareGenerationOutputManifestEntry extends LegacyGenerationOutputManifestEntry {
  target_group_id: string;
  variant_index: number;
  output_spec: GenerationOutputSlot['output_spec'] | null;
  output_spec_digest: string | null;
}

export interface LegacyGenerationOutputManifest {
  schema_version: typeof generationOutputManifestSchemaVersion;
  job_id: string;
  outputs: LegacyGenerationOutputManifestEntry[];
}

export interface TargetAwareGenerationOutputManifest {
  schema_version: typeof targetAwareGenerationOutputManifestSchemaVersion;
  job_id: string;
  outputs: TargetAwareGenerationOutputManifestEntry[];
}

export type GenerationOutputManifest = LegacyGenerationOutputManifest | TargetAwareGenerationOutputManifest;

interface LegacyGenerationOutputManifestDraftEntry {
  output_index: number;
  file_path: '';
  parent_asset_id: string;
  edge_summary: '';
}

interface TargetAwareGenerationOutputManifestDraftEntry extends LegacyGenerationOutputManifestDraftEntry {
  target_group_id: string;
  variant_index: number;
  output_spec: GenerationOutputSlot['output_spec'] | null;
  output_spec_digest: string | null;
}

export interface LegacyGenerationOutputManifestDraft {
  schema_version: typeof generationOutputManifestSchemaVersion;
  job_id: string;
  outputs: LegacyGenerationOutputManifestDraftEntry[];
}

export interface TargetAwareGenerationOutputManifestDraft {
  schema_version: typeof targetAwareGenerationOutputManifestSchemaVersion;
  job_id: string;
  outputs: TargetAwareGenerationOutputManifestDraftEntry[];
}

export type GenerationOutputManifestDraft = LegacyGenerationOutputManifestDraft | TargetAwareGenerationOutputManifestDraft;

export type GenerationOutputManifestJob = Pick<GenerationJob, 'id' | 'expected_output_count'> & {
  inputs: Array<Pick<GenerationJobInput, 'asset_id' | 'position' | 'role'>>;
  target_plan?: GenerationJob['target_plan'];
};

export interface GenerationOutputManifestParseOptions {
  resolveFilePath: (filePath: string) => string;
}

class GenerationOutputManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationOutputManifestError';
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GenerationOutputManifestError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedKeys = new Set(allowed);
  const unsupported = Object.keys(value).filter(key => !allowedKeys.has(key)).sort();
  if (unsupported.length > 0) {
    throw new GenerationOutputManifestError(`${label} contains unsupported field: ${unsupported[0]}`);
  }
}

function nonEmptyText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new GenerationOutputManifestError(`${label} is required`);
  return value.trim();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function generationOutputSpecDigest(outputSpec: GenerationOutputSlot['output_spec']): string | null {
  return outputSpec ? createHash('sha256').update(stableJson(outputSpec)).digest('hex') : null;
}

export function expectedGenerationOutputParents(job: GenerationOutputManifestJob): string[] {
  if (!Number.isInteger(job.expected_output_count) || job.expected_output_count <= 0) {
    throw new GenerationOutputManifestError('Generation job expected output count must be a positive integer');
  }
  const parents = job.inputs
    .filter(input => input.role === 'lineage_next_base')
    .sort((left, right) => left.position - right.position);
  if (parents.length === 0) throw new GenerationOutputManifestError('Generation job has no lineage_next_base input');
  const parentIds = new Set<string>();
  const parentPositions = new Set<number>();
  for (const parent of parents) {
    if (typeof parent.asset_id !== 'string' || !parent.asset_id || parent.asset_id.trim() !== parent.asset_id) {
      throw new GenerationOutputManifestError('Generation job has invalid lineage parent asset id');
    }
    if (!Number.isInteger(parent.position) || parent.position < 0 || parentPositions.has(parent.position)) {
      throw new GenerationOutputManifestError('Generation job has invalid lineage parent positions');
    }
    if (parentIds.has(parent.asset_id)) throw new GenerationOutputManifestError(`Generation job has duplicate lineage parent: ${parent.asset_id}`);
    parentIds.add(parent.asset_id);
    parentPositions.add(parent.position);
  }
  if (job.expected_output_count % parents.length !== 0) {
    throw new GenerationOutputManifestError('Generation job has invalid parent mapping');
  }
  const outputsPerParent = job.expected_output_count / parents.length;
  return Array.from({ length: job.expected_output_count }, (_value, outputIndex) => {
    return parents[Math.floor(outputIndex / outputsPerParent)].asset_id;
  });
}

export function createGenerationOutputManifestDraft(job: GenerationOutputManifestJob): GenerationOutputManifestDraft {
  if (job.target_plan) {
    if (job.target_plan.slots.length !== job.expected_output_count) {
      throw new GenerationOutputManifestError('Generation target plan output count does not match the job');
    }
    return {
      schema_version: targetAwareGenerationOutputManifestSchemaVersion,
      job_id: job.id,
      outputs: job.target_plan.slots.map(slot => ({
        output_index: slot.output_index,
        file_path: '',
        parent_asset_id: slot.parent_asset_id,
        edge_summary: '',
        target_group_id: slot.group_id,
        variant_index: slot.variant_index,
        output_spec: slot.output_spec ? structuredClone(slot.output_spec) : null,
        output_spec_digest: generationOutputSpecDigest(slot.output_spec),
      })),
    };
  }
  return {
    schema_version: generationOutputManifestSchemaVersion,
    job_id: job.id,
    outputs: expectedGenerationOutputParents(job).map((parentAssetId, outputIndex) => ({
      output_index: outputIndex,
      file_path: '',
      parent_asset_id: parentAssetId,
      edge_summary: '',
    })),
  };
}

export function parseGenerationOutputManifest(
  value: unknown,
  job: GenerationOutputManifestJob,
  options: GenerationOutputManifestParseOptions,
): GenerationOutputManifest {
  if (!options || typeof options.resolveFilePath !== 'function') {
    throw new GenerationOutputManifestError('Generation output manifest requires a file-path resolver');
  }
  const manifest = record(value, 'Generation output manifest');
  exactKeys(manifest, ['schema_version', 'job_id', 'outputs'], 'Generation output manifest');
  const expectedSchema = job.target_plan
    ? targetAwareGenerationOutputManifestSchemaVersion
    : generationOutputManifestSchemaVersion;
  if (manifest.schema_version !== expectedSchema) {
    throw new GenerationOutputManifestError(`Generation output manifest schema_version must be ${expectedSchema}`);
  }
  if (manifest.job_id !== job.id) throw new GenerationOutputManifestError(`Generation output manifest job_id must be ${job.id}`);
  if (!Array.isArray(manifest.outputs)) throw new GenerationOutputManifestError('Generation output manifest outputs must be an array');

  const expectedParents = job.target_plan
    ? job.target_plan.slots.map(slot => slot.parent_asset_id)
    : expectedGenerationOutputParents(job);
  if (manifest.outputs.length !== expectedParents.length) {
    throw new GenerationOutputManifestError(`Generation output manifest requires ${expectedParents.length} outputs, received ${manifest.outputs.length}`);
  }

  const seenIndexes = new Set<number>();
  const outputs = manifest.outputs.map((value, position): TargetAwareGenerationOutputManifestEntry | LegacyGenerationOutputManifestEntry => {
    const output = record(value, `Generation output at position ${position}`);
    exactKeys(output, job.target_plan
      ? ['output_index', 'file_path', 'parent_asset_id', 'edge_summary', 'target_group_id', 'variant_index', 'output_spec', 'output_spec_digest']
      : ['output_index', 'file_path', 'parent_asset_id', 'edge_summary'], `Generation output at position ${position}`);
    const outputIndex = output.output_index;
    if (!Number.isInteger(outputIndex) || Number(outputIndex) < 0) {
      throw new GenerationOutputManifestError(`Generation output at position ${position} requires a non-negative integer output_index`);
    }
    const normalizedIndex = Number(outputIndex);
    if (seenIndexes.has(normalizedIndex)) throw new GenerationOutputManifestError(`Duplicate generation output_index: ${normalizedIndex}`);
    seenIndexes.add(normalizedIndex);
    const expectedParent = expectedParents[normalizedIndex];
    if (!expectedParent) throw new GenerationOutputManifestError(`Unknown generation output_index: ${normalizedIndex}`);

    const filePath = nonEmptyText(output.file_path, `Generation output ${normalizedIndex} file_path`);
    const parentAssetId = nonEmptyText(output.parent_asset_id, `Generation output ${normalizedIndex} parent_asset_id`);
    if (parentAssetId !== expectedParent) {
      throw new GenerationOutputManifestError(`Generation output ${normalizedIndex} must use parent_asset_id ${expectedParent}`);
    }
    let edgeSummary: string;
    try {
      edgeSummary = requireEdgeSummary(output.edge_summary);
    } catch (error) {
      if (error instanceof EdgeSummaryValidationError) {
        throw new GenerationOutputManifestError(`Generation output ${normalizedIndex}: ${error.message}`);
      }
      throw error;
    }
    const base = {
      output_index: normalizedIndex,
      file_path: filePath,
      parent_asset_id: parentAssetId,
      edge_summary: edgeSummary,
    };
    if (!job.target_plan) return base;
    const slot = job.target_plan.slots.find(candidate => candidate.output_index === normalizedIndex);
    if (!slot) throw new GenerationOutputManifestError(`Unknown generation target slot: ${normalizedIndex}`);
    const expectedSpec = slot.output_spec ?? null;
    const expectedDigest = generationOutputSpecDigest(slot.output_spec);
    if (
      output.target_group_id !== slot.group_id
      || output.variant_index !== slot.variant_index
      || stableJson(output.output_spec) !== stableJson(expectedSpec)
      || output.output_spec_digest !== expectedDigest
    ) {
      throw new GenerationOutputManifestError(`Generation output ${normalizedIndex} target contract does not match the stored job`);
    }
    return {
      ...base,
      target_group_id: slot.group_id,
      variant_index: slot.variant_index,
      output_spec: expectedSpec ? structuredClone(expectedSpec) : null,
      output_spec_digest: expectedDigest,
    };
  });

  for (const outputIndex of expectedParents.keys()) {
    if (!seenIndexes.has(outputIndex)) throw new GenerationOutputManifestError(`Missing generation output_index: ${outputIndex}`);
  }
  outputs.sort((left, right) => left.output_index - right.output_index);
  const seenPaths = new Set<string>();
  const resolvedOutputs = outputs.map(output => {
    const filePath = nonEmptyText(options.resolveFilePath(output.file_path), `Generation output ${output.output_index} resolved file_path`);
    if (seenPaths.has(filePath)) throw new GenerationOutputManifestError(`Duplicate generation output file_path: ${filePath}`);
    seenPaths.add(filePath);
    return { ...output, file_path: filePath };
  });
  return {
    schema_version: expectedSchema,
    job_id: job.id,
    outputs: resolvedOutputs,
  } as GenerationOutputManifest;
}
