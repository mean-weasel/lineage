import { existsSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { contentTypeFor, fileSha256 } from '../../localReview';
import type { AssetCatalog, LiveS3Object, MutationResponse, PresignResponse } from '../../../shared/types';
import type { StorageAdapter, StorageAdapterDependencies } from './types';

export function parseAssetIdFromS3Key(key: string): string | undefined {
  const marker = '/assets/';
  const index = key.indexOf(marker);
  if (index === -1) return undefined;
  return key.slice(index + marker.length).split('/')[0];
}

export function createS3StorageAdapter(deps: StorageAdapterDependencies): StorageAdapter {
  return {
    deleteObjectGuarded(project, assetId, confirmation): MutationResponse {
      const enabled = process.env.GROWTH_ASSETS_ENABLE_S3_DELETE === 'true';
      if (!enabled) {
        throw deps.createError('S3 delete is disabled. Use archive unless a human enables GROWTH_ASSETS_ENABLE_S3_DELETE.', 403);
      }
      if (confirmation !== `delete ${assetId}`) {
        throw deps.createError(`Delete confirmation must exactly equal: delete ${assetId}`);
      }
      const catalog = deps.loadCatalog(project);
      const asset = deps.assetById(catalog, assetId);
      if (!asset.s3) throw deps.createError(`Asset has no S3 object: ${assetId}`);
      deps.runAws(['s3api', 'delete-object', '--bucket', asset.s3.bucket, '--key', asset.s3.key, '--region', asset.s3.region]);
      asset.status = 'archived';
      deps.saveCatalog(project, catalog);
      return { ok: true, message: `Deleted current S3 object and archived ${assetId}`, catalog };
    },

    getIdentity() {
      try {
        const output = deps.runAws(['sts', 'get-caller-identity', '--query', '{Account:Account,Arn:Arn}', '--output', 'json']);
        const parsed = JSON.parse(output.stdout) as { Account: string; Arn: string };
        return { account: parsed.Account, arn: parsed.Arn };
      } catch {
        return undefined;
      }
    },

    listLiveObjects(catalog: AssetCatalog): LiveS3Object[] {
      const bucket = catalog.default_bucket;
      const region = catalog.default_region;
      // Existing uploaded objects live under products/<project>; do not rewrite keys during project migration.
      const prefix = `products/${catalog.product}/`;
      const output = deps.runAws(['s3api', 'list-objects-v2', '--bucket', bucket, '--prefix', prefix, '--region', region, '--output', 'json']);
      const parsed = JSON.parse(output.stdout) as {
        Contents?: Array<{ Key: string; Size: number; LastModified: string; StorageClass?: string }>;
      };
      const catalogKeys = new Set(catalog.assets.map(asset => asset.s3?.key).filter(Boolean));
      return (parsed.Contents || []).map(item => ({
        key: item.Key,
        size: item.Size,
        lastModified: item.LastModified,
        storageClass: item.StorageClass,
        cataloged: catalogKeys.has(item.Key),
        assetId: parseAssetIdFromS3Key(item.Key),
      }));
    },

    presignAsset(project, assetId, expiresIn = 900): PresignResponse {
      const output = deps.runAssetScript('presign', ['--project', deps.cleanProject(project), '--asset-id', assetId, '--expires-in', String(expiresIn)], true);
      return { assetId, expiresIn, url: output.stdout.trim() };
    },

    promoteAsset(project, assetId, confirmWrite): MutationResponse {
      if (!confirmWrite) throw deps.createError('Promote requires confirmWrite=true');
      const output = deps.runAssetScript('promote', ['--project', deps.cleanProject(project), '--asset-id', assetId, '--confirm-write'], true);
      return {
        ok: true,
        message: `Promoted ${assetId}`,
        output: JSON.parse(output.stdout || '{}'),
        catalog: deps.loadCatalog(project),
      };
    },

    pullAsset(project, assetId, out = '.asset-scratch'): MutationResponse {
      const output = deps.runAssetScript('pull', ['--project', deps.cleanProject(project), '--asset-id', assetId, '--out', out], true);
      return { ok: true, message: output.stdout.trim() || `Pulled ${assetId}` };
    },

    uploadAsset(file, fields): MutationResponse {
      if (!fields.confirmWrite) throw deps.createError('Upload requires confirmWrite=true');
      if (!existsSync(file)) throw deps.createError(`Upload file missing: ${file}`, 404);
      if (!['working', 'published'].includes(fields.status)) throw deps.createError('Upload status must be working or published');
      if (!deps.supportedContentTypes.has(fields.type)) throw deps.createError(`Unsupported asset type: ${fields.type}`);

      const project = deps.cleanProject(fields.project || fields.product || deps.defaultProject);
      const args = [
        '--project', project, '--file', file, '--campaign', fields.campaign, '--channel', fields.channel, '--audience', fields.audience,
        '--status', fields.status, '--type', fields.type, '--asset-id', fields.assetId, '--title', fields.title, '--hook', fields.hook,
        '--cta', fields.cta, '--utm-content', fields.utmContent,
        '--confirm-write',
      ];
      if (fields.messageFamily) args.push('--message-family', fields.messageFamily);
      if (fields.format) args.push('--format', fields.format);
      if (fields.notes) args.push('--notes', fields.notes);

      const output = deps.runAssetScript('upload', args, true);
      const uploaded = JSON.parse(output.stdout || '{}') as unknown;
      return {
        ok: true,
        message: `Uploaded ${fields.assetId}`,
        output: {
          uploaded,
          file: basename(file),
          sizeBytes: statSync(file).size,
          contentType: contentTypeFor(file),
          checksumSha256: fileSha256(file),
        },
        catalog: deps.loadCatalog(project),
      };
    },
  };
}
