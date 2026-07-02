import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './assetCore';

const require = createRequire(import.meta.url);
export type DatabaseSync = DatabaseSyncType;

export function nowIso(): string {
  return new Date().toISOString();
}

export function lineageDbPath(): string {
  return process.env.ASSET_STUDIO_DB || join(repoRoot, '.asset-studio', 'asset-lineage.sqlite');
}

export function lineageDb(): DatabaseSync {
  mkdirSync(join(lineageDbPath(), '..'), { recursive: true });
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const database = new DatabaseSync(lineageDbPath());
  database.exec('PRAGMA foreign_keys = ON'); database.exec('PRAGMA busy_timeout = 5000');
  database.exec(`
    create table if not exists projects (
      id text primary key,
      product text not null,
      catalog_path text,
      created_at text not null,
      updated_at text not null
    );
    create table if not exists assets (
      id text primary key,
      project_id text not null references projects(id),
      source text not null check (source in ('local', 'catalog')),
      local_path text,
      s3_key text,
      checksum_sha256 text,
      media_type text not null,
      title text not null,
      status text not null,
      channel text,
      campaign text,
      audience text,
      size_bytes integer,
      content_type text,
      created_at text not null,
      updated_at text not null,
      last_seen_at text not null
    );
    create index if not exists assets_project_source_seen on assets(project_id, source, last_seen_at);
    create index if not exists assets_project_checksum on assets(project_id, checksum_sha256);
    create index if not exists assets_project_channel_campaign on assets(project_id, channel, campaign);
    create table if not exists asset_edges (
      id text primary key,
      project_id text not null references projects(id),
      parent_asset_id text not null references assets(id),
      child_asset_id text not null references assets(id),
      relation_type text not null check (relation_type in ('derived_from')),
      created_at text not null,
      unique (project_id, parent_asset_id, child_asset_id, relation_type)
    );
    create index if not exists edges_parent on asset_edges(project_id, parent_asset_id);
    create index if not exists edges_child on asset_edges(project_id, child_asset_id);
    create table if not exists asset_reviews (
      asset_id text primary key references assets(id),
      review_state text not null check (review_state in ('unreviewed', 'approved', 'needs_revision', 'rejected', 'ignored')),
      reviewed_at text,
      ignored_at text,
      notes text,
      updated_at text not null
    );
    create table if not exists asset_selections (
      id text primary key,
      project_id text not null references projects(id),
      root_asset_id text not null references assets(id),
      asset_id text not null references assets(id),
      notes text,
      selected_at text not null,
      unique(project_id, root_asset_id)
    );
    create table if not exists asset_layouts (
      id text primary key,
      project_id text not null references projects(id),
      root_asset_id text not null references assets(id),
      asset_id text not null references assets(id),
      x real not null,
      y real not null,
      updated_at text not null,
      unique(project_id, root_asset_id, asset_id)
    );
    create table if not exists lineage_workspaces (
      id text primary key,
      project_id text not null references projects(id),
      root_asset_id text not null references assets(id),
      title text not null,
      status text not null check (status in ('active', 'paused', 'archived')),
      notes text,
      created_by text not null check (created_by in ('human', 'agent', 'system')),
      active_at text,
      created_at text not null,
      updated_at text not null,
      unique(project_id, root_asset_id)
    );
    create index if not exists lineage_workspaces_project_status on lineage_workspaces(project_id, status, updated_at);
    create index if not exists lineage_workspaces_project_active on lineage_workspaces(project_id, active_at);
    create table if not exists asset_ledger_records (
      id text primary key,
      project_id text not null references projects(id),
      canonical_asset_id text not null,
      checksum_sha256 text,
      media_type text not null,
      title text not null,
      status text not null,
      channel text,
      campaign text,
      audience text,
      created_at text not null,
      updated_at text not null,
      first_seen_at text not null default (datetime('now')),
      last_seen_at text not null
    );
    create index if not exists asset_ledger_records_project_seen on asset_ledger_records(project_id, last_seen_at);
    create index if not exists asset_ledger_records_project_checksum on asset_ledger_records(project_id, checksum_sha256);
    create table if not exists asset_ledger_sources (
      id text primary key,
      project_id text not null references projects(id),
      record_id text not null references asset_ledger_records(id) on delete cascade,
      source_type text not null check (source_type in ('local', 'catalog', 's3')),
      asset_id text,
      local_path text,
      s3_bucket text,
      s3_region text,
      s3_key text,
      s3_version_id text,
      etag text,
      size_bytes integer,
      content_type text,
      updated_at text,
      first_seen_at text not null default (datetime('now')),
      last_seen_at text not null
    );
    create index if not exists asset_ledger_sources_project_type on asset_ledger_sources(project_id, source_type);
    create index if not exists asset_ledger_sources_record on asset_ledger_sources(project_id, record_id);
    create index if not exists asset_ledger_sources_s3_key on asset_ledger_sources(project_id, s3_key);
    create table if not exists asset_ledger_placements (
      id text primary key,
      project_id text not null references projects(id),
      asset_id text not null,
      channel text not null,
      status text not null,
      scheduled_at text,
      posted_at text,
      url text,
      notes text,
      updated_at text not null,
      synced_at text not null,
      unique(project_id, asset_id, channel)
    );
    create index if not exists asset_ledger_placements_project_status on asset_ledger_placements(project_id, status);
    create index if not exists asset_ledger_placements_asset on asset_ledger_placements(project_id, asset_id);
    create table if not exists asset_ledger_index_runs (
      id text primary key,
      project_id text not null references projects(id),
      source_mode text not null check (source_mode in ('all', 'catalog', 'local')),
      include_live_s3 integer not null default 0,
      status text not null check (status in ('running', 'complete', 'failed')),
      started_at text not null,
      completed_at text,
      assets_indexed integer not null default 0,
      records_after integer not null default 0,
      catalog_sources_after integer not null default 0,
      local_sources_after integer not null default 0,
      s3_sources_after integer not null default 0,
      error text
    );
    create index if not exists asset_ledger_index_runs_project_started on asset_ledger_index_runs(project_id, started_at);
    create table if not exists content_batches (
      id text not null,
      project_id text not null references projects(id),
      title text not null,
      campaign text,
      channel text,
      status text not null check (status in ('active', 'archived')),
      notes text,
      created_at text not null,
      updated_at text not null,
      primary key(project_id, id)
    );
    create index if not exists content_batches_project_updated on content_batches(project_id, updated_at);
    create table if not exists content_posts (
      id text not null,
      project_id text not null references projects(id),
      batch_id text not null,
      channel text not null,
      title text not null,
      phase text not null check (phase in ('draft', 'review', 'scheduled', 'posted', 'skipped', 'archived')),
      campaign text,
      body text,
      cta text,
      scheduled_at text,
      posted_at text,
      url text,
      notes text,
      source_path text,
      created_at text not null,
      updated_at text not null,
      primary key(project_id, id),
      foreign key(project_id, batch_id) references content_batches(project_id, id) on delete cascade
    );
    create index if not exists content_posts_project_phase on content_posts(project_id, phase);
    create index if not exists content_posts_batch on content_posts(project_id, batch_id);
    create table if not exists content_post_assets (
      id text primary key,
      project_id text not null references projects(id),
      post_id text not null,
      asset_id text not null,
      role text not null,
      notes text,
      attached_at text not null,
      unique(project_id, post_id, asset_id, role),
      foreign key(project_id, post_id) references content_posts(project_id, id) on delete cascade
    );
    create index if not exists content_post_assets_post on content_post_assets(project_id, post_id);
    create index if not exists content_post_assets_asset on content_post_assets(project_id, asset_id);
    create table if not exists content_targets (
      project_id text primary key references projects(id),
      post_id text not null,
      notes text,
      selected_at text not null,
      updated_at text not null,
      foreign key(project_id, post_id) references content_posts(project_id, id) on delete cascade
    );
    create table if not exists selection_sets (
      id text primary key,
      project_id text not null references projects(id),
      kind text not null check (kind in ('current', 'review')),
      key text not null,
      label text not null,
      status text not null check (status in ('active', 'archived')),
      created_by text not null check (created_by in ('human', 'agent', 'system')),
      created_at text not null,
      updated_at text not null,
      unique(project_id, kind, key)
    );
    create index if not exists selection_sets_project_kind on selection_sets(project_id, kind, updated_at);
    create table if not exists selection_items (
      id text primary key,
      set_id text not null references selection_sets(id) on delete cascade,
      asset_id text not null,
      role text not null check (role in ('primary', 'candidate', 'next_base')),
      variation_label text,
      position integer not null default 0,
      selected_by text check (selected_by in ('human', 'agent', 'system')),
      selected_at text,
      deselected_at text,
      notes text,
      created_at text not null,
      updated_at text not null,
      unique(set_id, asset_id)
    );
    create index if not exists selection_items_set_position on selection_items(set_id, position);
    create unique index if not exists selection_items_set_label on selection_items(set_id, variation_label) where variation_label is not null;
    create table if not exists generation_jobs (
      id text primary key,
      project_id text not null references projects(id),
      provider text not null default 'codex-handoff',
      adapter_version text not null,
      source_mode text not null check (source_mode in ('lineage_selection')),
      root_asset_id text not null references assets(id),
      prompt text not null,
      expected_output_count integer not null check (expected_output_count > 0),
      status text not null check (status in ('planned', 'imported', 'failed', 'cancelled')),
      output_dir text,
      handoff_json text,
      created_at text not null,
      updated_at text not null,
      imported_at text
    );
    create index if not exists generation_jobs_project_created on generation_jobs(project_id, created_at);
    create table if not exists generation_job_inputs (
      id text primary key,
      job_id text not null references generation_jobs(id) on delete cascade,
      project_id text not null references projects(id),
      asset_id text not null references assets(id),
      root_asset_id text not null references assets(id),
      role text not null check (role in ('lineage_next_base', 'reference')),
      position integer not null,
      selection_strategy text not null,
      selection_snapshot_json text not null,
      unique(job_id, asset_id, role)
    );
    create index if not exists generation_job_inputs_job on generation_job_inputs(job_id, position);
    create table if not exists generation_job_outputs (
      id text primary key,
      job_id text not null references generation_jobs(id) on delete cascade,
      project_id text not null references projects(id),
      output_index integer not null,
      file_path text not null,
      checksum_sha256 text not null,
      size_bytes integer not null,
      content_type text not null,
      imported_asset_id text not null references assets(id),
      parent_asset_id text not null references assets(id),
      imported_at text not null,
      unique(job_id, output_index),
      unique(job_id, file_path)
    );
    create index if not exists generation_job_outputs_job on generation_job_outputs(job_id, output_index);
    create table if not exists generation_job_receipts (
      id text primary key,
      job_id text not null references generation_jobs(id) on delete cascade,
      receipt_type text not null check (receipt_type in ('plan', 'import', 'error')),
      status text not null check (status in ('ok', 'error')),
      command text not null,
      payload_json text not null,
      created_at text not null
    );
    create index if not exists generation_job_receipts_job on generation_job_receipts(job_id, created_at);
    create table if not exists adapter_settings (project_id text not null references projects(id), adapter_type text not null check (adapter_type in ('cloud', 'scheduler', 'image_generator')), provider text not null, enabled integer not null check (enabled in (0, 1)), secret_ref text, safe_config_json text not null, created_at text not null, updated_at text not null, primary key(project_id, adapter_type, provider)); create index if not exists adapter_settings_project_type on adapter_settings(project_id, adapter_type);
  `);
  migrateAssetSelections(database);
  dropLegacyAssetSelectionRootUnique(database);
  ensureColumn(database, 'asset_selections', 'notes', 'text');
  ensureColumn(database, 'asset_ledger_records', 'first_seen_at', 'text');
  ensureColumn(database, 'asset_ledger_records', 'indexed_by_run_id', 'text');
  ensureColumn(database, 'asset_ledger_sources', 'first_seen_at', 'text');
  ensureColumn(database, 'asset_ledger_sources', 'indexed_by_run_id', 'text');
  ensureReviewStateValues(database);
  return database;
}

function ensureColumn(database: DatabaseSync, table: string, column: string, definition: string): void {
  const rows = database.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some(row => row.name === column)) database.exec(`alter table ${table} add column ${column} ${definition}`);
}

function migrateAssetSelections(database: DatabaseSync): void {
  const rows = database.prepare('pragma table_info(asset_selections)').all() as Array<{ name: string }>;
  if (rows.some(row => row.name === 'position')) return;
  const notesSelect = rows.some(row => row.name === 'notes') ? 'notes' : 'null';

  database.exec(`
    create table if not exists asset_selections_v2 (
      id text primary key,
      project_id text not null references projects(id),
      root_asset_id text not null references assets(id),
      asset_id text not null references assets(id),
      position integer not null default 0,
      notes text,
      selected_at text not null,
      unique(project_id, root_asset_id, asset_id)
    );
    insert or ignore into asset_selections_v2 (id, project_id, root_asset_id, asset_id, position, notes, selected_at)
      select
        project_id || ':' || root_asset_id || ':selected:' || asset_id,
        project_id,
        root_asset_id,
        asset_id,
        0,
        ${notesSelect},
        selected_at
      from asset_selections;
    drop table asset_selections;
    alter table asset_selections_v2 rename to asset_selections;
    create index if not exists asset_selections_project_root_position
      on asset_selections(project_id, root_asset_id, position, selected_at);
  `);
}

function dropLegacyAssetSelectionRootUnique(database: DatabaseSync): void {
  const indexes = database.prepare('pragma index_list(asset_selections)').all() as Array<{ name: string; unique: number }>;
  for (const index of indexes) {
    if (!index.unique) continue;
    const columns = database.prepare(`pragma index_info(${index.name})`).all() as Array<{ name: string }>;
    const columnNames = columns.map(column => column.name).join(',');
    if (columnNames === 'project_id,root_asset_id') database.exec(`drop index if exists ${index.name}`);
  }
}

function ensureReviewStateValues(database: DatabaseSync): void {
  const createSql = database.prepare("select sql from sqlite_master where type = 'table' and name = 'asset_reviews'").get() as { sql?: string } | undefined;
  if (createSql?.sql?.includes('needs_revision')) return;

  database.exec(`
    alter table asset_reviews rename to asset_reviews_old;
    create table asset_reviews (
      asset_id text primary key references assets(id),
      review_state text not null check (review_state in ('unreviewed', 'approved', 'needs_revision', 'rejected', 'ignored')),
      reviewed_at text,
      ignored_at text,
      notes text,
      updated_at text not null
    );
    insert into asset_reviews (asset_id, review_state, reviewed_at, ignored_at, notes, updated_at)
    select asset_id, review_state, reviewed_at, ignored_at, notes, updated_at
    from asset_reviews_old;
    drop table asset_reviews_old;
  `);
}
