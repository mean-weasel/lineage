import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultProject, repoRoot } from './assetCore';
import { getContentBatch } from './contentBatches';
import { importBleepContentBatch } from './contentBatchImport';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-content-import');
const dbFile = join(scratchDir, 'content-import.sqlite');

describe('content batch markdown import', () => {
  beforeEach(() => {
    rmSync(scratchDir, { force: true, recursive: true });
    process.env.ASSET_STUDIO_DB = dbFile;
  });

  it('previews bleep markdown import without creating sqlite', () => {
    const result = importBleepContentBatch(defaultProject, {
      batchId: 'preview-import',
      confirmWrite: false,
      kind: 'all',
    });

    expect(result).toMatchObject({ dryRun: true });
    expect(result.counts.concepts).toBeGreaterThanOrEqual(50);
    expect(result.counts.drafts).toBeGreaterThanOrEqual(10);
    expect(result.counts.total).toBe(result.counts.concepts + result.counts.drafts);
    expect(result.items.some(item => item.source_path.includes('/drafts/'))).toBe(true);
    expect(result.items.some(item => item.source_path.includes('/concepts/'))).toBe(true);
    expect(existsSync(dbFile)).toBe(false);
  });

  it('imports draft markdown into a content batch with related assets', () => {
    const result = importBleepContentBatch(defaultProject, {
      batchId: 'draft-import',
      confirmWrite: true,
      kind: 'drafts',
      title: 'Imported bleep drafts',
    });
    const detail = getContentBatch(defaultProject, 'draft-import');
    const tiktok = detail.posts.find(post => post.id === 'draft-tiktok-upload-bleep-export');

    expect(result.counts.drafts).toBeGreaterThanOrEqual(10);
    expect(result.counts.total).toBe(result.counts.drafts);
    expect(detail.batch.title).toBe('Imported bleep drafts');
    expect(detail.posts.length).toBe(result.counts.drafts);
    expect(tiktok).toMatchObject({
      assets: [{ asset_id: 'bleep-tiktok-upload-bleep-export-vertical', role: 'related' }],
      channel: 'tiktok',
      phase: 'draft',
      source_path: 'bleep-that-shit/channels/tiktok/drafts/2026-06-tiktok-upload-bleep-export.md',
    });
  });
});
