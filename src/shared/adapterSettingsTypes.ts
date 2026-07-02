export type AdapterType = 'cloud' | 'scheduler' | 'image_generator';
export type AdapterProvider = 's3' | 'buffer' | 'codex-handoff';
type AdapterHealthStatus = 'configured' | 'missing_config' | 'disabled' | 'not_tested' | 'dry_run_available' | 'live_disabled';

interface AdapterCredentialStatus {
  detected: boolean;
  label: string;
  secret_ref: string | null;
}

export interface AdapterSetting {
  adapter_type: AdapterType;
  provider: AdapterProvider;
  enabled: boolean;
  label: string;
  description: string;
  health_status: AdapterHealthStatus;
  credential: AdapterCredentialStatus;
  safe_config: Record<string, unknown>;
  updated_at: string;
}

export interface AdapterSettingsSnapshot {
  project: string;
  fetchedAt: string;
  settings: AdapterSetting[];
}
