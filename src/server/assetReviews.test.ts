import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultProject, listAssets, repoRoot } from './assetCore';
import { fileSha256 } from './localReview';
import { getAssetReviewMap, isAssetReviewError, markAssetReview, markAssetReviews, markAssetReviewsFromRequestBody, requireApprovedLocalBackupPath } from './assetReviews';
import { handleLocalCli } from '../../scripts/asset-studio-local-cli';
import type { ReviewableAsset } from '../shared/types';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-local-review-decisions');
const dbFile = join(scratchDir, 'asset-lineage.sqlite');

function localId(file: string): string {
  return `local-${fileSha256(file).slice(0, 12)}`;
}

function seedLocalAsset() {
  rmSync(scratchDir, { force: true, recursive: true });
  mkdirSync(scratchDir, { recursive: true });
  const file = join(scratchDir, 'bleep-tiktok-local-review-decision.png');
  writeFileSync(file, Buffer.from('local-review-decision'));
  return { file, assetId: localId(file) };
}

function seedLocalAssets() {
  rmSync(scratchDir, { force: true, recursive: true });
  mkdirSync(scratchDir, { recursive: true });
  const files = [
    join(scratchDir, 'bleep-tiktok-local-review-batch-one.png'),
    join(scratchDir, 'bleep-tiktok-local-review-batch-two.png'),
  ];
  files.forEach((file, index) => writeFileSync(file, Buffer.from(`local-review-batch-${index}`)));
  return files.map(file => ({ file, assetId: localId(file) }));
}

describe('asset review helpers', () => {
  beforeEach(() => {
    process.env.ASSET_STUDIO_DB = dbFile;
  });

  it('indexes local assets and returns their review state', () => {
    const { assetId } = seedLocalAsset();

    const reviews = getAssetReviewMap(defaultProject, [assetId]);

    expect(reviews[assetId]).toMatchObject({ review_state: 'unreviewed' });
    expect(reviews[assetId].ignored_at).toBeUndefined();
    expect(reviews[assetId].notes).toBeUndefined();
    expect(reviews[assetId].reviewed_at).toBeUndefined();
  });

  it('marks a local asset approved with notes', () => {
    const { assetId } = seedLocalAsset();

    const result = markAssetReview(defaultProject, {
      assetId,
      confirmWrite: true,
      notes: 'Good enough to back up.',
      reviewState: 'approved',
    });
    const reviews = getAssetReviewMap(defaultProject, [assetId]);

    expect(result.message).toBe(`Marked ${assetId} approved`);
    expect(reviews[assetId]).toMatchObject({
      notes: 'Good enough to back up.',
      review_state: 'approved',
    });
  });

  it('previews a batch local review without mutating sqlite', () => {
    const assets = seedLocalAssets();

    const result = markAssetReviews(defaultProject, {
      assetIds: assets.map(asset => asset.assetId),
      confirmWrite: false,
      notes: 'Batch note replaces previous notes.',
      reviewState: 'needs_revision',
    });

    expect(result).toMatchObject({
      dryRun: true,
      count: 2,
      notes: 'Batch note replaces previous notes.',
      review_state: 'needs_revision',
    });
    expect(result.results.map(item => item.asset_id)).toEqual(assets.map(asset => asset.assetId));
    expect(existsSync(dbFile)).toBe(false);
  });

  it('lets CLI batch dry-run win over confirm-write', () => {
    const assets = seedLocalAssets();
    const output: unknown[] = [];

    const handled = handleLocalCli('local', {
      _: ['review-batch'],
      'asset-ids': assets.map(asset => asset.assetId).join(','),
      'confirm-write': true,
      'dry-run': true,
      notes: 'No write should happen.',
      state: 'approved',
    }, defaultProject, {
      boolArg: (args, key) => args[key] === true || args[key] === 'true',
      printJson: value => output.push(value),
      textArg: (args, key, fallback = '') => (typeof args[key] === 'string' ? args[key] : fallback),
    });

    expect(handled).toBe(true);
    expect(output[0]).toMatchObject({ dryRun: true, result: { count: 2, dryRun: true } });
    expect(existsSync(dbFile)).toBe(false);
  });

  it('returns a local backup queue with review counts from the CLI', () => {
    const { assetId } = seedLocalAsset();
    const output: unknown[] = [];

    const handled = handleLocalCli('local', { _: ['queue'], json: true, q: assetId }, defaultProject, {
      boolArg: (args, key) => args[key] === true || args[key] === 'true',
      printJson: value => output.push(value),
      textArg: (args, key, fallback = '') => (typeof args[key] === 'string' ? args[key] : fallback),
    });

    expect(handled).toBe(true);
    expect(output[0]).toMatchObject({
      backupQueue: { approved: 0, localOnly: 1, needsReview: 1 },
      command: 'local queue',
      ok: true,
    });
    expect((output[0] as { assets: ReviewableAsset[] }).assets[0]).toMatchObject({
      asset_id: assetId,
      review: { review_state: 'unreviewed' },
    });
  }, 10_000);

  it('marks a batch with shared replacement notes', () => {
    const assets = seedLocalAssets();

    markAssetReviews(defaultProject, {
      assetIds: assets.map(asset => asset.assetId),
      confirmWrite: true,
      notes: 'First batch note.',
      reviewState: 'approved',
    });
    const result = markAssetReviews(defaultProject, {
      assetIds: assets.map(asset => asset.assetId),
      confirmWrite: true,
      notes: 'Replacement batch note.',
      reviewState: 'rejected',
    });
    const reviews = getAssetReviewMap(defaultProject, assets.map(asset => asset.assetId));

    expect(result).toMatchObject({
      count: 2,
      message: 'Marked 2 local assets rejected',
      notes: 'Replacement batch note.',
      review_state: 'rejected',
    });
    for (const asset of assets) {
      expect(reviews[asset.assetId]).toMatchObject({
        notes: 'Replacement batch note.',
        review_state: 'rejected',
      });
    }
  });

  it('rejects malformed batch request asset ids without mutating sqlite', () => {
    const assets = seedLocalAssets();

    expect(() =>
      markAssetReviewsFromRequestBody(defaultProject, {
        assetIds: [assets[0].assetId, 12],
        confirmWrite: true,
        reviewState: 'approved',
      })
    ).toThrow('Batch local review assetIds must be strings');
    expect(existsSync(dbFile)).toBe(false);
  });

  it('rejects missing batch request asset id arrays without mutating sqlite', () => {
    seedLocalAssets();

    expect(() =>
      markAssetReviewsFromRequestBody(defaultProject, {
        assetIds: 'local-one,local-two',
        confirmWrite: true,
        reviewState: 'approved',
      })
    ).toThrow('Batch local review requires assetIds array');
    expect(existsSync(dbFile)).toBe(false);
  });

  it('requires approved review state before server local backup writes', () => {
    const { assetId } = seedLocalAsset();
    const relativePath = 'vitest-local-review-decisions/bleep-tiktok-local-review-decision.png';

    try {
      requireApprovedLocalBackupPath(defaultProject, relativePath);
      throw new Error('Expected local backup approval gate to throw');
    } catch (error) {
      expect(isAssetReviewError(error)).toBe(true);
      expect(error).toMatchObject({ message: `Local backup requires approved local review for ${assetId}`, status: 403 });
    }

    markAssetReview(defaultProject, {
      assetId,
      confirmWrite: true,
      notes: 'Approved for backup.',
      reviewState: 'approved',
    });

    expect(requireApprovedLocalBackupPath(defaultProject, relativePath).asset_id).toBe(assetId);
  });

  it('requires approved review state before CLI local backup writes', () => {
    const { assetId } = seedLocalAsset();
    const output: unknown[] = [];

    expect(() =>
      handleLocalCli('local', {
        _: ['backup'],
        'asset-id': assetId,
        'backup-asset-id': 'approved-backup-target',
        'confirm-write': true,
      }, defaultProject, {
        boolArg: (args, key) => args[key] === true || args[key] === 'true',
        printJson: value => output.push(value),
        textArg: (args, key, fallback = '') => (typeof args[key] === 'string' ? args[key] : fallback),
      })
    ).toThrow(`Local backup requires approved local review for ${assetId}`);
    expect(output).toEqual([]);
  });

  it('still previews CLI local backup dry-runs before approval', () => {
    const { assetId } = seedLocalAsset();
    const output: unknown[] = [];

    const handled = handleLocalCli('local', {
      _: ['backup'],
      'asset-id': assetId,
      'backup-asset-id': 'dry-run-backup-target',
      'dry-run': true,
    }, defaultProject, {
      boolArg: (args, key) => args[key] === true || args[key] === 'true',
      printJson: value => output.push(value),
      textArg: (args, key, fallback = '') => (typeof args[key] === 'string' ? args[key] : fallback),
    });

    expect(handled).toBe(true);
    expect(output[0]).toMatchObject({ dryRun: true, preview: { local_asset: { asset_id: assetId } } });
    expect(listAssets(defaultProject, { page: 1, pageSize: 100, query: assetId, source: 'local' }).assets.some(asset => asset.asset_id === assetId)).toBe(true);
  });
});
