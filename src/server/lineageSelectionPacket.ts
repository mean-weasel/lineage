import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { listAssets, repoRoot, validateProject } from './assetCore';
import { getLineageSnapshot } from './assetLineage';
import { lineageDbPath } from './assetLineageDb';
import { lineageWorkspaceId, listLineageWorkspaces } from './assetLineageWorkspaces';
import type { GrowthAsset, LineageNode, LineageSelectionPacket, LineageSelectionPacketAsset, LineageSelectionPacketStorageState, LineageWorkspace } from '../shared/types';

interface LineageSelectionPacketOptions {
  campaign?: string;
  channel?: string;
  command?: string;
  contextNotes?: string;
  dbPath?: string;
  labels?: string[];
  packageVersion?: string;
  rootAssetId?: string;
  strict?: boolean;
  workspaceId?: string;
}

export class LineageSelectionPacketError extends Error {
  constructor(message: string, public warnings: string[] = [], public errors: string[] = []) {
    super(message);
  }
}

function listAllAssets(project: string): GrowthAsset[] {
  const pageSize = 100;
  const first = listAssets(project, { page: 1, pageSize, source: 'all' });
  const assets = [...first.assets];
  for (let page = 2; page <= first.pagination.totalPages; page += 1) {
    assets.push(...listAssets(project, { page, pageSize, source: 'all' }).assets);
  }
  return assets;
}

function resolveWorkspace(project: string, options: LineageSelectionPacketOptions): LineageWorkspace {
  if (options.rootAssetId && options.workspaceId) {
    throw new LineageSelectionPacketError('Use either --root or --workspace, not both.', [], ['ambiguous_workspace']);
  }
  const snapshot = listLineageWorkspaces(project);
  const target = options.workspaceId || options.rootAssetId;
  const workspace = target
    ? snapshot.workspaces.find(item => item.id === target || item.root_asset_id === target)
    : snapshot.active_workspace;
  if (workspace) return workspace;
  if (options.rootAssetId) {
    return {
      id: lineageWorkspaceId(project, options.rootAssetId),
      project,
      root_asset_id: options.rootAssetId,
      title: `${options.rootAssetId} lineage`,
      status: 'active',
      created_by: 'system',
      created_at: '',
      updated_at: '',
    };
  }
  const message = options.workspaceId
    ? `Unknown lineage workspace: ${options.workspaceId}`
    : 'No active lineage workspace. Pass --root or activate a workspace first.';
  throw new LineageSelectionPacketError(message, [], [options.workspaceId ? 'unknown_workspace' : 'missing_active_workspace']);
}

function resolveLocalReference(reference?: string): string | undefined {
  if (!reference) return undefined;
  if (isAbsolute(reference)) return reference;
  const repoRelative = resolve(repoRoot, reference);
  if (existsSync(repoRelative)) return repoRelative;
  return resolve(repoRoot, '.asset-scratch', reference);
}

function fileSize(path?: string): number | undefined {
  if (!path || !existsSync(path)) return undefined;
  try {
    return statSync(path).size;
  } catch {
    return undefined;
  }
}

function storageState(hasLocal: boolean, hasS3: boolean): LineageSelectionPacketStorageState {
  if (hasLocal && hasS3) return 'local_and_s3';
  if (hasLocal) return 'local_only';
  if (hasS3) return 's3_backed';
  return 'unresolved';
}

function currentAttemptFor(node: LineageNode): LineageSelectionPacketAsset['current_attempt'] {
  if (!node.current_attempt) return undefined;
  return {
    asset_id: node.current_attempt.asset_id,
    checksum_sha256: node.current_attempt.checksum_sha256,
    file_path: node.current_attempt.file_path,
    generation_job_id: node.current_attempt.generation_job_id,
    id: node.current_attempt.id,
    is_current: node.current_attempt.is_current,
    source: node.current_attempt.source,
  };
}

function assetForNode(node: LineageNode, catalogAsset: GrowthAsset | undefined, warnings: string[]): LineageSelectionPacketAsset {
  const localReference = catalogAsset?.local?.absolute_path || node.current_attempt?.file_path || node.local_path || catalogAsset?.local?.relative_path;
  const absolutePath = catalogAsset?.local?.absolute_path || resolveLocalReference(localReference);
  const localExists = absolutePath ? existsSync(absolutePath) : false;
  const hasLocalClaim = Boolean(absolutePath || node.local_path || catalogAsset?.local?.relative_path);
  const s3Key = catalogAsset?.s3?.key || node.s3_key;
  const hasS3 = Boolean(s3Key);
  const checksum = catalogAsset?.local?.checksum_sha256 || node.current_attempt?.checksum_sha256 || node.checksum_sha256 || catalogAsset?.s3?.checksum_sha256;
  const mimeType = catalogAsset?.local?.content_type || catalogAsset?.s3?.content_type;
  const mediaType = catalogAsset?.content_type || node.media_type;

  if (hasLocalClaim && !localExists) warnings.push(`Selected asset ${node.asset_id} has a local path but the file is missing: ${absolutePath || node.local_path}`);
  if (!hasLocalClaim && !hasS3) warnings.push(`Selected asset ${node.asset_id} has neither a local file nor S3 key.`);
  if (mediaType && mediaType !== 'image' && mediaType !== 'gif') warnings.push(`Selected asset ${node.asset_id} is ${mediaType}, not an image/gif asset.`);

  return {
    asset_id: node.asset_id,
    campaign: catalogAsset?.campaign || node.campaign,
    channel: catalogAsset?.channel || node.channel,
    checksum_sha256: checksum,
    current_attempt: currentAttemptFor(node),
    local: {
      absolute_path: absolutePath,
      content_type: catalogAsset?.local?.content_type,
      exists: localExists,
      relative_path: catalogAsset?.local?.relative_path || node.local_path || node.current_attempt?.file_path,
      size_bytes: catalogAsset?.local?.size_bytes || fileSize(absolutePath),
    },
    media_type: mediaType,
    mime_type: mimeType,
    review_notes: node.review_notes,
    review_state: node.review_state,
    s3: {
      bucket: catalogAsset?.s3?.bucket,
      checksum_sha256: catalogAsset?.s3?.checksum_sha256,
      content_type: catalogAsset?.s3?.content_type,
      etag: catalogAsset?.s3?.etag,
      key: s3Key,
      region: catalogAsset?.s3?.region,
      size_bytes: catalogAsset?.s3?.size_bytes,
      version_id: catalogAsset?.s3?.version_id,
    },
    selection_note: node.selection_note,
    source: catalogAsset?.source || node.source,
    status: catalogAsset?.status || node.status,
    storage_state: storageState(hasLocalClaim, hasS3),
    title: catalogAsset?.title || node.title || node.asset_id,
  };
}

function packetId(packetIdentity: unknown): string {
  const digest = createHash('sha256').update(JSON.stringify(packetIdentity)).digest('hex').slice(0, 24);
  return `lineage_packet_${digest}`;
}

export function getLineageSelectionPacket(project: string, options: LineageSelectionPacketOptions = {}): LineageSelectionPacket {
  const workspace = resolveWorkspace(project, options);
  const snapshot = getLineageSnapshot(project, workspace.root_asset_id);
  const catalogSummary = validateProject(project);
  const catalogAssets = listAllAssets(project);
  const catalogById = new Map(catalogAssets.map(asset => [asset.asset_id, asset]));
  const warnings: string[] = [];
  const errors: string[] = [];
  const nodeById = new Map(snapshot.nodes.map(node => [node.asset_id, node]));
  const selectedItems = snapshot.selections.map(selection => ({
    asset_id: selection.asset_id,
    position: selection.position,
    selected_at: selection.selected_at,
    selection_note: selection.notes,
  }));

  if (selectedItems.length === 0) warnings.push(`Lineage workspace ${workspace.id} has no selected assets.`);

  const assets = selectedItems.flatMap(item => {
    const node = nodeById.get(item.asset_id);
    if (!node) {
      const message = `Selected asset ${item.asset_id} is not present in the resolved workspace snapshot.`;
      warnings.push(message);
      errors.push('selected_asset_outside_workspace');
      return [];
    }
    return [assetForNode(node, catalogById.get(item.asset_id), warnings)];
  });

  if (assets.some(asset => !asset.dimensions)) warnings.push('Image dimensions are unavailable for one or more selected assets.');
  if (options.strict) {
    const strictErrors = [
      ...(selectedItems.length === 0 ? ['empty_selection'] : []),
      ...assets.filter(asset => asset.local.absolute_path && !asset.local.exists).map(asset => `missing_local_file:${asset.asset_id}`),
      ...errors,
    ];
    if (strictErrors.length > 0) {
      throw new LineageSelectionPacketError(`Lineage selection packet strict mode failed: ${strictErrors.join(', ')}`, warnings, strictErrors);
    }
  }

  const context = {
    campaign: options.campaign,
    channel: options.channel,
    labels: options.labels || [],
    notes: options.contextNotes,
  };
  const identity = {
    assets: assets.map(asset => ({
      asset_id: asset.asset_id,
      checksum_sha256: asset.checksum_sha256,
      local_path: asset.local.absolute_path,
      s3_key: asset.s3.key,
      storage_state: asset.storage_state,
    })),
    context,
    project,
    root_asset_id: workspace.root_asset_id,
    schema_version: 'lineage.selection_packet.v1',
    selection: selectedItems,
    workspace_id: workspace.id,
  };

  return {
    assets,
    context,
    created_at: new Date().toISOString(),
    errors,
    kind: 'lineage.selection_packet',
    packet_id: packetId(identity),
    product: catalogSummary.product,
    project,
    schema_version: 'lineage.selection_packet.v1',
    selection: {
      asset_ids: selectedItems.map(item => item.asset_id),
      count: selectedItems.length,
      items: selectedItems,
      root_asset_id: workspace.root_asset_id,
    },
    source: {
      app: 'lineage',
      command: options.command,
      db_path: options.dbPath || process.env.LINEAGE_DB || lineageDbPath(),
      package: options.packageVersion,
    },
    warnings: [...new Set(warnings)],
    workspace: {
      active_at: workspace.active_at,
      id: workspace.id,
      notes: workspace.notes,
      root_asset_id: workspace.root_asset_id,
      status: workspace.status,
      title: workspace.title,
    },
  };
}
