export type LineageSelectionPacketStorageState = 'local_and_s3' | 'local_only' | 's3_backed' | 'unresolved';

export interface LineageSelectionPacketContext {
  campaign?: string;
  channel?: string;
  labels: string[];
  notes?: string;
}

export interface LineageSelectionPacketWorkspace {
  active_at?: string;
  id: string;
  notes?: string;
  root_asset_id: string;
  status: string;
  title: string;
}

export interface LineageSelectionPacketSelectedItem {
  asset_id: string;
  position: number;
  selected_at: string;
  selection_note?: string;
}

export interface LineageSelectionPacketLocalMedia {
  absolute_path?: string;
  content_type?: string;
  exists: boolean;
  relative_path?: string;
  size_bytes?: number;
}

export interface LineageSelectionPacketS3Media {
  bucket?: string;
  checksum_sha256?: string;
  content_type?: string;
  etag?: string;
  key?: string;
  region?: string;
  size_bytes?: number;
  version_id?: string;
}

export interface LineageSelectionPacketAttempt {
  asset_id: string;
  checksum_sha256?: string;
  file_path?: string;
  generation_job_id?: string;
  id: string;
  is_current: boolean;
  source: string;
}

export interface LineageSelectionPacketAsset {
  asset_id: string;
  campaign?: string;
  channel?: string;
  checksum_sha256?: string;
  current_attempt?: LineageSelectionPacketAttempt;
  dimensions?: {
    height: number;
    width: number;
  };
  local: LineageSelectionPacketLocalMedia;
  media_type?: string;
  mime_type?: string;
  review_notes?: string;
  review_state?: string;
  s3: LineageSelectionPacketS3Media;
  selection_note?: string;
  source?: string;
  status?: string;
  storage_state: LineageSelectionPacketStorageState;
  title: string;
}

export interface LineageSelectionPacket {
  assets: LineageSelectionPacketAsset[];
  context: LineageSelectionPacketContext;
  created_at: string;
  errors: string[];
  kind: 'lineage.selection_packet';
  packet_id: string;
  product: string;
  project: string;
  schema_version: 'lineage.selection_packet.v1';
  selection: {
    asset_ids: string[];
    count: number;
    items: LineageSelectionPacketSelectedItem[];
    root_asset_id: string;
  };
  source: {
    app: 'lineage';
    command?: string;
    db_path?: string;
    package?: string;
  };
  warnings: string[];
  workspace: LineageSelectionPacketWorkspace;
}
