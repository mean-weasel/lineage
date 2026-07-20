import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createGenerationOutputManifestDraft,
  expectedGenerationOutputParents,
  generationOutputManifestSchemaVersion,
  parseGenerationOutputManifest,
  type GenerationOutputManifestJob,
} from './generationOutputManifest';

function job(overrides: Partial<GenerationOutputManifestJob> = {}): GenerationOutputManifestJob {
  return {
    id: 'gen-contract',
    expected_output_count: 4,
    inputs: [
      { asset_id: 'parent-b', position: 2, role: 'lineage_next_base' },
      { asset_id: 'reference-only', position: 1, role: 'reference' },
      { asset_id: 'parent-a', position: 0, role: 'lineage_next_base' },
    ],
    ...overrides,
  };
}

function resolveScratchFilePath(filePath: string): string {
  const scratchRelative = filePath.startsWith('.asset-scratch/')
    ? filePath.slice('.asset-scratch/'.length)
    : filePath;
  const normalized = posix.normalize(scratchRelative);
  if (posix.isAbsolute(scratchRelative) || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Import file must be under .asset-scratch: ${filePath}`);
  }
  return normalized;
}

function parse(value: unknown, targetJob = job()) {
  return parseGenerationOutputManifest(value, targetJob, { resolveFilePath: resolveScratchFilePath });
}

function validManifest() {
  return {
    schema_version: generationOutputManifestSchemaVersion,
    job_id: 'gen-contract',
    outputs: [
      { output_index: 3, file_path: 'imports/b-2.png', parent_asset_id: 'parent-b', edge_summary: 'Bolder type' },
      { output_index: 0, file_path: '.asset-scratch/imports/./a-1.png', parent_asset_id: 'parent-a', edge_summary: '  Cleaner\nlayout ' },
      { output_index: 2, file_path: 'imports/b-1.png', parent_asset_id: 'parent-b', edge_summary: 'Warmer palette' },
      { output_index: 1, file_path: 'imports/a-2.png', parent_asset_id: 'parent-a', edge_summary: 'New crop' },
    ],
  };
}

describe('generation output manifest contract', () => {
  it('derives stable per-output parent assignments and creates an intentionally unfilled draft', () => {
    expect(expectedGenerationOutputParents(job())).toEqual(['parent-a', 'parent-a', 'parent-b', 'parent-b']);
    expect(createGenerationOutputManifestDraft(job())).toEqual({
      schema_version: generationOutputManifestSchemaVersion,
      job_id: 'gen-contract',
      outputs: [
        { output_index: 0, file_path: '', parent_asset_id: 'parent-a', edge_summary: '' },
        { output_index: 1, file_path: '', parent_asset_id: 'parent-a', edge_summary: '' },
        { output_index: 2, file_path: '', parent_asset_id: 'parent-b', edge_summary: '' },
        { output_index: 3, file_path: '', parent_asset_id: 'parent-b', edge_summary: '' },
      ],
    });
    expect(() => parse(createGenerationOutputManifestDraft(job()))).toThrow('file_path is required');
  });

  it('normalizes summaries and resolved scratch paths, then returns output-index order', () => {
    const resolvedInputs: string[] = [];
    const parsed = parseGenerationOutputManifest(validManifest(), job(), {
      resolveFilePath: filePath => {
        resolvedInputs.push(filePath);
        return resolveScratchFilePath(filePath);
      },
    });

    expect(parsed.outputs.map(output => [output.output_index, output.file_path, output.parent_asset_id, output.edge_summary])).toEqual([
      [0, 'imports/a-1.png', 'parent-a', 'Cleaner layout'],
      [1, 'imports/a-2.png', 'parent-a', 'New crop'],
      [2, 'imports/b-1.png', 'parent-b', 'Warmer palette'],
      [3, 'imports/b-2.png', 'parent-b', 'Bolder type'],
    ]);
    expect(resolvedInputs).toEqual([
      '.asset-scratch/imports/./a-1.png',
      'imports/a-2.png',
      'imports/b-1.png',
      'imports/b-2.png',
    ]);
  });

  it('rejects missing or invalid summaries before resolving any file', () => {
    let resolverCalls = 0;
    const resolveFilePath = (filePath: string) => {
      resolverCalls += 1;
      return resolveScratchFilePath(filePath);
    };
    const missing = validManifest();
    missing.outputs[0].edge_summary = '';
    expect(() => parseGenerationOutputManifest(missing, job(), { resolveFilePath })).toThrow('Generation output 3: Edge summary is required');
    expect(resolverCalls).toBe(0);

    const tooLong = validManifest();
    tooLong.outputs[0].edge_summary = 'Much bolder type';
    expect(() => parseGenerationOutputManifest(tooLong, job(), { resolveFilePath })).toThrow('Generation output 3: Edge summary must contain at most 2 words');
    expect(resolverCalls).toBe(0);
  });

  it('rejects wrong jobs, output counts, duplicate indexes, duplicate files, and parent mismatches', () => {
    expect(() => parse({ ...validManifest(), job_id: 'other-job' })).toThrow('job_id must be gen-contract');
    expect(() => parse({ ...validManifest(), outputs: validManifest().outputs.slice(0, 3) })).toThrow('requires 4 outputs, received 3');

    const duplicateIndex = validManifest();
    duplicateIndex.outputs[1].output_index = 3;
    expect(() => parse(duplicateIndex)).toThrow('Duplicate generation output_index: 3');

    const duplicatePath = validManifest();
    duplicatePath.outputs[1].file_path = 'imports/../imports/b-2.png';
    expect(() => parse(duplicatePath)).toThrow('Duplicate generation output file_path: imports/b-2.png');

    const wrongParent = validManifest();
    wrongParent.outputs[0].parent_asset_id = 'parent-a';
    expect(() => parse(wrongParent)).toThrow('Generation output 3 must use parent_asset_id parent-b');
  });

  it('rejects paths outside scratch, a missing resolver, and malformed or extended schemas', () => {
    const outside = validManifest();
    outside.outputs[0].file_path = '../private.png';
    expect(() => parse(outside)).toThrow('Import file must be under .asset-scratch');
    expect(() => parseGenerationOutputManifest(validManifest(), job(), undefined as never)).toThrow('requires a file-path resolver');
    expect(() => parse({ ...validManifest(), extra: true })).toThrow('contains unsupported field: extra');
    expect(() => parse({ ...validManifest(), schema_version: 'lineage.generation_output_manifest.v2' }))
      .toThrow(`schema_version must be ${generationOutputManifestSchemaVersion}`);
    expect(() => parse({ ...validManifest(), outputs: [{ ...validManifest().outputs[0], extra: true }, ...validManifest().outputs.slice(1)] }))
      .toThrow('Generation output at position 0 contains unsupported field: extra');
    expect(() => parse(null)).toThrow('Generation output manifest must be an object');
    expect(() => parse({ schema_version: generationOutputManifestSchemaVersion, job_id: 'gen-contract', outputs: 'not-an-array' }))
      .toThrow('outputs must be an array');
  });

  it('rejects malformed output fields and invalid resolver results', () => {
    const invalidIndex = validManifest();
    invalidIndex.outputs[0].output_index = -1;
    expect(() => parse(invalidIndex)).toThrow('requires a non-negative integer output_index');

    const invalidFile = validManifest() as unknown as { outputs: Array<Record<string, unknown>> };
    invalidFile.outputs[0].file_path = 42;
    expect(() => parse(invalidFile)).toThrow('file_path is required');

    const invalidParent = validManifest() as unknown as { outputs: Array<Record<string, unknown>> };
    invalidParent.outputs[0].parent_asset_id = null;
    expect(() => parse(invalidParent)).toThrow('parent_asset_id is required');

    const malformedOutput = validManifest() as unknown as { outputs: unknown[] };
    malformedOutput.outputs[0] = null;
    expect(() => parse(malformedOutput)).toThrow('Generation output at position 0 must be an object');

    expect(() => parseGenerationOutputManifest(validManifest(), job(), { resolveFilePath: () => '  ' }))
      .toThrow('resolved file_path is required');
  });

  it('rejects jobs whose output count cannot be divided across selected parents', () => {
    expect(() => expectedGenerationOutputParents(job({ expected_output_count: 3 }))).toThrow('Generation job has invalid parent mapping');
    expect(() => expectedGenerationOutputParents(job({ expected_output_count: 0 }))).toThrow('must be a positive integer');
    expect(() => expectedGenerationOutputParents(job({ inputs: [{ asset_id: 'reference-only', position: 0, role: 'reference' }] }))).toThrow('no lineage_next_base input');
    expect(() => expectedGenerationOutputParents(job({ inputs: [
      { asset_id: 'parent-a', position: 0, role: 'lineage_next_base' },
      { asset_id: 'parent-a', position: 1, role: 'lineage_next_base' },
    ] }))).toThrow('duplicate lineage parent: parent-a');
    expect(() => expectedGenerationOutputParents(job({ inputs: [
      { asset_id: 'parent-a', position: 0, role: 'lineage_next_base' },
      { asset_id: 'parent-b', position: 0, role: 'lineage_next_base' },
    ] }))).toThrow('invalid lineage parent positions');
    expect(() => expectedGenerationOutputParents(job({ inputs: [
      { asset_id: ' parent-a ', position: 0, role: 'lineage_next_base' },
    ] }))).toThrow('invalid lineage parent asset id');
  });
});
