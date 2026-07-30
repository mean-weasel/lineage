// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import type { AgentClaimSummary, LineageWorkspace } from '../../shared/types';
import { LineageWorkspacePicker } from './LineageWorkspacePicker';
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

  it('shows the complete project-scoped workspace list without Recent grouping or activation writes', async () => {
    const second = { ...workspace, id: 'demo-project:lineage-workspace:second', root_asset_id: 'second', title: 'Second workspace' };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSelect = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, claims: [], fetchedAt: '2026-07-29T00:00:00.000Z' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root.render(createElement(LineageWorkspacePicker, {
        activeWorkspace: workspace,
        loading: false,
        onArchive: vi.fn(),
        onSelect,
        workspaces: [workspace, second],
      }));
      await Promise.resolve();
    });
    act(() => container.querySelector<HTMLButtonElement>('.lineage-workspace-trigger')!.click());

    const options = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    expect(options.map(option => option.textContent)).toEqual([
      expect.stringContaining('TikTok hook lineage'),
      expect.stringContaining('Second workspace'),
    ]);
    expect(container.textContent).not.toContain('Recent');

    act(() => options[1].click());
    expect(onSelect).toHaveBeenCalledWith(second.id);
    expect(fetchMock.mock.calls.every(([path]) => !String(path).includes('/activate'))).toBe(true);

    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
});
