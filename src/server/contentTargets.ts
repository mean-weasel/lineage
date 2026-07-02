import { lineageDb, nowIso, type DatabaseSync } from './assetLineageDb';
import { ContentBatchError } from './contentBatches';
import { contentPostHandoff, readinessForPost } from './contentPostHandoff';
import type {
  ContentBatch,
  ContentPost,
  ContentPostAsset,
  ContentTargetFields,
  ContentTargetSnapshot,
} from '../shared/types';

function assetFromRow(row: Record<string, unknown>): ContentPostAsset {
  return {
    asset_id: String(row.asset_id),
    role: String(row.role),
    notes: typeof row.notes === 'string' ? row.notes : undefined,
    attached_at: String(row.attached_at),
  };
}

function batchFromRow(row: Record<string, unknown>): ContentBatch {
  return {
    id: String(row.id),
    project: String(row.project_id),
    title: String(row.title),
    campaign: typeof row.campaign === 'string' ? row.campaign : undefined,
    channel: typeof row.channel === 'string' ? row.channel : undefined,
    status: row.status === 'archived' ? 'archived' : 'active',
    notes: typeof row.notes === 'string' ? row.notes : undefined,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function assetsForPost(database: DatabaseSync, project: string, postId: string): ContentPostAsset[] {
  return (database.prepare(`
    select asset_id, role, notes, attached_at from content_post_assets
    where project_id = ? and post_id = ?
    order by attached_at desc, asset_id
  `).all(project, postId) as Record<string, unknown>[]).map(assetFromRow);
}

function postFromRow(row: Record<string, unknown>, assets: ContentPostAsset[]): ContentPost {
  return {
    id: String(row.id),
    project: String(row.project_id),
    batch_id: String(row.batch_id),
    channel: String(row.channel),
    title: String(row.title),
    phase: String(row.phase) as ContentPost['phase'],
    campaign: typeof row.campaign === 'string' ? row.campaign : undefined,
    body: typeof row.body === 'string' ? row.body : undefined,
    cta: typeof row.cta === 'string' ? row.cta : undefined,
    scheduled_at: typeof row.scheduled_at === 'string' ? row.scheduled_at : undefined,
    posted_at: typeof row.posted_at === 'string' ? row.posted_at : undefined,
    url: typeof row.url === 'string' ? row.url : undefined,
    notes: typeof row.notes === 'string' ? row.notes : undefined,
    source_path: typeof row.source_path === 'string' ? row.source_path : undefined,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    assets,
  };
}

function findPost(database: DatabaseSync, project: string, postId: string): ContentPost {
  const row = database.prepare('select * from content_posts where project_id = ? and id = ?').get(project, postId) as Record<string, unknown> | undefined;
  if (!row) throw new ContentBatchError(`Unknown content post: ${postId}`, 404);
  return postFromRow(row, assetsForPost(database, project, postId));
}

function findBatch(database: DatabaseSync, project: string, batchId: string): ContentBatch {
  const row = database.prepare('select * from content_batches where project_id = ? and id = ?').get(project, batchId) as Record<string, unknown> | undefined;
  if (!row) throw new ContentBatchError(`Unknown content batch: ${batchId}`, 404);
  return batchFromRow(row);
}

export { readinessForPost };

export function getContentTarget(project: string): ContentTargetSnapshot {
  const database = lineageDb();
  try {
    const row = database.prepare('select post_id, notes, selected_at from content_targets where project_id = ?').get(project) as Record<string, unknown> | undefined;
    if (!row) return { fetchedAt: nowIso(), handoff: contentPostHandoff(project), project, selected: false, target: null };
    const postId = String(row.post_id);
    let post: ContentPost;
    try {
      post = findPost(database, project, postId);
    } catch (error) {
      if (error instanceof ContentBatchError && error.status === 404) {
        database.prepare('delete from content_targets where project_id = ?').run(project);
        return {
          fetchedAt: nowIso(),
          handoff: contentPostHandoff(project),
          project,
          selected: false,
          target: null,
          warning: `Selected content target ${postId} no longer exists and was cleared.`,
        };
      }
      throw error;
    }
    return {
      fetchedAt: nowIso(),
      handoff: contentPostHandoff(project, post),
      project,
      selected: true,
      target: {
        batch: findBatch(database, project, post.batch_id),
        handoff: contentPostHandoff(project, post),
        notes: typeof row.notes === 'string' ? row.notes : undefined,
        post,
        readiness: readinessForPost(post),
        selected_at: String(row.selected_at),
      },
    };
  } finally {
    database.close();
  }
}

export function setContentTarget(project: string, fields: ContentTargetFields) {
  const postId = fields.postId.trim();
  if (!postId) throw new ContentBatchError('Content target post id is required');
  if (!fields.confirmWrite) return { ok: true, dryRun: true, message: `Would select content target ${postId}`, preview: { postId, notes: fields.notes } };
  const database = lineageDb();
  const timestamp = nowIso();
  try {
    findPost(database, project, postId);
    database.prepare(`
      insert into content_targets (project_id, post_id, notes, selected_at, updated_at)
      values (?, ?, ?, ?, ?)
      on conflict(project_id) do update set
        post_id = excluded.post_id, notes = excluded.notes,
        selected_at = excluded.selected_at, updated_at = excluded.updated_at
    `).run(project, postId, fields.notes || null, timestamp, timestamp);
  } finally {
    database.close();
  }
  return { ok: true, message: `Selected content target ${postId}`, ...getContentTarget(project) };
}

export function clearContentTarget(project: string, confirmWrite: boolean) {
  if (!confirmWrite) return { ok: true, dryRun: true, message: 'Would clear selected content target' };
  const database = lineageDb();
  try {
    database.prepare('delete from content_targets where project_id = ?').run(project);
  } finally {
    database.close();
  }
  return { ok: true, message: 'Cleared selected content target', ...getContentTarget(project) };
}
