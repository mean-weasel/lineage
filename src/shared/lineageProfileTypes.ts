import type { LineageRuntimeChannel } from './runtimeInfoTypes';

export const lineageProfileSchemaVersion = 'lineage.profile.v1' as const;
export const lineageProfileDoctorSchemaVersion = 'lineage.profile_doctor.v1' as const;

export type LineageProfileEnvironment = 'production' | 'preview' | 'development';

export interface LineageProfileManifest {
  asset_root: string;
  database_path: string;
  environment: LineageProfileEnvironment;
  expected_runtime?: {
    channel?: LineageRuntimeChannel;
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
}

export interface LineageProfileIdentity {
  bound_at?: string;
  environment: LineageProfileEnvironment;
  profile_id: string;
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
    git_sha?: string;
    version: string;
  };
  schema_version: typeof lineageProfileDoctorSchemaVersion;
}
