import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLineageTestProfile } from '../test/lineageTestProfile';
import { defaultProject, repoRoot } from './assetCore';
import { getLineageNextAsset, indexLineageAssets, linkLineageAssets, updateSelectedAsset } from './assetLineage';
import { createLineageWorkspace } from './assetLineageWorkspaces';
import { importImageGenerationOutputs, planImageGeneration } from './generationReceipts';
import { fileSha256 } from './localReview';
import type { GenerationJob } from '../shared/types';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-generation-receipts-selection-reset');
const dbFile = join(scratchDir, 'generation-receipts-selection-reset.sqlite');

function localId(file: string): string {
  return `local-${fileSha256(file).slice(0, 12)}`;
}

function writeScratch(relativePath: string, content: string): string {
  const file = join(scratchDir, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

function outputManifest(job: GenerationJob, files: string[]) {
  const draft = job.handoff.output_manifest;
  if (!draft) throw new Error(`Generation job ${job.id} is missing its output manifest draft`);
  return {
    ...draft,
    outputs: draft.outputs.slice(0, files.length).map((output, index) => ({
      ...output,
      edge_summary: `Variation ${index + 1}`,
      file_path: files[index],
    })),
  };
}

function setupSelectedLineage() {
  const root = writeScratch('demo-linkedin-clear-root.png', `clear-root-${Date.now()}`);
  const selected = writeScratch('demo-linkedin-clear-selected.png', `clear-selected-${Date.now()}`);
  const other = writeScratch('demo-linkedin-clear-other.png', `clear-other-${Date.now()}`);
  const rootId = localId(root), selectedId = localId(selected), otherId = localId(other);
  indexLineageAssets(defaultProject);
  linkLineageAssets(defaultProject, { childAssetId: selectedId, confirmWrite: true, parentAssetId: rootId });
  linkLineageAssets(defaultProject, { childAssetId: otherId, confirmWrite: true, parentAssetId: rootId });
  createLineageWorkspace(defaultProject, {
    activate: true,
    confirmWrite: true,
    createdBy: 'agent',
    rootAssetId: rootId,
    title: 'Generation receipt clear-selection workspace',
  });
  updateSelectedAsset(defaultProject, {
    assetIds: [selectedId, otherId],
    confirmWrite: true,
    mode: 'replace',
    rootAssetId: rootId,
  });
  return { otherId, rootId, selectedId };
}

describe('generation receipt selection reset', () => {
  beforeEach(() => {
    rmSync(scratchDir, { recursive: true, force: true });
    mkdirSync(scratchDir, { recursive: true });
    useLineageTestProfile(dbFile);
  });

  it('clears next variation selections after generation import while preserving parent receipts', () => {
    const lineage = setupSelectedLineage();
    const plan = planImageGeneration(defaultProject, {
      count: 2,
      fromLineageSelection: true,
      perBaseCount: 1,
      prompt: 'Create one variation from each selected base, then reset selection.',
    });
    const selectedOutput = writeScratch('imports/clear-after-import-a.png', 'clear-after-import-a');
    const otherOutput = writeScratch('imports/clear-after-import-b.png', 'clear-after-import-b');
    const imported = importImageGenerationOutputs(defaultProject, {
      confirmWrite: true,
      jobId: plan.job.id,
      manifest: outputManifest(plan.job, [selectedOutput, otherOutput]),
    });
    const next = getLineageNextAsset(defaultProject, lineage.rootId);

    expect(imported.job.receipts.find(receipt => receipt.receipt_type === 'import')?.payload).toMatchObject({
      mapping_strategy: 'generation_output_manifest_v1',
      files: [
        { imported_asset_id: localId(selectedOutput), parent_asset_id: lineage.selectedId },
        { imported_asset_id: localId(otherOutput), parent_asset_id: lineage.otherId },
      ],
      selection_reset: { cleared: true, root_asset_id: lineage.rootId },
    });
    expect(next.selected).toEqual([]);
    expect(next.next_assets).toEqual([]);
    expect(next.selection_mode).toBe('none');
  });

  it('keeps next variation selections when generation import fails', () => {
    const lineage = setupSelectedLineage();
    const plan = planImageGeneration(defaultProject, {
      count: 2,
      fromLineageSelection: true,
      perBaseCount: 1,
      prompt: 'Create two outputs, but only import one for negative proof.',
    });
    const output = writeScratch('imports/clear-after-failed-import.png', 'clear-after-failed-import');

    expect(() => importImageGenerationOutputs(defaultProject, {
      confirmWrite: true,
      jobId: plan.job.id,
      manifest: outputManifest(plan.job, [output]),
    })).toThrow('requires 2 outputs, received 1');
    const next = getLineageNextAsset(defaultProject, lineage.rootId);
    expect([...next.selected].sort()).toEqual([lineage.selectedId, lineage.otherId].sort());
    expect(next.selection_mode).toBe('multiple');
  });
});
