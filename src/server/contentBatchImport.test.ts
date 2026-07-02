import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultProject, repoRoot } from './assetCore';
import { getContentBatch } from './contentBatches';
import { importDemoContentBatch } from './contentBatchImport';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-content-import');
const dbFile = join(scratchDir, 'content-import.sqlite');

describe('content batch markdown import', () => {
  beforeEach(() => {
    rmSync(scratchDir, { force: true, recursive: true });
    process.env.LINEAGE_DB = dbFile;
  });

  it('previews demo markdown import without creating sqlite', () => {
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
});
