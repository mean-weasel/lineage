import { describe, expect, it } from 'vitest';
import type { AgentClaimSummary, LineageWorkspace } from '../../shared/types';
import { agentClaimOccupancyLabel, lineageWorkspaceClaims, lineageWorkspaceOptionLabel, lineageWorkspaceRootAssetId } from './lineageWorkspacePickerModel';

const workspace: LineageWorkspace = {
  active_at: '2026-06-27T18:00:00.000Z',
  created_at: '2026-06-27T17:00:00.000Z',
  created_by: 'human',
  id: 'demo-project:lineage-workspace:local-root',
  project: 'demo-project',
  root_asset_id: 'local-root',
  status: 'active',
  title: 'TikTok hook lineage',
  updated_at: '2026-06-27T18:00:00.000Z',
};

const claims = [{
  agent_kind: 'codex',
  agent_name: 'Ada',
  created_at: '2026-06-27T18:00:00.000Z',
  derived_state: 'stale',
  expires_at: '2026-06-27T18:20:00.000Z',
  heartbeat_age_seconds: 940,
  heartbeat_at: '2026-06-27T18:00:00.000Z',
  id: 'claim_workspace',
  project: 'demo-project',
  scope_type: 'lineage_workspace',
  status: 'active',
  target_id: 'demo-project:lineage-workspace:local-root',
}, {
  agent_kind: 'codex',
  agent_name: 'Wrong project',
  created_at: '2026-06-27T18:00:00.000Z',
  derived_state: 'active',
  expires_at: '2026-06-27T18:20:00.000Z',
  heartbeat_age_seconds: 12,
  heartbeat_at: '2026-06-27T18:00:00.000Z',
  id: 'claim_other',
  project: 'other-project',
  scope_type: 'lineage_workspace',
  status: 'active',
  target_id: 'demo-project:lineage-workspace:local-root',
}] satisfies AgentClaimSummary[];

describe('LineageWorkspacePicker helpers', () => {
  it('uses the explicit workspace root before ambient selected asset fallback', () => {
    expect(lineageWorkspaceRootAssetId(workspace, 'local-selected')).toBe('local-root');
  });

  it('falls back to the selected asset only when no workspace is active', () => {
    expect(lineageWorkspaceRootAssetId(null, 'local-selected')).toBe('local-selected');
  });

  it('labels workspaces with title and root for disambiguation', () => {
    expect(lineageWorkspaceOptionLabel(workspace)).toBe('TikTok hook lineage (local-root)');
  });

  it('matches active lineage workspace claims without exposing tokens', () => {
    const matched = lineageWorkspaceClaims(claims, workspace);

    expect(matched.map(claim => claim.id)).toEqual(['claim_workspace']);
    expect(agentClaimOccupancyLabel(matched)).toBe('Stale claim by Ada');
    expect(JSON.stringify(matched)).not.toContain('claim_workspace.secret');
  });
});
