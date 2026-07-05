import type { LineageBriefResponse, LineageSelectedChildFields } from '../shared/types';
import { AgentClaimError, validateAgentClaimForWrite } from './agentClaims';
import { getLineageNextAsset, LineageError, linkLineageAssets } from './assetLineage';
import { lineageDbPath, nowIso } from './assetLineageDb';
import { lineageWorkspaceId } from './assetLineageWorkspaces';

const publicPackageCommand = 'npx @mean-weasel/lineage';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function lineageCommand(command: string, project: string, rootAssetId: string): string {
  return `${publicPackageCommand} ${command} --project ${shellQuote(project)} --root ${shellQuote(rootAssetId)} --db ${shellQuote(lineageDbPath())} --json`;
}

function linkChildCommand(project: string, rootAssetId: string): string {
  return `${publicPackageCommand} link-child --project ${shellQuote(project)} --root ${shellQuote(rootAssetId)} --child <asset-id> --confirm-write --db ${shellQuote(lineageDbPath())} --json`;
}

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
      next_command: lineageCommand('next', project, next.root_asset_id),
      inspect_command: asset ? `${publicPackageCommand} inspect --project ${shellQuote(project)} --asset-id ${shellQuote(asset.asset_id)} --db ${shellQuote(lineageDbPath())} --json` : undefined,
      link_child_command: asset ? linkChildCommand(project, next.root_asset_id) : undefined,
    },
    fetchedAt: nowIso(),
  };
}

export function linkSelectedLineageChild(project: string, fields: LineageSelectedChildFields) {
  const next = getLineageNextAsset(project, fields.rootAssetId);
  if (!next.next_asset) throw new LineageError('Cannot link child until a next base is selected or unambiguous');
  if (fields.confirmWrite) {
    const validation = validateAgentClaimForWrite({
      channel: next.next_asset.channel,
      claimToken: fields.claimToken,
      confirmWrite: fields.confirmWrite,
      dangerLevel: 'enforce',
      project,
      scopeType: 'lineage_workspace',
      targetId: lineageWorkspaceId(project, next.root_asset_id),
      writeKind: 'link_child',
    });
    if (!validation.ok) throw new AgentClaimError(validation.message, validation.code === 'claim_required' ? 401 : 403, validation.code, validation.conflicts);
  }
  const result = linkLineageAssets(project, {
    childAssetId: fields.childAssetId,
    confirmWrite: fields.confirmWrite,
    claimToken: fields.claimToken,
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
