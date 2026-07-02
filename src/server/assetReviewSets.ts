import { lineageDb, nowIso, type DatabaseSync } from './assetLineageDb';
import type { AssetSelectionActor, AssetSelectionItem, AssetSelectionItemRole, AssetSelectionSet } from '../shared/types';

type Row = Record<string, unknown>;

export class AssetReviewSetError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function isAssetReviewSetError(error: unknown): error is AssetReviewSetError {
  return error instanceof AssetReviewSetError;
}

function rowToItem(row: Row): AssetSelectionItem {
  return {
    id: String(row.id),
    set_id: String(row.set_id),
    asset_id: String(row.asset_id),
    role: String(row.role) as AssetSelectionItemRole,
    variation_label: typeof row.variation_label === 'string' ? row.variation_label : undefined,
    position: Number(row.position || 0),
    selected_by: typeof row.selected_by === 'string' ? row.selected_by as AssetSelectionActor : undefined,
    selected_at: typeof row.selected_at === 'string' ? row.selected_at : undefined,
    deselected_at: typeof row.deselected_at === 'string' ? row.deselected_at : undefined,
    notes: typeof row.notes === 'string' ? row.notes : undefined,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function itemsForSet(database: DatabaseSync, id: string): AssetSelectionItem[] {
  return (database.prepare(`
    select * from selection_items where set_id = ?
    order by position, variation_label, created_at, asset_id
  `).all(id) as Row[]).map(rowToItem);
}

function rowToSet(database: DatabaseSync, row: Row): AssetSelectionSet {
  const id = String(row.id);
  return {
    id,
    project: String(row.project_id),
    kind: 'review',
    key: String(row.key),
    label: String(row.label),
    status: row.status === 'archived' ? 'archived' : 'active',
    created_by: String(row.created_by) as AssetSelectionActor,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    items: itemsForSet(database, id),
  };
}

function reviewSet(database: DatabaseSync, project: string, setId: string): AssetSelectionSet {
  const row = database.prepare(`
    select * from selection_sets where id = ? and project_id = ? and kind = 'review'
  `).get(setId, project) as Row | undefined;
  if (!row) throw new AssetReviewSetError(`Unknown review set: ${setId}`, 404);
  return rowToSet(database, row);
}

export function inspectReviewSet(project: string, setId: string): AssetSelectionSet {
  const database = lineageDb();
  try {
    return reviewSet(database, project, setId);
  } finally {
    database.close();
  }
}

export function listReviewSets(project: string): AssetSelectionSet[] {
  const database = lineageDb();
  try {
    return (database.prepare(`
      select * from selection_sets where project_id = ? and kind = 'review'
      order by updated_at desc, created_at desc
    `).all(project) as Row[]).map(row => rowToSet(database, row));
  } finally {
    database.close();
  }
}

export function archiveReviewSet(project: string, setId: string, confirmWrite: boolean) {
  const preview = { project, review_set: setId, status: 'archived' };
  if (!confirmWrite) return { ok: true as const, dryRun: true as const, message: `Would archive review set ${setId}`, preview };
  const database = lineageDb();
  try {
    reviewSet(database, project, setId);
    database.prepare('update selection_sets set status = ?, updated_at = ? where id = ?').run('archived', nowIso(), setId);
    return { ok: true as const, message: `Archived review set ${setId}`, review_set: reviewSet(database, project, setId) };
  } finally {
    database.close();
  }
}

export function activateReviewSet(project: string, setId: string, confirmWrite: boolean) {
  const preview = { project, review_set: setId, status: 'active' };
  if (!confirmWrite) return { ok: true as const, dryRun: true as const, message: `Would activate review set ${setId}`, preview };
  const database = lineageDb();
  try {
    reviewSet(database, project, setId);
    const timestamp = nowIso();
    database.prepare(`
      update selection_sets set status = 'archived', updated_at = ?
      where project_id = ? and kind = 'review' and status = 'active' and id <> ?
    `).run(timestamp, project, setId);
    database.prepare('update selection_sets set status = ?, updated_at = ? where id = ?').run('active', timestamp, setId);
    return { ok: true as const, message: `Activated review set ${setId}`, review_set: reviewSet(database, project, setId) };
  } finally {
    database.close();
  }
}
