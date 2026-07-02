import type { LineageBriefResponse, LineageSelectedChildFields } from '../shared/types';
import { getLineageNextAsset, LineageError, linkLineageAssets } from './assetLineage';
import { nowIso } from './assetLineageDb';

export function getLineageBrief(project: string, rootAssetId?: string): LineageBriefResponse {
  const next = getLineageNextAsset(project, rootAssetId);
  const assets = next.next_assets;
  const asset = next.next_asset;
  const referenceAssetIds = assets.map(item => item.asset_id);
  const rationale = next.selections.map(selection => selection.notes).find(Boolean) || asset?.selection_note || next.selection?.notes;
  const channels = [...new Set(assets.map(item => item.channel || 'unknown'))];
  const campaigns = [...new Set(assets.map(item => item.campaign || 'unknown'))];
  const prompt = assets.length > 0
    ? [
      assets.length === 1
        ? `Create 3-4 variations from asset ${assets[0].asset_id} (${assets[0].title}).`
        : `Create 3-4 variations using these ${assets.length} selected references: ${referenceAssetIds.join(', ')}.`,
      rationale ? `Preserve this selection rationale: ${rationale}` : 'Preserve the strongest visible ideas while exploring distinct alternatives.',
      `Keep project=${project}, root=${next.root_asset_id}, channels=${channels.join(',')}, campaigns=${campaigns.join(',')}.`,
      'After generation, index outputs and link chosen children with lineage link-child.',
    ].join(' ')
    : 'Select one to three latest lineage candidates before generating variations.';
  return {
    project,
    root_asset_id: next.root_asset_id,
    strategy: next.strategy,
    selection_mode: next.selection_mode,
    recommended_action: next.recommended_action,
    reason: next.reason,
    next_asset: asset,
    next_assets: assets,
    selection: next.selection,
    selections: next.selections,
    latest: next.latest,
    warnings: next.warnings,
    brief: {
      title: asset ? `Evolve ${assets.length > 1 ? `${assets.length} selected bases` : asset.title}` : 'Choose next lineage base',
      objective: asset ? 'Generate the next branch of visual variations from the selected lineage base or bases.' : 'Resolve the next base before generation.',
      prompt,
      reference_asset_id: asset?.asset_id,
      reference_asset_ids: referenceAssetIds,
      rationale,
    },
    handoff: {
      next_command: `npx lineage lineage next --project ${project} --root ${next.root_asset_id} --json`,
      inspect_command: asset ? `npx lineage lineage inspect --project ${project} --asset-id ${asset.asset_id} --json` : undefined,
      link_child_command: asset ? `npx lineage lineage link-child --project ${project} --root ${next.root_asset_id} --child <asset-id> --confirm-write --json` : undefined,
    },
    fetchedAt: nowIso(),
  };
}

export function linkSelectedLineageChild(project: string, fields: LineageSelectedChildFields) {
  const next = getLineageNextAsset(project, fields.rootAssetId);
  if (!next.next_asset) throw new LineageError('Cannot link child until a next base is selected or unambiguous');
  const result = linkLineageAssets(project, {
    childAssetId: fields.childAssetId,
    confirmWrite: fields.confirmWrite,
    parentAssetId: next.next_asset.asset_id,
  });
  return {
    ...result,
    root_asset_id: next.root_asset_id,
    parent_asset_id: next.next_asset.asset_id,
    child_asset_id: fields.childAssetId,
    reference_asset_ids: next.next_assets.map(asset => asset.asset_id),
    warning: next.next_assets.length > 1
      ? 'Linked child to the primary selected base; add explicit edges to other selected references if the child derives from them too.'
      : undefined,
  };
}
