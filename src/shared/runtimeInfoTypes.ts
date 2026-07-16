export type LineageRuntimeChannel = 'stable' | 'preview' | 'dev';

export const lineageRuntimeBuildSchemaVersion = 'lineage.runtime_build.v1' as const;
export const lineageRuntimeInstallSchemaVersion = 'lineage.runtime_install.v1' as const;

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
  fingerprint?: string;
  id: string;
  manifest_path?: string;
  service_origin?: string;
  warning?: string;
}

interface LineageRuntimeSchemaInfo {
  migration_keys: string[];
  profile_environment?: LineageRuntimeEnvironment;
  profile_fingerprint?: string;
  profile_id?: string;
}

export interface LineageRuntimeBuildIdentity {
  build_fingerprint: string;
  package_name: string;
  package_version: string;
  schema_version: typeof lineageRuntimeBuildSchemaVersion;
  source_dirty: boolean;
  source_fingerprint: string;
  source_git_sha: string;
}

export interface LineageRuntimeInstallReceipt {
  build_fingerprint: string;
  channel: Exclude<LineageRuntimeChannel, 'dev'>;
  installed_at: string;
  package_integrity: string;
  package_name: string;
  package_root: string;
  package_source: 'local' | 'registry';
  package_spec: string;
  package_tree_sha256: string;
  package_version: string;
  schema_version: typeof lineageRuntimeInstallSchemaVersion;
}

export interface LineageRuntimeCodeIdentity {
  build?: LineageRuntimeBuildIdentity;
  channel: LineageRuntimeChannel;
  dirty?: boolean;
  errors: string[];
  fingerprint: string;
  git_sha?: string;
  install?: LineageRuntimeInstallReceipt & { receipt_path: string };
  origin: 'checkout' | 'package' | 'unknown';
  package_version: string;
  root: string;
  source_fingerprint?: string;
  verified: boolean;
}

export interface LineageRuntimeInfo {
  asset_root: string;
  channel: LineageRuntimeChannel;
  code?: LineageRuntimeCodeIdentity;
  database: LineageRuntimeDatabaseInfo;
  fetchedAt: string;
  git_sha?: string;
  node_env?: string;
  package_name: string;
  profile: LineageRuntimeProfileInfo;
  schema: LineageRuntimeSchemaInfo;
  service?: {
    instance_id?: string;
    launcher_pid?: number;
    pid: number;
    started_at: string;
  };
  version: string;
}
