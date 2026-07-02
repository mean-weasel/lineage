export type ContentPostPhase = 'draft' | 'review' | 'scheduled' | 'posted' | 'skipped' | 'archived';
export type ContentPostReadiness = 'needs_asset' | 'draft_ready' | 'in_review' | 'scheduled' | 'posted' | 'skipped_or_archived';
export type ContentOpsQueueLaneId = 'next_target' | ContentPostReadiness;
export type AssetSelectionSetKind = 'current' | 'review';
export type AssetSelectionItemRole = 'primary' | 'candidate' | 'next_base';
export type AssetSelectionActor = 'human' | 'agent' | 'system';

export interface AssetSelectionItem {
  id: string;
  set_id: string;
  asset_id: string;
  role: AssetSelectionItemRole;
  variation_label?: string;
  position: number;
  selected_by?: AssetSelectionActor;
  selected_at?: string;
  deselected_at?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface AssetSelectionSet {
  id: string;
  project: string;
  kind: AssetSelectionSetKind;
  key: string;
  label: string;
  status: 'active' | 'archived';
  created_by: AssetSelectionActor;
  created_at: string;
  updated_at: string;
  items: AssetSelectionItem[];
}

export interface AssetSelectionSnapshot {
  project: string;
  fetchedAt: string;
  current: AssetSelectionSet;
  active_review_set: AssetSelectionSet | null;
  review_sets: AssetSelectionSet[];
}

export type AssetSelectionWorkPacketStorageState = 'local_only' | 's3_backed' | 'local_and_s3' | 'unresolved';

export interface AssetSelectionWorkPacketCandidate {
  asset_id: string;
  label: string;
  selected: boolean;
  source: 'catalog' | 'local' | 'unknown';
  storage_state: AssetSelectionWorkPacketStorageState;
  title: string;
  local_path?: string;
  s3_key?: string;
  notes?: string;
}

export interface AssetSelectionWorkPacket {
  kind: 'asset_selection_work_packet';
  project: string;
  fetched_at: string;
  review_set: {
    id: string;
    key: string;
    label: string;
    selected_count: number;
    status: 'active' | 'archived';
    total_candidates: number;
  } | null;
  candidates: AssetSelectionWorkPacketCandidate[];
  selected_assets: string[];
  suggested_next_action: 'choose_variations' | 'continue_selected_assets' | 'create_review_set';
  commands: {
    chooseLabelsTemplate: string;
    currentSelectionCommand: string;
    inspectReviewSetCommand?: string;
    plainEnglishContinue: string;
    setNextCommand?: string;
  };
}

export interface ContentBatch {
  id: string;
  project: string;
  title: string;
  campaign?: string;
  channel?: string;
  status: 'active' | 'archived';
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface ContentPostAsset {
  asset_id: string;
  role: string;
  notes?: string;
  attached_at: string;
}

export interface ContentPost {
  id: string;
  project: string;
  batch_id: string;
  channel: string;
  title: string;
  phase: ContentPostPhase;
  campaign?: string;
  body?: string;
  cta?: string;
  scheduled_at?: string;
  posted_at?: string;
  url?: string;
  notes?: string;
  source_path?: string;
  created_at: string;
  updated_at: string;
  assets: ContentPostAsset[];
  handoff?: ContentTargetHandoff;
  readiness?: ContentPostReadiness;
}

export interface ContentBatchSummary extends ContentBatch {
  post_count: number;
  phase_counts: Record<ContentPostPhase, number>;
}

export interface ContentBatchSnapshot {
  project: string;
  fetchedAt: string;
  batches: ContentBatchSummary[];
}

export interface ContentBatchDetail {
  project: string;
  fetchedAt: string;
  batch: ContentBatch;
  posts: ContentPost[];
  handoff: {
    inspectCommand: string;
    createPostTemplate: string;
    attachAssetTemplate: string;
    phaseTemplate: string;
  };
}

export interface ContentTargetHandoff {
  agentPrompt: string;
  attachAssetTemplate: string;
  clearTargetCommand: string;
  inspectBatchCommand?: string;
  inspectTargetCommand: string;
  markPostedTemplate: string;
  moveToReviewCommand: string;
  scheduleTemplate: string;
  setTargetTemplate: string;
}

interface ContentTargetDetail {
  batch: ContentBatch;
  handoff: ContentTargetHandoff;
  notes?: string;
  post: ContentPost;
  readiness: ContentPostReadiness;
  selected_at: string;
}

export interface ContentTargetSnapshot {
  fetchedAt: string;
  handoff: ContentTargetHandoff;
  project: string;
  selected: boolean;
  target: ContentTargetDetail | null;
  warning?: string;
}

export interface ContentTargetFields {
  confirmWrite: boolean;
  notes?: string;
  postId: string;
}

type ContentAgentHandoffStatus = 'ok' | 'empty' | 'needs_clarification' | 'blocked' | 'error';
type ContentAgentHandoffSelectionMode = 'asset_selection' | 'lineage_workspace' | 'next_action' | 'review_set_choice' | 'selected_target' | 'unresolved';
type ContentAgentHandoffMessageLevel = 'info' | 'warning' | 'question' | 'error';
type ContentAgentHandoffResolvedIntent = 'asset.selection.current' | 'asset.selection.choose_variations' | 'content.queue.next' | 'content.target.selected' | 'lineage.workspace.active' | 'content.handoff.unresolved';
type ContentAgentHandoffNaturalIntent = 'asset.selection.choose_variations' | 'asset.selection.current' | 'content.queue.next' | 'content.target.selected' | 'lineage.workspace.active' | 'ambiguous' | 'blocked' | 'empty' | 'unsupported';

interface ContentAgentContentTarget {
  asset_count: number;
  batch_id: string;
  channel: string;
  id: string;
  is_selected_target: boolean;
  phase: ContentPostPhase;
  project: string;
  readiness: ContentPostReadiness;
  title: string;
  type: 'content_post';
}

interface ContentAgentLineageTarget {
  id: string;
  latest_count: number;
  next_asset_id?: string;
  next_asset_ids?: string[];
  project: string;
  root_asset_id: string;
  status: 'active' | 'paused' | 'archived';
  title: string;
  type: 'lineage_workspace';
}

export type ContentAgentHandoffTarget = ContentAgentContentTarget | ContentAgentLineageTarget;

interface ContentAgentHandoffCanonicalCall {
  args: Record<string, string | boolean | null>;
  command: string;
  tool: 'asset_studio_cli';
}

export interface ContentAgentHandoffNextAction {
  canonical_call: ContentAgentHandoffCanonicalCall;
  commands: Partial<ContentTargetHandoff> | Record<string, string>;
  instructions: string;
  kind: 'choose_asset_variations' | 'continue_asset_selection' | 'continue_content_item' | 'continue_lineage_workspace';
  label: string;
  lane: ContentOpsQueueLaneId | null;
}

export interface ContentAgentHandoff {
  context: {
    asset_work_packet?: AssetSelectionWorkPacket;
    notes: string[];
    related_assets: string[];
    selected_assets?: string[];
    selection_set_id?: string;
    selected_target: ContentAgentHandoffTarget | null;
  };
  guardrails: {
    do_not_modify: string[];
    requires_confirmation: boolean;
    safe_to_start: boolean;
    write_scope: string[];
  };
  intent: {
    project: string;
    resolved: ContentAgentHandoffResolvedIntent;
    selection_mode: ContentAgentHandoffSelectionMode;
  };
  messages: Array<{
    level: ContentAgentHandoffMessageLevel;
    text: string;
  }>;
  next_action: ContentAgentHandoffNextAction | null;
  schema_version: 'asset_studio.agent_handoff.v1';
  status: ContentAgentHandoffStatus;
  target: ContentAgentHandoffTarget | null;
}

export interface ContentAgentHandoffNaturalLanguage {
  matched_intent: ContentAgentHandoffNaturalIntent;
  matched_terms: string[];
  normalized_prompt: string;
  project_alias: string | null;
  prompt: string;
}

export interface ContentAgentResolvedHandoff extends ContentAgentHandoff {
  natural_language: ContentAgentHandoffNaturalLanguage;
}

export interface ContentOpsQueueAssetStorage {
  local: number;
  s3: number;
  total: number;
  unresolved: number;
}

export interface ContentOpsQueueBackupCue {
  approved_local: number;
  label: string;
  local_and_s3: number;
  local_backup_command?: string;
  local_only: number;
  local_queue_command?: string;
  local_review_command?: string;
  needs_review: number;
  s3_backed: number;
  unresolved: number;
}

export interface ContentOpsQueueItem {
  asset_storage: ContentOpsQueueAssetStorage;
  attached_asset_count: number;
  backup_cue?: ContentOpsQueueBackupCue;
  handoff?: ContentTargetHandoff;
  is_target: boolean;
  post: ContentPost;
  readiness: ContentPostReadiness;
}

export interface ContentOpsQueueLane {
  id: ContentOpsQueueLaneId;
  label: string;
  items: ContentOpsQueueItem[];
  total: number;
}

export interface ContentOpsQueueLaneSummary {
  id: ContentOpsQueueLaneId;
  label: string;
  total: number;
}

export interface ContentOpsQueueSnapshot {
  fetchedAt: string;
  handoff: {
    inspectQueueCommand: string;
    inspectTargetCommand: string;
    listPostsCommand: string;
  };
  lanes: ContentOpsQueueLane[];
  next_action: ContentOpsQueueItem | null;
  next_action_lane: ContentOpsQueueLaneSummary | null;
  project: string;
  target: ContentTargetSnapshot['target'];
  totals: {
    attached_assets: number;
    lanes: Record<ContentOpsQueueLaneId, number>;
    posts: number;
    selected_target: number;
    storage: ContentOpsQueueAssetStorage;
  };
  warning?: string;
}

export interface ContentBatchFields {
  batchId: string;
  title: string;
  campaign?: string;
  channel?: string;
  notes?: string;
  confirmWrite: boolean;
}

export interface ContentPostFields {
  postId: string;
  batchId: string;
  channel: string;
  title: string;
  phase?: ContentPostPhase;
  campaign?: string;
  body?: string;
  cta?: string;
  scheduledAt?: string;
  postedAt?: string;
  url?: string;
  notes?: string;
  sourcePath?: string;
  confirmWrite: boolean;
}

export interface ContentPostUpdateFields {
  postId: string;
  batchId?: string;
  channel?: string;
  title?: string;
  phase?: ContentPostPhase;
  campaign?: string;
  body?: string;
  cta?: string;
  scheduledAt?: string;
  postedAt?: string;
  url?: string;
  notes?: string;
  sourcePath?: string;
  confirmWrite: boolean;
}

export interface ContentPostAssetFields {
  postId: string;
  assetId: string;
  role?: string;
  notes?: string;
  confirmWrite: boolean;
}
