import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import type { AssetCatalog, AssetContentType, GrowthAsset } from '../shared/types';

const mimeByExt: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};
const localReviewExts = new Set(Object.keys(mimeByExt));
const channelFromName = /\b(linkedin|meta|tiktok|youtube|x-twitter|x)\b/i;
const campaignFromPath = /\b(20\d{2}-\d{2}-[a-z0-9-]+)\b/i;

class LocalReviewError extends Error {
  status = 400;
}

function localReviewRoot(repoRoot: string): string {
  return join(repoRoot, '.asset-scratch');
}

export function contentTypeFor(file: string): string {
  return mimeByExt[extname(file).toLowerCase()] || 'application/octet-stream';
}

export function fileSha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function isPathInside(child: string, parent: string): boolean {
  const relativePath = relative(parent, child);
  return Boolean(relativePath) && !relativePath.startsWith('..') && !relativePath.startsWith('/');
}

function walkLocalReviewFiles(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return files;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'studio-uploads' || entry.name === 'playwright-results' || entry.name === 'lineage-demo') continue;
    if (process.env.NODE_ENV !== 'test' && /^vitest-/.test(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkLocalReviewFiles(path, files);
    else if (entry.isFile() && localReviewExts.has(extname(entry.name).toLowerCase())) files.push(path);
  }
  return files;
}

function inferCampaign(relativePath: string): string {
  return campaignFromPath.exec(relativePath)?.[1] || 'local-review';
}

function inferChannel(relativePath: string): string {
  const match = channelFromName.exec(relativePath);
  if (!match) return 'local';
  return match[1].toLowerCase() === 'x' ? 'x-twitter' : match[1].toLowerCase();
}

function inferContentType(file: string): AssetContentType {
  const mime = contentTypeFor(file);
  if (mime.startsWith('image/gif')) return 'gif';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'other';
}

export function listLocalReviewAssets(repoRoot: string, project: string, catalog: AssetCatalog): GrowthAsset[] {
  const catalogChecksums = new Set(catalog.assets.map(asset => asset.s3?.checksum_sha256).filter(Boolean));
  const root = localReviewRoot(repoRoot);
  return walkLocalReviewFiles(root)
    .flatMap(file => {
      try {
        const stats = statSync(file);
        const checksum = fileSha256(file);
        const relativePath = relative(root, file);
        return [{ checksum, file, relativePath, stats }];
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
    })
    .filter(item => !catalogChecksums.has(item.checksum))
    .map(item => {
      const fileSlug = basename(item.file, extname(item.file));
      const channel = inferChannel(item.relativePath);
      return {
        asset_id: `local-${item.checksum.slice(0, 12)}`,
        project,
        product: project,
        source: 'local',
        campaign: inferCampaign(item.relativePath),
        channel,
        audience: 'local-review',
        status: 'planned',
        content_type: inferContentType(item.file),
        title: fileSlug.replace(/[-_]+/g, ' '),
        hook: item.relativePath,
        cta: 'Review before upload',
        utm_content: fileSlug.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'local_review',
        notes: 'Local pre-push asset. Review and refine before uploading to S3.',
        local: {
          relative_path: item.relativePath,
          absolute_path: item.file,
          size_bytes: item.stats.size,
          content_type: contentTypeFor(item.file),
          checksum_sha256: item.checksum,
          updated_at: item.stats.mtime.toISOString(),
        },
      };
    });
}

export function localPreviewPath(repoRoot: string, relativePath: string): string {
  const root = localReviewRoot(repoRoot);
  const resolved = resolve(root, relativePath);
  if (!isPathInside(resolved, root) || !existsSync(resolved)) throw new LocalReviewError('Unknown local review asset');
  if (!localReviewExts.has(extname(resolved).toLowerCase())) throw new LocalReviewError('Local preview type is not supported');
  return resolved;
}
