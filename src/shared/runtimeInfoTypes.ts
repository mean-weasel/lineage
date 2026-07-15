export type LineageRuntimeChannel = 'stable' | 'preview' | 'dev';

type LineageRuntimeEnvironment = 'production' | 'preview' | 'development';

interface LineageRuntimeDatabaseInfo {
  error?: string;
  exists: boolean;
  modified_at?: string;
  path: string;
  projects?: number;
  size_bytes?: number;
  workspaces?: number;
}

interface LineageRuntimeProfileInfo {
  bound: boolean;
  environment: LineageRuntimeEnvironment;
  id: string;
  manifest_path?: string;
  service_origin?: string;
  warning?: string;
}

interface LineageRuntimeSchemaInfo {
  migration_keys: string[];
  profile_environment?: LineageRuntimeEnvironment;
  profile_id?: string;
  profile_identity_rows?: number;
}

export interface LineageRuntimeInfo {
  asset_root: string;
  channel: LineageRuntimeChannel;
  database: LineageRuntimeDatabaseInfo;
  fetchedAt: string;
  git_sha?: string;
  node_env?: string;
  package_name: string;
  profile: LineageRuntimeProfileInfo;
  schema: LineageRuntimeSchemaInfo;
  version: string;
}
