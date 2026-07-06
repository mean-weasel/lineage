import { AgentClaimError, listAgentClaims, validateAgentClaimForWrite } from './agentClaims';
import { lineageWorkspaceId } from './assetLineageWorkspaces';

function hasActiveLineageWorkspaceClaim(project: string, targetId: string): boolean {
  return listAgentClaims(project).claims.some(claim => {
    if (claim.project !== project || claim.status !== 'active' || claim.derived_state === 'expired') return false;
    if (claim.scope_type === 'lineage_workspace') return claim.target_id === targetId;
    return claim.scope_type === 'project_channel';
  });
}

export function requireLineageWorkspaceClaimForWrite(fields: {
  claimToken?: string;
  confirmWrite: boolean;
  project: string;
  rootAssetId: string;
  writeKind: string;
}): void {
  if (!fields.confirmWrite) return;
  const targetId = lineageWorkspaceId(fields.project, fields.rootAssetId);
  if (!fields.claimToken && !hasActiveLineageWorkspaceClaim(fields.project, targetId)) return;
  const validation = validateAgentClaimForWrite({
    claimToken: fields.claimToken,
    confirmWrite: fields.confirmWrite,
    dangerLevel: 'enforce',
    project: fields.project,
    scopeType: 'lineage_workspace',
    targetId,
    writeKind: fields.writeKind,
  });
  if (!validation.ok) {
    const status = validation.code === 'claim_required' || validation.code === 'claim_token_invalid' ? 401 : 409;
    throw new AgentClaimError(validation.message, status, validation.code, validation.conflicts);
  }
}
