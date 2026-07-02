import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { repoRoot } from '../../assetCore';
import { createS3StorageAdapter, parseAssetIdFromS3Key } from './s3StorageAdapter';
import type { AssetCatalog, AssetContentType, GrowthAsset, UploadFields } from '../../../shared/types';
import type { StorageAdapterDependencies } from './types';

const baseAsset: GrowthAsset = {
  asset_id: 'asset-001',
  audience: 'founders',
  campaign: 'adapter-test',
  channel: 'linkedin',
  content_type: 'image',
  cta: 'Try it',
  hook: 'Adapter hook',
  product: 'adapter-project',
  project: 'adapter-project',
  status: 'working',
  title: 'Adapter asset',
  utm_content: 'adapter_asset',
  s3: {
    bucket: 'asset-bucket',
    key: 'products/adapter-project/campaigns/adapter-test/channels/linkedin/audiences/founders/statuses/working/types/image/assets/asset-001/asset.png',
    region: 'us-east-1',
    version_id: 'v1',
  },
};

function catalog(asset: GrowthAsset = baseAsset): AssetCatalog {
  return {
    assets: [{ ...asset, s3: asset.s3 ? { ...asset.s3 } : undefined }],
    default_bucket: 'asset-bucket',
    default_region: 'us-east-1',
    product: 'adapter-project',
    project: 'adapter-project',
  };
}

function createDeps(overrides: Partial<StorageAdapterDependencies> = {}) {
  let currentCatalog = catalog();
  const calls: Array<{ args: string[]; kind: 'aws' }> = [];
  const deps: StorageAdapterDependencies = {
    assetById: (assetCatalog, assetId) => {
      const asset = assetCatalog.assets.find(item => item.asset_id === assetId);
      if (!asset) throw new Error(`Unknown asset: ${assetId}`);
      return asset;
    },
    cleanProject: project => {
      if (!project || !/^[a-z0-9][a-z0-9-]*$/.test(project)) throw new Error('Project must be lowercase kebab-case');
      return project;
    },
    createError: (message, status) => Object.assign(new Error(message), { status }),
    defaultProject: 'adapter-project',
    loadCatalog: () => currentCatalog,
    runAws: args => {
      calls.push({ args, kind: 'aws' });
      if (args[0] === 'sts') {
        return { stdout: JSON.stringify({ Account: '123456789012', Arn: 'arn:aws:iam::123456789012:user/tester' }), stderr: '' };
      }
      return {
        stdout: JSON.stringify({
          Contents: [
            { Key: baseAsset.s3!.key, LastModified: '2026-06-01T00:00:00.000Z', Size: 123, StorageClass: 'STANDARD' },
            { Key: 'products/adapter-project/campaigns/x/channels/linkedin/audiences/y/statuses/working/types/image/assets/orphan-001/orphan.png', LastModified: '2026-06-02T00:00:00.000Z', Size: 456 },
          ],
        }),
        stderr: '',
      };
    },
    repoRoot,
    saveCatalog: (_project, nextCatalog) => {
      currentCatalog = nextCatalog;
      return currentCatalog;
    },
    supportedContentTypes: new Set<AssetContentType>(['image', 'video', 'gif', 'audio', 'doc', 'other']),
    ...overrides,
  };
  return { adapter: createS3StorageAdapter(deps), calls, getCatalog: () => currentCatalog };
}

describe('s3 storage adapter', () => {
  const previousDeleteFlag = process.env.LINEAGE_ENABLE_CLOUD_DELETE;

  beforeEach(() => {
    delete process.env.LINEAGE_ENABLE_CLOUD_DELETE;
  });

  afterEach(() => {
    if (previousDeleteFlag === undefined) delete process.env.LINEAGE_ENABLE_CLOUD_DELETE;
    else process.env.LINEAGE_ENABLE_CLOUD_DELETE = previousDeleteFlag;
  });

  it('parses asset ids from existing S3 key shape', () => {
    expect(parseAssetIdFromS3Key(baseAsset.s3!.key)).toBe('asset-001');
    expect(parseAssetIdFromS3Key('products/no-assets-marker/file.png')).toBeUndefined();
  });

  it('lists live S3 objects with catalog and orphan metadata', () => {
    const { adapter, calls } = createDeps();
    const objects = adapter.listLiveObjects(catalog());

    expect(calls[0]).toEqual({
      args: ['s3api', 'list-objects-v2', '--bucket', 'asset-bucket', '--prefix', 'products/adapter-project/', '--region', 'us-east-1', '--output', 'json'],
      kind: 'aws',
    });
    expect(objects).toEqual([
      expect.objectContaining({ assetId: 'asset-001', cataloged: true, key: baseAsset.s3!.key, size: 123 }),
      expect.objectContaining({ assetId: 'orphan-001', cataloged: false, size: 456 }),
    ]);
  });

  it('returns identity and hides identity failures', () => {
    const ok = createDeps();
    expect(ok.adapter.getIdentity()).toEqual({ account: '123456789012', arn: 'arn:aws:iam::123456789012:user/tester' });

    const failing = createDeps({ runAws: () => { throw new Error('missing aws'); } });
    expect(failing.adapter.getIdentity()).toBeUndefined();
  });

  it('previews and prepares catalog assets without external storage commands', () => {
    const { adapter, calls } = createDeps();

    expect(adapter.pullAsset('adapter-project', 'asset-001', '.asset-scratch/out')).toMatchObject({
      ok: true,
      message: 'Prepared asset-001 for local review',
      output: { assetId: 'asset-001', out: '.asset-scratch/out', storage: 'catalog-s3-metadata' },
    });
    const preview = adapter.presignAsset('adapter-project', 'asset-001', 600);

    expect(preview).toMatchObject({ assetId: 'asset-001', expiresIn: 600 });
    expect(preview.url).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(calls).toEqual([]);
  });

  it('keeps promote confirmation and updates the catalog locally', () => {
    const { adapter, calls, getCatalog } = createDeps();

    expect(() => adapter.promoteAsset('adapter-project', 'asset-001', false)).toThrow('Promote requires confirmWrite=true');
    expect(adapter.promoteAsset('adapter-project', 'asset-001', true)).toMatchObject({
      message: 'Promoted asset-001',
      ok: true,
    });
    expect(getCatalog().assets[0].status).toBe('published');
    expect(calls).toEqual([]);
  });

  it('validates upload fields and records the upload in the local catalog', () => {
    const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-s3-adapter');
    const file = join(scratchDir, 'upload.png');
    rmSync(scratchDir, { force: true, recursive: true });
    mkdirSync(scratchDir, { recursive: true });
    writeFileSync(file, Buffer.from('adapter-upload'));
    const { adapter, calls, getCatalog } = createDeps();
    const fields: UploadFields = {
      assetId: 'asset-001',
      audience: 'founders',
      campaign: 'adapter-test',
      channel: 'linkedin',
      confirmWrite: true,
      cta: 'Try it',
      format: 'square',
      hook: 'Hook',
      messageFamily: 'workflow',
      notes: 'adapter note',
      status: 'working',
      title: 'Adapter upload',
      type: 'image',
      utmContent: 'adapter_upload',
    };

    try {
      expect(() => adapter.uploadAsset(file, { ...fields, confirmWrite: false })).toThrow('Upload requires confirmWrite=true');
      const result = adapter.uploadAsset(file, fields);

      expect(result).toMatchObject({
        message: 'Recorded asset-001 locally',
        ok: true,
        output: {
          contentType: 'image/png',
          file: 'upload.png',
          relativePath: join('uploads', 'adapter-project', 'asset-001', 'upload.png'),
          sizeBytes: Buffer.byteLength('adapter-upload'),
        },
      });
      expect((result.output as { checksumSha256?: string }).checksumSha256).toHaveLength(64);
      expect(getCatalog().assets[0]).toMatchObject({
        asset_id: 'asset-001',
        format: 'square',
        local: {
          content_type: 'image/png',
          relative_path: join('uploads', 'adapter-project', 'asset-001', 'upload.png'),
          size_bytes: Buffer.byteLength('adapter-upload'),
        },
        message_family: 'workflow',
        notes: 'adapter note',
        title: 'Adapter upload',
      });
      expect(calls).toEqual([]);
    } finally {
      rmSync(scratchDir, { force: true, recursive: true });
      rmSync(join(repoRoot, '.asset-scratch', 'uploads', 'adapter-project'), { force: true, recursive: true });
    }
  });

  it('keeps delete disabled by default and archives catalog only after exact confirmation', () => {
    const { adapter, calls, getCatalog } = createDeps();

    expect(() => adapter.deleteObjectGuarded('adapter-project', 'asset-001', 'delete asset-001')).toThrow('S3 delete is disabled');
    process.env.LINEAGE_ENABLE_CLOUD_DELETE = 'true';
    expect(() => adapter.deleteObjectGuarded('adapter-project', 'asset-001', 'delete wrong')).toThrow('Delete confirmation must exactly equal: delete asset-001');

    const result = adapter.deleteObjectGuarded('adapter-project', 'asset-001', 'delete asset-001');

    expect(result).toMatchObject({ ok: true, message: 'Deleted current S3 object and archived asset-001' });
    expect(getCatalog().assets[0].status).toBe('archived');
    expect(calls).toContainEqual({
      args: ['s3api', 'delete-object', '--bucket', 'asset-bucket', '--key', baseAsset.s3!.key, '--region', 'us-east-1'],
      kind: 'aws',
    });
  });
});
