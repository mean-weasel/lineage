import type { LineageRuntimeChannel } from './runtimeInfoTypes';

export const lineageProfileSchemaVersion = 'lineage.profile.v1' as const;
export const lineageProfileInitSchemaVersion = 'lineage.profile_init.v1' as const;
export const lineageProfileDoctorSchemaVersion = 'lineage.profile_doctor.v1' as const;
export const lineageProfileCloneReceiptSchemaVersion = 'lineage.profile_clone_receipt.v1' as const;
export const lineageProfileAssetsCloneReceiptSchemaVersion = 'lineage.profile_assets_clone_receipt.v1' as const;
export const lineageProfileRuntimeRepinReceiptSchemaVersion = 'lineage.profile_runtime_repin_receipt.v1' as const;

export type LineageProfileEnvironment = 'production' | 'preview' | 'development';

interface LineageProfileExpectedRuntime {
  channel?: LineageRuntimeChannel;
  code_fingerprint?: string;
  code_origin?: 'checkout' | 'package';
  git_sha?: string;
  version?: string;
}

export interface LineageProfileManifest {
  asset_root: string;
  database_path: string;
  environment: LineageProfileEnvironment;
  expected_runtime?: LineageProfileExpectedRuntime;
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

export interface LineageProfileInitResult {
  asset_root: string;
  database_path: string;
  environment: LineageProfileEnvironment;
  identity: LineageProfileIdentity;
  manifest_path: string;
  profile_fingerprint: string;
  profile_id: string;
  runtime: {
    channel: LineageRuntimeChannel;
    code_fingerprint: string;
    code_origin: 'checkout' | 'package';
  };
  schema_version: typeof lineageProfileInitSchemaVersion;
  service_origin: string;
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

export interface LineageProfileRuntimeRepinResult {
  changed: boolean;
  checkout_root: string;
  manifest_after_sha256: string;
  manifest_before_sha256: string;
  manifest_path: string;
  new_code_fingerprint: string;
  previous_code_fingerprint: string;
  profile_fingerprint: string;
  profile_id: string;
  schema_version: typeof lineageProfileRuntimeRepinReceiptSchemaVersion;
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
