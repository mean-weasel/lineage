export type LineageWorkspaceStatus = 'active' | 'paused' | 'archived';
export type LineageWorkspaceActor = 'human' | 'agent' | 'system';

export interface LineageWorkspace {
  id: string;
  project: string;
  root_asset_id: string;
  title: string;
  status: LineageWorkspaceStatus;
  notes?: string;
  created_by: LineageWorkspaceActor;
  active_at?: string;
  created_at: string;
  updated_at: string;
}

export interface LineageWorkspaceSnapshot {
  project: string;
  active_workspace: LineageWorkspace | null;
  workspaces: LineageWorkspace[];
  fetchedAt: string;
}

export interface LineageWorkspaceFields {
  rootAssetId: string;
  title?: string;
  status?: LineageWorkspaceStatus;
  notes?: string;
  createdBy?: LineageWorkspaceActor;
  activate?: boolean;
  confirmWrite: boolean;
}

export interface LineageWorkspaceUpdateFields {
  title?: string;
  status?: LineageWorkspaceStatus;
  notes?: string;
  activate?: boolean;
  confirmWrite: boolean;
}
