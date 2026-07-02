import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { contentTypeFor, fileSha256 } from '../../localReview';
import type { AssetCatalog, LiveS3Object, MutationResponse, PresignResponse } from '../../../shared/types';
import type { StorageAdapter, StorageAdapterDependencies } from './types';

export function parseAssetIdFromS3Key(key: string): string | undefined {
  const marker = '/assets/';
  const index = key.indexOf(marker);
  if (index === -1) return undefined;
  return key.slice(index + marker.length).split('/')[0];
}

function previewDataUrl(asset: { asset_id: string; channel?: string; status?: string; title?: string }): string {
  const title = asset.title || asset.asset_id;
  const label = `${asset.channel || 'catalog'} / ${asset.status || 'working'}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><rect width="1200" height="675" fill="#f7f5ef"/><rect x="56" y="56" width="1088" height="563" rx="18" fill="#10201c"/><text x="96" y="145" fill="#9fe6c8" font-family="Arial, sans-serif" font-size="34" font-weight="700">Lineage catalog preview</text><text x="96" y="230" fill="#fff8e6" font-family="Arial, sans-serif" font-size="56" font-weight="700">${escapeSvgText(asset.asset_id)}</text><text x="96" y="330" fill="#d9e8df" font-family="Arial, sans-serif" font-size="34">${escapeSvgText(title)}</text><text x="96" y="500" fill="#9fb7ae" font-family="Arial, sans-serif" font-size="26">${escapeSvgText(label)}. No external storage requested.</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function createS3StorageAdapter(deps: StorageAdapterDependencies): StorageAdapter {
  return {
    deleteObjectGuarded(project, assetId, confirmation): MutationResponse {
      const enabled = process.env.LINEAGE_ENABLE_CLOUD_DELETE === 'true';
      if (!enabled) {
        throw deps.createError('S3 delete is disabled. Use archive unless a human enables LINEAGE_ENABLE_CLOUD_DELETE.', 403);
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
      const catalog = deps.loadCatalog(project);
      const asset = deps.assetById(catalog, assetId);
      return { assetId, expiresIn, url: previewDataUrl(asset) };
    },

    promoteAsset(project, assetId, confirmWrite): MutationResponse {
      if (!confirmWrite) throw deps.createError('Promote requires confirmWrite=true');
      const catalog = deps.loadCatalog(project);
      const asset = deps.assetById(catalog, assetId);
      asset.status = 'published';
      deps.saveCatalog(project, catalog);
      return {
        ok: true,
        message: `Promoted ${assetId}`,
        catalog,
      };
    },

    pullAsset(project, assetId, out = '.asset-scratch'): MutationResponse {
      const catalog = deps.loadCatalog(project);
      const asset = deps.assetById(catalog, assetId);
      return {
        ok: true,
        message: `Prepared ${assetId} for local review`,
        output: {
          assetId: asset.asset_id,
          out,
          storage: asset.local ? 'local' : asset.s3 ? 'catalog-s3-metadata' : 'catalog',
          note: 'Lineage public package does not pull cloud objects automatically.',
        },
      };
    },

    uploadAsset(file, fields): MutationResponse {
      if (!fields.confirmWrite) throw deps.createError('Upload requires confirmWrite=true');
      if (!existsSync(file)) throw deps.createError(`Upload file missing: ${file}`, 404);
      if (!['working', 'published'].includes(fields.status)) throw deps.createError('Upload status must be working or published');
      if (!deps.supportedContentTypes.has(fields.type)) throw deps.createError(`Unsupported asset type: ${fields.type}`);

      const project = deps.cleanProject(fields.project || fields.product || deps.defaultProject);
      const catalog = deps.loadCatalog(project);
      const relativePath = join('uploads', project, fields.assetId, basename(file));
      const absolutePath = join(deps.repoRoot, '.asset-scratch', relativePath);
      mkdirSync(dirname(absolutePath), { recursive: true });
      copyFileSync(file, absolutePath);
      const stats = statSync(absolutePath);
      const contentType = contentTypeFor(absolutePath);
      const checksumSha256 = fileSha256(absolutePath);
      const now = new Date().toISOString();
      const nextAsset = {
        asset_id: fields.assetId,
        audience: fields.audience,
        campaign: fields.campaign,
        channel: fields.channel,
        content_type: fields.type,
        cta: fields.cta,
        hook: fields.hook,
        ...(fields.format ? { format: fields.format } : {}),
        local: {
          absolute_path: absolutePath,
          checksum_sha256: checksumSha256,
          content_type: contentType,
          relative_path: relativePath,
          size_bytes: stats.size,
          updated_at: now,
        },
        ...(fields.messageFamily ? { message_family: fields.messageFamily } : {}),
        ...(fields.notes ? { notes: fields.notes } : {}),
        product: project,
        project,
        source: 'catalog' as const,
        status: fields.status,
        title: fields.title,
        utm_content: fields.utmContent,
      };
      const existing = catalog.assets.findIndex(asset => asset.asset_id === fields.assetId);
      if (existing >= 0) catalog.assets[existing] = { ...catalog.assets[existing], ...nextAsset };
      else catalog.assets.push(nextAsset);
      deps.saveCatalog(project, catalog);
      return {
        ok: true,
        message: `Recorded ${fields.assetId} locally`,
        output: {
          file: basename(absolutePath),
          relativePath,
          sizeBytes: stats.size,
          contentType,
          checksumSha256,
        },
        catalog,
      };
    },
  };
}
