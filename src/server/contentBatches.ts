import { lineageDb, nowIso, type DatabaseSync } from './assetLineageDb';
import { contentPostHandoff, readinessForPost } from './contentPostHandoff';
import type {
  ContentBatch,
  ContentBatchDetail,
  ContentBatchFields,
  ContentBatchSnapshot,
  ContentBatchSummary,
  ContentPost,
  ContentPostAsset,
  ContentPostAssetFields,
  ContentPostFields,
  ContentPostPhase,
  ContentPostUpdateFields,
} from '../shared/types';

const phases = new Set<ContentPostPhase>(['draft', 'review', 'scheduled', 'posted', 'skipped', 'archived']);

export class ContentBatchError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function isContentBatchError(error: unknown): error is ContentBatchError {
  return error instanceof ContentBatchError;
}

function ensureProject(database: DatabaseSync, project: string): void {
  const timestamp = nowIso();
  database.prepare(`
    insert into projects (id, product, created_at, updated_at)
    values (?, ?, ?, ?)
    on conflict(id) do update set product = excluded.product, updated_at = excluded.updated_at
  `).run(project, project, timestamp, timestamp);
}

function requireText(value: string | undefined, label: string): string {
  const text = value?.trim();
  if (!text) throw new ContentBatchError(`Content ${label} is required`);
  return text;
}

function normalizePhase(value: string | undefined): ContentPostPhase {
  const phase = (value || 'draft').replace(/-/g, '_') as ContentPostPhase;
  if (!phases.has(phase)) throw new ContentBatchError(`Unsupported content post phase: ${phase}`);
  return phase;
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

function assetFromRow(row: Record<string, unknown>): ContentPostAsset {
  return {
    asset_id: String(row.asset_id),
    role: String(row.role),
    notes: typeof row.notes === 'string' ? row.notes : undefined,
    attached_at: String(row.attached_at),
  };
}

function postFromRow(row: Record<string, unknown>, assets: ContentPostAsset[]): ContentPost {
  const post = basePost(row, assets);
  return { ...post, handoff: contentPostHandoff(post.project, post), readiness: readinessForPost(post) };
}

function basePost(row: Record<string, unknown>, assets: ContentPostAsset[]): ContentPost {
  return {
    id: String(row.id),
    project: String(row.project_id),
    batch_id: String(row.batch_id),
    channel: String(row.channel),
    title: String(row.title),
    phase: normalizePhase(String(row.phase)),
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

function postsForBatch(database: DatabaseSync, project: string, batchId: string): ContentPost[] {
  const rows = database.prepare(`
    select * from content_posts
    where project_id = ? and batch_id = ?
    order by updated_at desc, id
  `).all(project, batchId) as Record<string, unknown>[];
  return rows.map(row => postFromRow(row, assetsForPost(database, project, String(row.id))));
}

function assetsForPost(database: DatabaseSync, project: string, postId: string): ContentPostAsset[] {
  return (database.prepare(`
    select asset_id, role, notes, attached_at
    from content_post_assets
    where project_id = ? and post_id = ?
    order by attached_at desc, asset_id
  `).all(project, postId) as Record<string, unknown>[]).map(assetFromRow);
}

function phaseCounts(posts: ContentPost[]): Record<ContentPostPhase, number> {
  return Object.fromEntries([...phases].map(phase => [phase, posts.filter(post => post.phase === phase).length])) as Record<ContentPostPhase, number>;
}

function handoff(project: string, batchId: string): ContentBatchDetail['handoff'] {
  const prefix = `npx lineage content`;
  return {
    inspectCommand: `${prefix} batch inspect --project ${project} --batch-id ${batchId} --json`,
    createPostTemplate: `${prefix} post create --project ${project} --batch-id ${batchId} --post-id <post-id> --channel <channel> --title <title> --confirm-write --json`,
    attachAssetTemplate: `${prefix} post attach-asset --project ${project} --post-id <post-id> --asset-id <asset-id> --role primary --confirm-write --json`,
    phaseTemplate: `${prefix} post phase --project ${project} --post-id <post-id> --phase scheduled --scheduled-at <iso> --confirm-write --json`,
  };
}

export function listContentBatches(project: string): ContentBatchSnapshot {
  const database = lineageDb();
  try {
    const rows = database.prepare(`
      select * from content_batches
      where project_id = ?
      order by updated_at desc, id
    `).all(project) as Record<string, unknown>[];
    const batches = rows.map(row => {
      const batch = batchFromRow(row);
      const posts = postsForBatch(database, project, batch.id);
      return { ...batch, post_count: posts.length, phase_counts: phaseCounts(posts) } satisfies ContentBatchSummary;
    });
    return { project, fetchedAt: nowIso(), batches };
  } finally {
    database.close();
  }
}

export function getContentBatch(project: string, batchId: string): ContentBatchDetail {
  const database = lineageDb();
  try {
    const row = database.prepare('select * from content_batches where project_id = ? and id = ?').get(project, batchId) as Record<string, unknown> | undefined;
    if (!row) throw new ContentBatchError(`Unknown content batch: ${batchId}`, 404);
    const batch = batchFromRow(row);
    return { project, fetchedAt: nowIso(), batch, posts: postsForBatch(database, project, batch.id), handoff: handoff(project, batch.id) };
  } finally {
    database.close();
  }
}

export function createContentBatch(project: string, fields: ContentBatchFields) {
  const batchId = requireText(fields.batchId, 'batch id');
  const preview = { id: batchId, project, title: requireText(fields.title, 'batch title'), campaign: fields.campaign, channel: fields.channel, notes: fields.notes };
  if (!fields.confirmWrite) return { ok: true, dryRun: true, message: `Would create content batch ${batchId}`, preview };
  const database = lineageDb();
  const timestamp = nowIso();
  try {
    ensureProject(database, project);
    database.prepare(`
      insert into content_batches (id, project_id, title, campaign, channel, status, notes, created_at, updated_at)
      values (?, ?, ?, ?, ?, 'active', ?, ?, ?)
      on conflict(project_id, id) do update set
        title = excluded.title, campaign = excluded.campaign, channel = excluded.channel,
        status = 'active', notes = excluded.notes, updated_at = excluded.updated_at
    `).run(batchId, project, preview.title, fields.campaign || null, fields.channel || null, fields.notes || null, timestamp, timestamp);
    return { ok: true, message: `Saved content batch ${batchId}`, batch: getContentBatch(project, batchId).batch };
  } finally {
    database.close();
  }
}

export function createContentPost(project: string, fields: ContentPostFields) {
  const postId = requireText(fields.postId, 'post id');
  const batchId = requireText(fields.batchId, 'batch id');
  const phase = normalizePhase(fields.phase);
  const preview = { ...fields, postId, batchId, phase, project, title: requireText(fields.title, 'post title'), channel: requireText(fields.channel, 'post channel') };
  if (!fields.confirmWrite) return { ok: true, dryRun: true, message: `Would create content post ${postId}`, preview };
  const database = lineageDb();
  const timestamp = nowIso();
  try {
    ensureProject(database, project);
    const batch = database.prepare('select id from content_batches where project_id = ? and id = ?').get(project, batchId);
    if (!batch) throw new ContentBatchError(`Unknown content batch: ${batchId}`, 404);
    database.prepare(`
      insert into content_posts (
        id, project_id, batch_id, channel, title, phase, campaign, body, cta,
        scheduled_at, posted_at, url, notes, source_path, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(project_id, id) do update set
        batch_id = excluded.batch_id, channel = excluded.channel, title = excluded.title,
        phase = excluded.phase, campaign = excluded.campaign, body = excluded.body,
        cta = excluded.cta, scheduled_at = excluded.scheduled_at, posted_at = excluded.posted_at,
        url = excluded.url, notes = excluded.notes, source_path = excluded.source_path,
        updated_at = excluded.updated_at
    `).run(postId, project, batchId, preview.channel, preview.title, phase, fields.campaign || null, fields.body || null, fields.cta || null, fields.scheduledAt || null, fields.postedAt || null, fields.url || null, fields.notes || null, fields.sourcePath || null, timestamp, timestamp);
    return { ok: true, message: `Saved content post ${postId}`, post: findContentPost(database, project, postId) };
  } finally {
    database.close();
  }
}

function findContentPost(database: DatabaseSync, project: string, postId: string): ContentPost {
  const row = database.prepare('select * from content_posts where project_id = ? and id = ?').get(project, postId) as Record<string, unknown> | undefined;
  if (!row) throw new ContentBatchError(`Unknown content post: ${postId}`, 404);
  return postFromRow(row, assetsForPost(database, project, postId));
}

export function listContentPosts(project: string, filters: { batchId?: string; channel?: string; phase?: string } = {}) {
  const database = lineageDb();
  try {
    const rows = database.prepare(`
      select * from content_posts
      where project_id = ?
      order by updated_at desc, id
    `).all(project) as Record<string, unknown>[];
    const posts = rows.map(row => postFromRow(row, assetsForPost(database, project, String(row.id))))
      .filter(post => !filters.batchId || post.batch_id === filters.batchId)
      .filter(post => !filters.channel || post.channel === filters.channel)
      .filter(post => !filters.phase || post.phase === normalizePhase(filters.phase));
    return { project, fetchedAt: nowIso(), posts };
  } finally {
    database.close();
  }
}

export function updateContentPost(project: string, fields: ContentPostUpdateFields) {
  const postId = requireText(fields.postId, 'post id');
  const phase = fields.phase ? normalizePhase(fields.phase) : undefined;
  if (!fields.confirmWrite) return { ok: true, dryRun: true, message: `Would update content post ${postId}`, preview: { ...fields, phase, project } };
  const database = lineageDb();
  const timestamp = nowIso();
  try {
    const current = findContentPost(database, project, postId);
    if (fields.batchId) {
      const batch = database.prepare('select id from content_batches where project_id = ? and id = ?').get(project, fields.batchId);
      if (!batch) throw new ContentBatchError(`Unknown content batch: ${fields.batchId}`, 404);
    }
    const next = {
      batchId: fields.batchId ?? current.batch_id,
      body: fields.body ?? current.body,
      campaign: fields.campaign ?? current.campaign,
      channel: fields.channel ?? current.channel,
      cta: fields.cta ?? current.cta,
      notes: fields.notes ?? current.notes,
      phase: phase ?? current.phase,
      postedAt: fields.postedAt ?? current.posted_at,
      scheduledAt: fields.scheduledAt ?? current.scheduled_at,
      sourcePath: fields.sourcePath ?? current.source_path,
      title: fields.title ?? current.title,
      url: fields.url ?? current.url,
    };
    database.prepare(`
      update content_posts
      set batch_id = ?, channel = ?, title = ?, phase = ?, campaign = ?, body = ?, cta = ?,
        scheduled_at = ?, posted_at = ?, url = ?, notes = ?, source_path = ?, updated_at = ?
      where project_id = ? and id = ?
    `).run(next.batchId, next.channel, next.title, next.phase, next.campaign || null, next.body || null, next.cta || null, next.scheduledAt || null, next.postedAt || null, next.url || null, next.notes || null, next.sourcePath || null, timestamp, project, postId);
    return { ok: true, message: `Updated content post ${postId}`, post: findContentPost(database, project, postId) };
  } finally {
    database.close();
  }
}

export function attachContentPostAsset(project: string, fields: ContentPostAssetFields) {
  const postId = requireText(fields.postId, 'post id');
  const assetId = requireText(fields.assetId, 'asset id');
  const role = fields.role?.trim() || 'primary';
  if (!fields.confirmWrite) return { ok: true, dryRun: true, message: `Would attach ${assetId} to ${postId}`, preview: { postId, assetId, role, notes: fields.notes } };
  const database = lineageDb();
  const timestamp = nowIso();
  try {
    findContentPost(database, project, postId);
    database.prepare(`
      insert into content_post_assets (id, project_id, post_id, asset_id, role, notes, attached_at)
      values (?, ?, ?, ?, ?, ?, ?)
      on conflict(project_id, post_id, asset_id, role) do update set notes = excluded.notes, attached_at = excluded.attached_at
    `).run(`${project}:${postId}:${assetId}:${role}`, project, postId, assetId, role, fields.notes || null, timestamp);
    return { ok: true, message: `Attached ${assetId} to ${postId}`, post: findContentPost(database, project, postId) };
  } finally {
    database.close();
  }
}

export function detachContentPostAsset(project: string, fields: ContentPostAssetFields) {
  const postId = requireText(fields.postId, 'post id');
  const assetId = requireText(fields.assetId, 'asset id');
  const role = fields.role?.trim() || 'primary';
  if (!fields.confirmWrite) return { ok: true, dryRun: true, message: `Would detach ${assetId} from ${postId}`, preview: { postId, assetId, role } };
  const database = lineageDb();
  try {
    database.prepare('delete from content_post_assets where project_id = ? and post_id = ? and asset_id = ? and role = ?').run(project, postId, assetId, role);
    return { ok: true, message: `Detached ${assetId} from ${postId}`, post: findContentPost(database, project, postId) };
  } finally {
    database.close();
  }
}
