import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultProject, repoRoot } from './assetCore';
import { chooseReviewSetLabels, clearCurrentSelection, createReviewSet, getAssetSelectionSnapshot, selectCurrentAssets } from './assetSelections';
import { activateReviewSet, archiveReviewSet, inspectReviewSet, listReviewSets } from './assetReviewSets';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-asset-selections');
const dbFile = join(scratchDir, 'asset-selections.sqlite');
const assetA = 'selection-asset-a';
const assetB = 'selection-asset-b';
const assetC = 'selection-asset-c';
const assetD = 'selection-asset-d';

function resetDb() {
  rmSync(scratchDir, { force: true, recursive: true });
  process.env.LINEAGE_DB = dbFile;
}

describe('asset selection ledger', () => {
  beforeEach(resetDb);

  it('persists a project current selection set', () => {
    const selected = selectCurrentAssets(defaultProject, {
      assetIds: [assetA, assetB],
      confirmWrite: true,
      notes: 'human picked these',
      selectedBy: 'human',
    });

    expect(selected).toMatchObject({ ok: true });
    const snapshot = getAssetSelectionSnapshot(defaultProject);
    expect(snapshot.current).toMatchObject({ kind: 'current', key: 'current', project: defaultProject });
    expect(snapshot.current.items.map(item => item.asset_id)).toEqual([assetA, assetB]);
    expect(snapshot.current.items.every(item => item.selected_by === 'human' && item.selected_at)).toBe(true);
  });

  it('clears current selections without deleting the current set', () => {
    selectCurrentAssets(defaultProject, { assetIds: [assetA], confirmWrite: true });
    clearCurrentSelection(defaultProject, true);

    const snapshot = getAssetSelectionSnapshot(defaultProject);
    expect(snapshot.current.items).toEqual([]);
    expect(snapshot.current.id).toBe(`${defaultProject}:current:current`);
  });

  it('creates a review set with stable labels and mirrors chosen labels to current selections', () => {
    const created = createReviewSet(defaultProject, {
      assetIds: [assetA, assetB, assetC, assetD],
      confirmWrite: true,
      key: 'stable-variations',
      label: 'Stable variations',
    });

    expect(created.review_set?.items.map(item => [item.variation_label, item.asset_id])).toEqual([
      ['A', assetA],
      ['B', assetB],
      ['C', assetC],
      ['D', assetD],
    ]);

    const result = chooseReviewSetLabels(defaultProject, {
      confirmWrite: true,
      labels: ['B', 'D'],
      notes: 'user liked B and D',
      selectedBy: 'human',
      setId: created.review_set?.id,
    });

    expect(result.current?.items.map(item => [item.variation_label, item.asset_id])).toEqual([
      ['B', assetB],
      ['D', assetD],
    ]);
    expect(result.review_set?.items.filter(item => item.selected_at).map(item => item.variation_label)).toEqual(['B', 'D']);
  });

  it('returns a dry-run preview without writing choices', () => {
    createReviewSet(defaultProject, {
      assetIds: [assetA, assetB],
      confirmWrite: true,
      key: 'dry-run-variations',
      label: 'Dry run variations',
    });
    const preview = chooseReviewSetLabels(defaultProject, { confirmWrite: false, labels: ['B'] });

    expect(preview).toMatchObject({
      dryRun: true,
      preview: { selected_assets: [assetB] },
    });
    expect(getAssetSelectionSnapshot(defaultProject).current.items).toEqual([]);
  });

  it('requires an explicit review set when more than one active set exists', () => {
    createReviewSet(defaultProject, {
      assetIds: [assetA, assetB],
      confirmWrite: true,
      key: 'first-variations',
      label: 'First variations',
    });
    createReviewSet(defaultProject, {
      assetIds: [assetC, assetD],
      confirmWrite: true,
      key: 'second-variations',
      label: 'Second variations',
    });

    expect(() => chooseReviewSetLabels(defaultProject, { confirmWrite: true, labels: ['B'] }))
      .toThrow('Multiple active review sets');
  });

  it('archives and activates review sets by explicit id', () => {
    const first = createReviewSet(defaultProject, {
      assetIds: [assetA, assetB],
      confirmWrite: true,
      key: 'first-managed',
      label: 'First managed',
    }).review_set!;
    const second = createReviewSet(defaultProject, {
      assetIds: [assetC, assetD],
      confirmWrite: true,
      key: 'second-managed',
      label: 'Second managed',
    }).review_set!;

    expect(listReviewSets(defaultProject).map(set => set.id)).toEqual([second.id, first.id]);
    expect(archiveReviewSet(defaultProject, second.id, true).review_set!.status).toBe('archived');
    expect(() => chooseReviewSetLabels(defaultProject, { confirmWrite: true, labels: ['B'], setId: second.id }))
      .toThrow('Unknown active review set');

    const activated = activateReviewSet(defaultProject, second.id, true);
    expect(activated.review_set!.status).toBe('active');
    expect(inspectReviewSet(defaultProject, first.id).status).toBe('archived');
    expect(chooseReviewSetLabels(defaultProject, { confirmWrite: true, labels: ['B'], setId: second.id }).current?.items[0]?.asset_id).toBe(assetD);
  });
});
