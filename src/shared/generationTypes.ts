import type { LineageNextResponse } from './types';

export type GenerationProvider = 'codex-handoff';
type GenerationJobStatus = 'planned' | 'imported' | 'failed' | 'cancelled';
type GenerationReceiptType = 'plan' | 'import' | 'error';
type GenerationReceiptStatus = 'ok' | 'error';
export type GenerationSourceMode = 'lineage_reroll' | 'lineage_selection';
type GenerationInputRole = 'lineage_next_base' | 'reference' | 'reroll_target';

export interface GenerationJobInput {
  id: string; job_id: string; project_id: string; asset_id: string; root_asset_id: string;
  role: GenerationInputRole; position: number; selection_strategy: string;
  selection_snapshot: LineageNextResponse;
}

export interface GenerationJobOutput {
  id: string; job_id: string; project_id: string; output_index: number; file_path: string;
  checksum_sha256: string; size_bytes: number; content_type: string;
  imported_asset_id: string; parent_asset_id: string; imported_at: string;
}

export interface GenerationJobReceipt {
  id: string; job_id: string; receipt_type: GenerationReceiptType;
  status: GenerationReceiptStatus; command: string; payload: unknown; created_at: string;
}

export interface GenerationHandoffPacket {
  schema_version: 'lineage.generation_handoff.v1';
  provider: GenerationProvider; project: string; job_id: string; prompt: string;
  expected_output_count: number; per_base_count?: number;
  lineage: {
    root_asset_id: string; parent_asset_id: string; selection_strategy: string;
    parent_title: string; parent_local_path?: string; parent_s3_key?: string;
    parents?: Array<{ parent_asset_id: string; parent_title: string; parent_local_path?: string; parent_s3_key?: string; output_indexes: number[] }>;
  };
  instructions: string[]; import_command: string;
  guardrails: {
    live_generation: false; external_services: false;
    output_root: '.asset-scratch'; confirm_write_required: true;
  };
}

export interface GenerationJob {
  id: string; project_id: string; provider: GenerationProvider; adapter_version: string;
  source_mode: GenerationSourceMode; root_asset_id: string; prompt: string;
  expected_output_count: number; status: GenerationJobStatus; output_dir?: string;
  handoff: GenerationHandoffPacket; created_at: string; updated_at: string; imported_at?: string;
  inputs: GenerationJobInput[]; outputs: GenerationJobOutput[]; receipts: GenerationJobReceipt[];
}

export interface GenerationPlanResponse {
  ok: true; command: 'generate image plan' | 'reroll plan'; project: string; dryRun?: true; wouldWrite?: true; job: GenerationJob;
}

export interface GenerationInspectResponse {
  ok: true; command: 'generate image inspect'; project: string; job: GenerationJob;
}

export interface GenerationJobListResponse {
  ok: true; command: 'generate image jobs'; project: string; jobs: GenerationJob[]; fetchedAt: string;
}

export interface GenerationImportResponse {
  ok: true; command: 'generate image import' | 'reroll import'; project: string; job: GenerationJob; imported: GenerationJobOutput[];
}
