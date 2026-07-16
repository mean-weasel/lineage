import type { LineageRuntimeChannel } from './runtimeInfoTypes';

export const lineageProfileSchemaVersion = 'lineage.profile.v1' as const;
export const lineageProfileDoctorSchemaVersion = 'lineage.profile_doctor.v1' as const;
export const lineageProfileCloneReceiptSchemaVersion = 'lineage.profile_clone_receipt.v1' as const;
export const lineageProfileAssetsCloneReceiptSchemaVersion = 'lineage.profile_assets_clone_receipt.v1' as const;

export type LineageProfileEnvironment = 'production' | 'preview' | 'development';

export interface LineageProfileManifest {
  asset_root: string;
  database_path: string;
  environment: LineageProfileEnvironment;
  expected_runtime?: {
    channel?: LineageRuntimeChannel;
    code_fingerprint?: string;
    code_origin?: 'checkout' | 'package';
    git_sha?: string;
    version?: string;
  };
  profile_id: string;
  required_schema_migrations?: string[];
  schema_version: typeof lineageProfileSchemaVersion;
  service_origin: string;
}

export interface ResolvedLineageProfile extends LineageProfileManifest {
  manifest_path: string;
  profile_fingerprint: string;
}

export interface LineageProfileIdentity {
  bound_at?: string;
  environment: LineageProfileEnvironment;
  profile_fingerprint: string;
  profile_id: string;
}

export interface LineageProfileBindResult {
  already_bound: boolean;
  database_path: string;
  identity: LineageProfileIdentity;
  schema_version: 'lineage.profile_bind.v1';
}

export interface LineageProfileCloneResult {
  database_path: string;
  pages_copied: number;
  receipt_path: string;
  schema_version: typeof lineageProfileCloneReceiptSchemaVersion;
  source_database_path: string;
  target_identity: LineageProfileIdentity;
}

export interface LineageProfileAssetsCloneResult {
  asset_root: string;
  bytes_copied: number;
  code_fingerprint: string;
  database_path: string;
  duplicate_references: number;
  files_copied: number;
  missing_references: number;
  profile_fingerprint: string;
  profile_id: string;
  receipt_path: string;
  references_discovered: number;
  runtime_channel: LineageRuntimeChannel;
  schema_version: typeof lineageProfileAssetsCloneReceiptSchemaVersion;
  source_asset_root: string;
  tree_sha256: string;
}

type LineageProfileDoctorCheckStatus = 'pass' | 'fail' | 'warning';

export interface LineageProfileDoctorCheck {
  id: string;
  message: string;
  status: LineageProfileDoctorCheckStatus;
}

export interface LineageProfileDoctorResult {
  asset_root?: {
    exists: boolean;
    is_directory: boolean;
    path: string;
  };
  checks: LineageProfileDoctorCheck[];
  database?: {
    error?: string;
    exists: boolean;
    identity?: LineageProfileIdentity;
    migration_keys: string[];
    path: string;
  };
  manifest_path?: string;
  ok: boolean;
  profile?: ResolvedLineageProfile;
  runtime: {
    channel: LineageRuntimeChannel;
    code_fingerprint?: string;
    code_origin?: 'checkout' | 'package' | 'unknown';
    code_verified?: boolean;
    git_sha?: string;
    version: string;
  };
  schema_version: typeof lineageProfileDoctorSchemaVersion;
}
