export type LineageRuntimeChannel = 'stable' | 'preview' | 'dev';

interface LineageRuntimeDatabaseInfo {
  error?: string;
  exists: boolean;
  modified_at?: string;
  path: string;
  projects?: number;
  size_bytes?: number;
  workspaces?: number;
}

export interface LineageRuntimeInfo {
  channel: LineageRuntimeChannel;
  database: LineageRuntimeDatabaseInfo;
  fetchedAt: string;
  git_sha?: string;
  node_env?: string;
  package_name: string;
  version: string;
}
