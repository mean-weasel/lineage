import { describe, expect, it } from 'vitest';
import type { LineageWorkspace } from '../../shared/types';
import { lineageWorkspaceOptionLabel, lineageWorkspaceRootAssetId } from './lineageWorkspacePickerModel';

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
});
