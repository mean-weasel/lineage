import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLineageTestProfile } from '../test/lineageTestProfile';
import { defaultProject, repoRoot } from './assetCore';
import { getContentBatch } from './contentBatches';
import { importDemoContentBatch } from './contentBatchImport';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-content-import');
const dbFile = join(scratchDir, 'content-import.sqlite');

describe('content batch markdown import', () => {
  beforeEach(() => {
    rmSync(scratchDir, { force: true, recursive: true });
    useLineageTestProfile(dbFile);
    process.env.LINEAGE_CONTENT_SOURCE_ROOT = join(scratchDir, 'missing-content-source');
  });

  it('previews demo markdown import without creating sqlite', () => {
    rmSync(dbFile, { force: true });
    const result = importDemoContentBatch(defaultProject, {
      batchId: 'preview-import',
      confirmWrite: false,
      kind: 'all',
    });

    expect(result).toMatchObject({ dryRun: true });
    expect(result.counts.concepts).toBe(0);
    expect(result.counts.drafts).toBe(0);
    expect(result.counts.total).toBe(result.counts.concepts + result.counts.drafts);
    expect(result.items).toEqual([]);
    expect(existsSync(dbFile)).toBe(false);
  });

  it('creates an empty batch when public demo markdown fixtures are not present yet', () => {
    const result = importDemoContentBatch(defaultProject, {
      batchId: 'draft-import',
      confirmWrite: true,
      kind: 'drafts',
      title: 'Imported demo drafts',
    });
    const detail = getContentBatch(defaultProject, 'draft-import');

    expect(result.counts.drafts).toBe(0);
    expect(result.counts.total).toBe(result.counts.drafts);
    expect(detail.batch.title).toBe('Imported demo drafts');
    expect(detail.posts).toHaveLength(0);
  });

  it('imports markdown from an explicit content source root', () => {
    const sourceRoot = join(scratchDir, 'source', 'channels');
    const draftDir = join(sourceRoot, 'meta', 'drafts');
    mkdirSync(draftDir, { recursive: true });
    process.env.LINEAGE_CONTENT_SOURCE_ROOT = sourceRoot;
    writeFileSync(join(draftDir, '2026-07-saveable-static.md'), [
      '# Saveable Static Proof Card',
      '- Channel: meta',
      '- Campaign: 2026-07-public-static-test',
      '- Status: review',
      '- CTA: Save the checklist',
      '- Related asset: demo-meta-short-form-upload-demo-post-static',
      '',
      'Primary text: A reusable vertical static concept with proof, contrast, and a save-worthy CTA.',
      '',
    ].join('\n'));

    const result = importDemoContentBatch(defaultProject, {
      batchId: 'explicit-source-import',
      confirmWrite: true,
      kind: 'drafts',
      title: 'Explicit source import',
    });
    const detail = getContentBatch(defaultProject, 'explicit-source-import');

    expect(result.counts).toMatchObject({ attached: 1, drafts: 1, total: 1 });
    expect(detail.posts).toHaveLength(1);
    expect(detail.posts[0]).toMatchObject({
      campaign: '2026-07-public-static-test',
      channel: 'meta',
      cta: 'Save the checklist',
      phase: 'review',
      title: 'Saveable Static Proof Card',
    });
    expect(detail.posts[0].assets).toEqual([
      expect.objectContaining({
        asset_id: 'demo-meta-short-form-upload-demo-post-static',
        role: 'related',
      }),
    ]);
  });
});
