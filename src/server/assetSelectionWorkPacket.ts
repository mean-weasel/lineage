import { listAssets } from './assetCore';
import { getAssetSelectionSnapshot } from './assetSelections';
import type {
  AssetSelectionWorkPacket,
  AssetSelectionWorkPacketCandidate,
  AssetSelectionWorkPacketStorageState,
  GrowthAsset,
} from '../shared/types';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function command(project: string, value: string): string {
  return `npm run studio:cli -- ${value} --project ${shellQuote(project)} --json`;
}

function storageState(asset?: GrowthAsset): AssetSelectionWorkPacketStorageState {
  if (!asset) return 'unresolved';
  const hasLocal = Boolean(asset.local?.relative_path);
  const hasS3 = Boolean(asset.s3?.key);
  if (hasLocal && hasS3) return 'local_and_s3';
  if (hasLocal) return 'local_only';
  if (hasS3) return 's3_backed';
  return 'unresolved';
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

export function getAssetSelectionWorkPacket(project: string): AssetSelectionWorkPacket {
  const snapshot = getAssetSelectionSnapshot(project);
  const reviewSet = snapshot.active_review_set;
  const catalogAssets = listAllAssets(project);
  const assetById = new Map(catalogAssets.map(asset => [asset.asset_id, asset]));
  const candidates: AssetSelectionWorkPacketCandidate[] = (reviewSet?.items || []).map(item => {
    const asset = assetById.get(item.asset_id);
    return {
      asset_id: item.asset_id,
      label: item.variation_label || String(item.position + 1),
      local_path: asset?.local?.absolute_path,
      notes: item.notes,
      s3_key: asset?.s3?.key,
      selected: Boolean(item.selected_at && !item.deselected_at),
      source: asset?.source || 'unknown',
      storage_state: storageState(asset),
      title: asset?.title || item.asset_id,
    };
  });
  const selectedAssets = candidates.filter(candidate => candidate.selected).map(candidate => candidate.asset_id);
  const suggestedNextAction = !reviewSet
    ? 'create_review_set'
    : selectedAssets.length > 0
      ? 'continue_selected_assets'
      : 'choose_variations';

  return {
    kind: 'asset_selection_work_packet',
    project,
    fetched_at: snapshot.fetchedAt,
    review_set: reviewSet ? {
      id: reviewSet.id,
      key: reviewSet.key,
      label: reviewSet.label,
      selected_count: selectedAssets.length,
      status: reviewSet.status,
      total_candidates: candidates.length,
    } : null,
    candidates,
    selected_assets: selectedAssets,
    suggested_next_action: suggestedNextAction,
    commands: {
      chooseLabelsTemplate: command(
        project,
        `selections review-set choose --labels A,B${reviewSet ? ` --set-id ${shellQuote(reviewSet.id)}` : ''}`,
      ),
      currentSelectionCommand: command(project, 'selections current'),
      inspectReviewSetCommand: reviewSet
        ? command(project, `selections review-set inspect --set-id ${shellQuote(reviewSet.id)}`)
        : undefined,
      plainEnglishContinue: command(project, `agent ${shellQuote('keep working on my selections')}`),
      setNextCommand: reviewSet
        ? command(project, `selections review-set set-next --set-id ${shellQuote(reviewSet.id)}`)
        : undefined,
    },
  };
}
