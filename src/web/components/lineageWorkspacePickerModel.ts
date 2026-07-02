import type { LineageWorkspace } from '../../shared/types';

export function lineageWorkspaceRootAssetId(workspace: LineageWorkspace | null | undefined, fallbackAssetId?: string): string {
  return workspace?.root_asset_id || fallbackAssetId || '';
}

export function lineageWorkspaceOptionLabel(workspace: LineageWorkspace): string {
  return `${workspace.title} (${workspace.root_asset_id})`;
}
