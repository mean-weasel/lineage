import type { AgentClaimSummary, LineageWorkspace } from '../../shared/types';

export function lineageWorkspaceRootAssetId(workspace: LineageWorkspace | null | undefined, fallbackAssetId?: string): string {
  return workspace?.root_asset_id || fallbackAssetId || '';
}

export function lineageWorkspaceOptionLabel(workspace: LineageWorkspace): string {
  return `${workspace.title} (${workspace.root_asset_id})`;
}

export function lineageWorkspaceClaims(claims: AgentClaimSummary[], workspace: LineageWorkspace): AgentClaimSummary[] {
  const workspaceTargetId = `${workspace.project}:lineage-workspace:${workspace.root_asset_id}`;
  return claims.filter(claim => {
    if (claim.project !== workspace.project || claim.status !== 'active' || claim.derived_state === 'expired') return false;
    if (claim.scope_type === 'lineage_workspace') return claim.target_id === workspace.id || claim.target_id === workspaceTargetId;
    return claim.scope_type === 'project_channel';
  });
}

export function agentClaimOccupancyState(claims: AgentClaimSummary[]): 'active' | 'idle' | 'stale' {
  if (claims.some(claim => claim.derived_state === 'stale')) return 'stale';
  if (claims.some(claim => claim.derived_state === 'idle')) return 'idle';
  return 'active';
}

export function agentClaimOccupancyLabel(claims: AgentClaimSummary[]): string {
  const state = agentClaimOccupancyState(claims);
  if (claims.length !== 1) return `${claims.length} active claims`;
  return `${state === 'active' ? 'Claimed' : state === 'idle' ? 'Idle claim' : 'Stale claim'} by ${claims[0].agent_name}`;
}
