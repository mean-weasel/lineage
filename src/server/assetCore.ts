import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createS3StorageAdapter } from './adapters/storage';
import { listLocalReviewAssets, localPreviewPath as resolveLocalPreviewPath } from './localReview';
import { syncLedgerPlacement } from './assetLedgerWorkflow';
import type {
  AssetCatalog,
  AssetContentType,
  AssetFacets,
  DoctorReport,
  AssetLibrarySnapshot,
  GrowthAsset,
  ListAssetsOptions,
  LiveS3Object,
  MutationResponse,
  PlacementFields,
  PlacementStatus,
  PresignResponse,
  ProjectSummary,
  UploadFields,
} from '../shared/types';

function isPackageRoot(path: string): boolean {
  const packageJson = join(path, 'package.json');
  if (!existsSync(packageJson)) return false;
  try {
    const packageInfo = JSON.parse(readFileSync(packageJson, 'utf8')) as { name?: string };
    return packageInfo.name === '@mean-weasel/lineage';
  } catch {
    return false;
  }
}

function resolveRepoRoot(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.LINEAGE_REPO_ROOT,
    resolve(moduleDir, '..'),
    resolve(moduleDir, '../..'),
    process.cwd(),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const root = candidates.find(isPackageRoot);
  if (!root) throw new Error('Unable to locate Lineage package root');
  return root;
}

export const repoRoot = resolveRepoRoot();
export const defaultProject = 'demo-project';
export const defaultProduct = process.env.LINEAGE_DEFAULT_PRODUCT || defaultProject;
const contentTypes = new Set<AssetContentType>(['image', 'video', 'gif', 'audio', 'doc', 'other']);
const baseChannels = ['linkedin', 'meta', 'tiktok', 'x-twitter', 'youtube'];
const placementStatuses = new Set<PlacementStatus>(['planned', 'scheduled', 'posted', 'skipped']);
const projectNamePattern = /^[a-z0-9][a-z0-9-]*$/;

interface CommandResult {
  stdout: string;
  stderr: string;
}

class AssetStudioError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function isAssetStudioError(error: unknown): error is AssetStudioError {
  return error instanceof AssetStudioError;
}

export function cleanProject(project = defaultProject): string {
  if (!projectNamePattern.test(project)) {
    throw new AssetStudioError('Project must be lowercase kebab-case');
  }
  return project;
}

export function catalogPath(project = defaultProject): string {
  return join(repoRoot, cleanProject(project), 'assets', 'catalog.json');
}

export function normalizeCatalog(catalog: Partial<AssetCatalog>, fallbackProject = defaultProject): AssetCatalog {
  const project = cleanProject(catalog.project || catalog.product || fallbackProject);
  const product = catalog.product || project;
  return {
    ...catalog,
    project,
    product,
    default_bucket: catalog.default_bucket || '',
    default_region: catalog.default_region || '',
    assets: (catalog.assets || []).map(asset => ({
      ...asset,
      source: asset.source || 'catalog',
      project: asset.project || asset.product || project,
      product: asset.product || asset.project || project,
    })),
  };
}

export function loadCatalog(project = defaultProject): AssetCatalog {
  const path = catalogPath(project);
  if (!existsSync(path)) {
    const clean = cleanProject(project);
    if (clean === defaultProject) {
      return normalizeCatalog({
        assets: [],
        default_bucket: 'lineage-demo-assets',
        default_region: 'us-east-1',
        product: defaultProject,
        project: defaultProject,
      }, defaultProject);
    }
    throw new AssetStudioError(`Missing catalog: ${path}`, 404);
  }
  return normalizeCatalog(JSON.parse(readFileSync(path, 'utf8')) as Partial<AssetCatalog>, project);
}

function saveCatalog(project: string, catalog: AssetCatalog): AssetCatalog {
  const normalized = normalizeCatalog(catalog, project);
  writeFileSync(catalogPath(project), `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

function run(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      AWS_REGION: process.env.AWS_REGION || 'us-east-1',
      AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION || 'us-east-1',
    },
  });

  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new AssetStudioError(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`, 502);
  }

  return { stdout: result.stdout, stderr: result.stderr };
}

function runAssetScript(command: string, args: string[]): CommandResult {
  return run('node', ['scripts/lineage-assets.mjs', command, ...args]);
}

function runAws(args: string[]): CommandResult {
  return run('aws', args);
}

export function listProjects(): ProjectSummary[] {
  return readdirSync(repoRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && projectNamePattern.test(entry.name) && existsSync(catalogPath(entry.name)))
    .flatMap(entry => {
      try {
        const catalog = loadCatalog(entry.name);
        return [{ project: catalog.project, product: catalog.product, catalogPath: catalogPath(entry.name), default_bucket: catalog.default_bucket, default_region: catalog.default_region, asset_count: catalog.assets.length }];
      } catch (error) {
        if (error instanceof AssetStudioError && error.status === 404) return [];
        throw error;
      }
    })
    .sort((a, b) => a.project.localeCompare(b.project));
}

function assetById(catalog: AssetCatalog, assetId: string): GrowthAsset {
  const asset = catalog.assets.find(item => item.asset_id === assetId);
  if (!asset) throw new AssetStudioError(`Unknown asset: ${assetId}`, 404);
  return asset;
}

const storageAdapter = createS3StorageAdapter({
  assetById,
  cleanProject,
  createError: (message, status) => new AssetStudioError(message, status),
  defaultProject,
  loadCatalog,
  runAssetScript,
  runAws,
  saveCatalog,
  supportedContentTypes: contentTypes,
});

function uniqueSorted<T extends string>(values: Array<T | undefined>): T[] {
  return Array.from(new Set(values.filter(Boolean) as T[])).sort();
}

function facetsFor(assets: GrowthAsset[]): AssetFacets {
  return {
    audiences: uniqueSorted(assets.map(asset => asset.audience)),
    campaigns: uniqueSorted(assets.map(asset => asset.campaign)),
    channels: uniqueSorted([...baseChannels, ...assets.map(asset => asset.channel)]),
    contentTypes: uniqueSorted(assets.map(asset => asset.content_type)),
    placementStatuses: uniqueSorted(assets.flatMap(asset => asset.placements?.map(placement => placement.status) || [])),
    statuses: uniqueSorted(assets.map(asset => asset.status)),
    totalSizeBytes: assets.reduce((sum, asset) => sum + (asset.s3?.size_bytes || 0), 0),
  };
}

function filteredAssets(assets: GrowthAsset[], options: ListAssetsOptions): GrowthAsset[] {
  const query = options.query?.trim().toLowerCase();
  return assets.filter(asset => {
    if (options.status && options.status !== 'all' && asset.status !== options.status) return false;
    if (options.channel && options.channel !== 'all' && asset.channel !== options.channel) return false;
    if (options.type && options.type !== 'all' && asset.content_type !== options.type) return false;
    if (options.placementStatus === 'not-posted' && asset.placements?.some(placement => placement.status === 'posted')) return false;
    if (options.placementStatus && !['all', 'not-posted'].includes(options.placementStatus) && !asset.placements?.some(placement => placement.status === options.placementStatus)) return false;
    if (options.campaign && options.campaign !== 'all' && asset.campaign !== options.campaign) return false;
    if (options.audience && options.audience !== 'all' && asset.audience !== options.audience) return false;
    if (!query) return true;
    return [asset.asset_id, asset.title, asset.campaign, asset.channel, asset.audience, asset.hook, asset.cta]
      .join(' ')
      .toLowerCase()
      .includes(query);
  });
}

export function listAssets(project = defaultProject, options: ListAssetsOptions = {}): AssetLibrarySnapshot {
  const catalog = loadCatalog(project);
  const pageSize = Math.min(Math.max(Number(options.pageSize || 10), 1), 100);
  const page = Math.max(Number(options.page || 1), 1);
  const localAssets = listLocalReviewAssets(repoRoot, catalog.project, catalog);
  const source = options.source || 'catalog';
  const sourceAssets = source === 'local' ? localAssets : source === 'all' ? [...localAssets, ...catalog.assets] : catalog.assets;
  const filtered = filteredAssets(sourceAssets, options);
  const totalPages = Math.max(Math.ceil(filtered.length / pageSize), 1);
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const pageAssets = filtered.slice(start, start + pageSize);
  let liveObjects: LiveS3Object[] = [];
  let error: string | undefined;
  if (options.includeLive) {
    try {
      liveObjects = storageAdapter.listLiveObjects(catalog);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  return {
    catalog: { project: catalog.project, product: catalog.product, default_bucket: catalog.default_bucket, default_region: catalog.default_region, asset_count: catalog.assets.length },
    assets: pageAssets,
    facets: facetsFor(catalog.assets),
    pagination: { page: safePage, pageSize, total: filtered.length, totalPages },
    liveObjects,
    orphanObjects: liveObjects.filter(object => !object.cataloged),
    identity: options.includeLive ? storageAdapter.getIdentity() : undefined,
    fetchedAt: new Date().toISOString(),
    error,
  };
}

export function inspectAsset(project: string, assetId: string): GrowthAsset {
  return assetById(loadCatalog(project), assetId);
}

export function validateProject(project = defaultProject): ProjectSummary {
  const catalog = loadCatalog(project);
  return { project: catalog.project, product: catalog.product, catalogPath: catalogPath(project), default_bucket: catalog.default_bucket, default_region: catalog.default_region, asset_count: catalog.assets.length };
}

export function doctorProject(project = defaultProject, options: { includeLive?: boolean } = {}): DoctorReport {
  const summary = validateProject(project);
  let liveCheck: DoctorReport['liveCheck'] = 'skipped';
  let liveError: string | undefined;
  if (options.includeLive) {
    try {
      storageAdapter.listLiveObjects(loadCatalog(project));
      liveCheck = 'ok';
    } catch (error) {
      liveCheck = 'error';
      liveError = error instanceof Error ? error.message : String(error);
    }
  }
  return { catalogExists: true, deleteEnabled: process.env.LINEAGE_ENABLE_CLOUD_DELETE === 'true', project: summary, liveCheck, liveError };
}

export function pullAsset(project: string, assetId: string, out = '.asset-scratch'): MutationResponse {
  return storageAdapter.pullAsset(project, assetId, out);
}

function placementFromFields(fields: PlacementFields) {
  if (!fields.channel) throw new AssetStudioError('Placement requires channel');
  if (!placementStatuses.has(fields.status)) throw new AssetStudioError(`Unsupported placement status: ${fields.status}`);
  const now = new Date().toISOString();
  return {
    channel: fields.channel,
    status: fields.status,
    ...(fields.scheduledAt ? { scheduled_at: fields.scheduledAt } : {}),
    ...(fields.postedAt ? { posted_at: fields.postedAt } : {}),
    ...(fields.url ? { url: fields.url } : {}),
    ...(fields.notes ? { notes: fields.notes } : {}),
    updated_at: now,
  };
}

export function previewPlacement(project: string, fields: PlacementFields) {
  const asset = inspectAsset(project, fields.assetId);
  return { asset_id: asset.asset_id, placement: placementFromFields(fields) };
}

export function updatePlacement(project: string, fields: PlacementFields): MutationResponse {
  if (!fields.confirmWrite) throw new AssetStudioError('Placement updates require confirmWrite=true');
  const catalog = loadCatalog(project);
  const asset = assetById(catalog, fields.assetId);
  const placement = placementFromFields(fields);
  const existing = asset.placements?.findIndex(item => item.channel === placement.channel);
  if (existing !== undefined && existing >= 0) asset.placements![existing] = placement;
  else asset.placements = [...(asset.placements || []), placement];
  saveCatalog(project, catalog);
  syncLedgerPlacement(project, asset.asset_id, placement);
  return { ok: true, message: `Marked ${asset.asset_id} ${placement.status} for ${placement.channel}`, catalog };
}

export function presignAsset(project: string, assetId: string, expiresIn = 900): PresignResponse {
  return storageAdapter.presignAsset(project, assetId, expiresIn);
}

export function localPreviewPath(relativePath: string): string {
  try {
    return resolveLocalPreviewPath(repoRoot, relativePath);
  } catch (error) {
    throw new AssetStudioError(error instanceof Error ? error.message : 'Unknown local review asset', 404);
  }
}

export function promoteAsset(project: string, assetId: string, confirmWrite: boolean): MutationResponse {
  return storageAdapter.promoteAsset(project, assetId, confirmWrite);
}

export function archiveAsset(project: string, assetId: string, confirmArchive: boolean): MutationResponse {
  if (!confirmArchive) throw new AssetStudioError('Archive requires confirmArchive=true');
  const catalog = loadCatalog(project);
  const asset = assetById(catalog, assetId);
  asset.status = 'archived';
  saveCatalog(project, catalog);
  return { ok: true, message: `Archived ${assetId}`, catalog };
}

export function uploadAsset(file: string, fields: UploadFields): MutationResponse {
  return storageAdapter.uploadAsset(file, fields);
}

export function deleteObjectGuarded(project: string, assetId: string, confirmation: string): MutationResponse {
  return storageAdapter.deleteObjectGuarded(project, assetId, confirmation);
}

export function ensureUploadDir(): string {
  const dir = join(repoRoot, '.asset-scratch', 'studio-uploads');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function cleanupUploadedTemp(file?: string): void {
  if (!file) return;
  const uploadRoot = ensureUploadDir();
  const resolved = resolve(file);
  if (resolved.startsWith(`${uploadRoot}/`) && existsSync(resolved)) {
    unlinkSync(resolved);
  }
}
