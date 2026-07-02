import express from 'express';
import { lineageDb, nowIso, type DatabaseSync } from './assetLineageDb';
import { activateReviewSet, archiveReviewSet, inspectReviewSet } from './assetReviewSets';
import type {
  AssetSelectionActor,
  AssetSelectionItem,
  AssetSelectionItemRole,
  AssetSelectionSet,
  AssetSelectionSetKind,
  AssetSelectionSnapshot,
} from '../shared/types';

type Row = Record<string, unknown>;

const actors = new Set<AssetSelectionActor>(['human', 'agent', 'system']);

export class AssetSelectionError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function isAssetSelectionError(error: unknown): error is AssetSelectionError {
  return error instanceof AssetSelectionError;
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
  if (!text) throw new AssetSelectionError(`Selection ${label} is required`);
  return text;
}

function normalizeActor(value: string | undefined, fallback: AssetSelectionActor): AssetSelectionActor {
  const actor = (value || fallback) as AssetSelectionActor;
  if (!actors.has(actor)) throw new AssetSelectionError(`Unsupported selection actor: ${actor}`);
  return actor;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'review-set';
}

function setId(project: string, kind: AssetSelectionSetKind, key: string): string {
  return `${project}:${kind}:${key}`;
}

function itemId(selectionSetId: string, assetId: string): string {
  return `${selectionSetId}:asset:${assetId}`;
}

function variationLabel(index: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (index < alphabet.length) return alphabet[index];
  return `A${index - alphabet.length + 1}`;
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
    select * from selection_items
    where set_id = ?
    order by position, variation_label, created_at, asset_id
  `).all(id) as Row[]).map(rowToItem);
}

function rowToSet(database: DatabaseSync, row: Row): AssetSelectionSet {
  const id = String(row.id);
  return {
    id,
    project: String(row.project_id),
    kind: String(row.kind) as AssetSelectionSetKind,
    key: String(row.key),
    label: String(row.label),
    status: row.status === 'archived' ? 'archived' : 'active',
    created_by: String(row.created_by) as AssetSelectionActor,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    items: itemsForSet(database, id),
  };
}

function getSetById(database: DatabaseSync, id: string): AssetSelectionSet | null {
  const row = database.prepare('select * from selection_sets where id = ?').get(id) as Row | undefined;
  return row ? rowToSet(database, row) : null;
}

function getCurrentSet(database: DatabaseSync, project: string): AssetSelectionSet {
  ensureSelectionSet(database, project, {
    createdBy: 'system',
    key: 'current',
    kind: 'current',
    label: 'Current selections',
  });
  const found = getSetById(database, setId(project, 'current', 'current'));
  if (!found) throw new AssetSelectionError(`Unable to create current selection set for ${project}`, 500);
  return found;
}

function ensureSelectionSet(database: DatabaseSync, project: string, fields: {
  createdBy: AssetSelectionActor;
  key: string;
  kind: AssetSelectionSetKind;
  label: string;
}): string {
  ensureProject(database, project);
  const timestamp = nowIso();
  const id = setId(project, fields.kind, fields.key);
  database.prepare(`
    insert into selection_sets (id, project_id, kind, key, label, status, created_by, created_at, updated_at)
    values (?, ?, ?, ?, ?, 'active', ?, ?, ?)
    on conflict(project_id, kind, key) do update set
      label = excluded.label, status = 'active', updated_at = excluded.updated_at
  `).run(id, project, fields.kind, fields.key, fields.label, fields.createdBy, timestamp, timestamp);
  return id;
}

function replaceSetItems(database: DatabaseSync, id: string, items: Array<{
  assetId: string;
  notes?: string;
  position: number;
  role: AssetSelectionItemRole;
  selectedAt?: string;
  selectedBy?: AssetSelectionActor;
  variationLabel?: string;
}>): void {
  database.prepare('delete from selection_items where set_id = ?').run(id);
  const timestamp = nowIso();
  const statement = database.prepare(`
    insert into selection_items (
      id, set_id, asset_id, role, variation_label, position, selected_by,
      selected_at, deselected_at, notes, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, null, ?, ?, ?)
  `);
  for (const item of items) {
    statement.run(
      itemId(id, item.assetId),
      id,
      item.assetId,
      item.role,
      item.variationLabel || null,
      item.position,
      item.selectedBy || null,
      item.selectedAt || null,
      item.notes || null,
      timestamp,
      timestamp,
    );
  }
}

export function getAssetSelectionSnapshot(project: string): AssetSelectionSnapshot {
  const database = lineageDb();
  try {
    const current = getCurrentSet(database, project);
    const reviewRows = database.prepare(`
      select * from selection_sets
      where project_id = ? and kind = 'review'
      order by updated_at desc, created_at desc
    `).all(project) as Row[];
    const reviewSets = reviewRows.map(row => rowToSet(database, row));
    return {
      project,
      fetchedAt: nowIso(),
      current,
      active_review_set: reviewSets.find(set => set.status === 'active') || null,
      review_sets: reviewSets,
    };
  } finally {
    database.close();
  }
}

export function selectCurrentAssets(project: string, fields: {
  assetIds: string[];
  confirmWrite: boolean;
  notes?: string;
  selectedBy?: AssetSelectionActor;
}) {
  const assetIds = [...new Set(fields.assetIds.map(assetId => assetId.trim()).filter(Boolean))];
  const actor = normalizeActor(fields.selectedBy, 'human');
  const preview = { assetIds, notes: fields.notes, project, selectedBy: actor };
  if (!fields.confirmWrite) return { ok: true as const, dryRun: true as const, message: `Would select ${assetIds.length} assets`, preview };
  const database = lineageDb();
  try {
    const current = getCurrentSet(database, project);
    const selectedAt = nowIso();
    replaceSetItems(database, current.id, assetIds.map((assetId, index) => ({
      assetId,
      notes: fields.notes,
      position: index,
      role: 'primary',
      selectedAt,
      selectedBy: actor,
    })));
    database.prepare('update selection_sets set updated_at = ? where id = ?').run(selectedAt, current.id);
    return { ok: true as const, message: `Selected ${assetIds.length} assets`, selection: getSetById(database, current.id) };
  } finally {
    database.close();
  }
}

export function clearCurrentSelection(project: string, confirmWrite: boolean) {
  if (!confirmWrite) return { ok: true as const, dryRun: true as const, message: 'Would clear current asset selections' };
  const database = lineageDb();
  try {
    const current = getCurrentSet(database, project);
    database.prepare('delete from selection_items where set_id = ?').run(current.id);
    database.prepare('update selection_sets set updated_at = ? where id = ?').run(nowIso(), current.id);
    return { ok: true as const, message: 'Cleared current asset selections', selection: getSetById(database, current.id) };
  } finally {
    database.close();
  }
}

export function createReviewSet(project: string, fields: {
  assetIds?: string[];
  confirmWrite: boolean;
  createdBy?: AssetSelectionActor;
  key?: string;
  label: string;
  notes?: string;
}) {
  const label = requireText(fields.label, 'review set label');
  const key = fields.key?.trim() || `${slug(label)}-${Date.now().toString(36)}`;
  const assetIds = [...new Set((fields.assetIds || []).map(assetId => assetId.trim()).filter(Boolean))];
  const actor = normalizeActor(fields.createdBy, 'agent');
  const preview = { assetIds, createdBy: actor, key, label, notes: fields.notes, project };
  if (!fields.confirmWrite) return { ok: true as const, dryRun: true as const, message: `Would create review set ${label}`, preview };
  const database = lineageDb();
  try {
    const id = ensureSelectionSet(database, project, { createdBy: actor, key, kind: 'review', label });
    replaceSetItems(database, id, assetIds.map((assetId, index) => ({
      assetId,
      notes: fields.notes,
      position: index,
      role: 'candidate',
      variationLabel: variationLabel(index),
    })));
    return { ok: true as const, message: `Saved review set ${label}`, review_set: getSetById(database, id) };
  } finally {
    database.close();
  }
}

function activeReviewSet(database: DatabaseSync, project: string, setId?: string): AssetSelectionSet {
  if (setId) {
    const found = getSetById(database, setId);
    if (found?.project === project && found.kind === 'review' && found.status === 'active') return found;
    throw new AssetSelectionError(`Unknown active review set: ${setId}`, 404);
  }
  const rows = database.prepare(`
    select * from selection_sets
    where project_id = ? and kind = 'review' and status = 'active'
    order by updated_at desc, created_at desc
    limit 2
  `).all(project) as Row[];
  if (rows.length === 0) throw new AssetSelectionError(`No active review set exists for ${project}`, 404);
  if (rows.length > 1) throw new AssetSelectionError(`Multiple active review sets exist for ${project}; pass --set-id`, 409);
  return rowToSet(database, rows[0]);
}

export function chooseReviewSetLabels(project: string, fields: {
  confirmWrite: boolean;
  labels: string[];
  notes?: string;
  selectedBy?: AssetSelectionActor;
  setId?: string;
}) {
  const labels = [...new Set(fields.labels.map(label => label.trim().toUpperCase()).filter(Boolean))];
  if (labels.length === 0) throw new AssetSelectionError('At least one variation label is required');
  const actor = normalizeActor(fields.selectedBy, 'human');
  const database = lineageDb();
  try {
    const reviewSet = activeReviewSet(database, project, fields.setId);
    const byLabel = new Map(reviewSet.items.filter(item => item.variation_label).map(item => [item.variation_label, item]));
    const missing = labels.filter(label => !byLabel.has(label));
    if (missing.length > 0) throw new AssetSelectionError(`Unknown variation labels for ${reviewSet.label}: ${missing.join(', ')}`, 404);
    const chosen = labels.map(label => byLabel.get(label)!);
    const selectedAt = nowIso();
    if (!fields.confirmWrite) {
      return {
        ok: true as const,
        dryRun: true as const,
        message: `Would choose ${labels.join(', ')} from ${reviewSet.label}`,
        preview: { labels, project, review_set: reviewSet.id, selected_assets: chosen.map(item => item.asset_id), selectedBy: actor },
      };
    }
    database.prepare('update selection_items set selected_by = null, selected_at = null, deselected_at = ?, updated_at = ? where set_id = ?')
      .run(selectedAt, selectedAt, reviewSet.id);
    const choose = database.prepare(`
      update selection_items
      set selected_by = ?, selected_at = ?, deselected_at = null, notes = ?, updated_at = ?
      where set_id = ? and variation_label = ?
    `);
    for (const label of labels) choose.run(actor, selectedAt, fields.notes || null, selectedAt, reviewSet.id, label);
    const current = getCurrentSet(database, project);
    replaceSetItems(database, current.id, chosen.map((item, index) => ({
      assetId: item.asset_id,
      notes: fields.notes || item.notes,
      position: index,
      role: 'primary',
      selectedAt,
      selectedBy: actor,
      variationLabel: item.variation_label,
    })));
    database.prepare('update selection_sets set updated_at = ? where id in (?, ?)').run(selectedAt, reviewSet.id, current.id);
    return {
      ok: true as const,
      message: `Selected ${labels.join(', ')} from ${reviewSet.label}`,
      current: getSetById(database, current.id),
      review_set: getSetById(database, reviewSet.id),
    };
  } finally {
    database.close();
  }
}

export function labelsFromPrompt(prompt: string): string[] {
  const normalized = prompt.toUpperCase();
  const explicit = [...normalized.matchAll(/\bVARIATION\s+([A-Z])\b/g)].map(match => match[1]);
  const short = [...normalized.matchAll(/\b([A-Z])\b/g)]
    .map(match => match[1])
    .filter(label => !['A', 'I'].includes(label));
  return [...new Set([...explicit, ...short])];
}

export function assetSelectionRouter(projectFrom: (input: { body?: Record<string, unknown>; query?: Record<string, unknown> }) => string) {
  const router = express.Router();
  const asyncRoute = (handler: (req: express.Request, res: express.Response) => Promise<void> | void): express.RequestHandler =>
    (req, res, next) => { Promise.resolve(handler(req, res)).catch(next); };
  router.get('/', asyncRoute((req, res) => {
    res.json(getAssetSelectionSnapshot(projectFrom(req)));
  }));
  router.post('/current', asyncRoute((req, res) => {
    const ids = Array.isArray(req.body.assetIds) ? req.body.assetIds.map(String) : [String(req.body.assetId || '')];
    res.json(selectCurrentAssets(projectFrom(req), {
      assetIds: ids,
      confirmWrite: req.body.confirmWrite === true,
      notes: typeof req.body.notes === 'string' ? req.body.notes : undefined,
      selectedBy: req.body.selectedBy === 'agent' || req.body.selectedBy === 'system' ? req.body.selectedBy : 'human',
    }));
  }));
  router.post('/current/clear', asyncRoute((req, res) => {
    res.json(clearCurrentSelection(projectFrom(req), req.body.confirmWrite === true));
  }));
  router.post('/review-sets', asyncRoute((req, res) => {
    res.json(createReviewSet(projectFrom(req), {
      assetIds: Array.isArray(req.body.assetIds) ? req.body.assetIds.map(String) : [],
      confirmWrite: req.body.confirmWrite === true,
      createdBy: req.body.createdBy === 'human' || req.body.createdBy === 'system' ? req.body.createdBy : 'agent',
      key: typeof req.body.key === 'string' ? req.body.key : undefined,
      label: String(req.body.label || 'Agent review set'),
      notes: typeof req.body.notes === 'string' ? req.body.notes : undefined,
    }));
  }));
  router.get('/review-sets/:setId', asyncRoute((req, res) => { res.json({ ok: true, project: projectFrom(req), review_set: inspectReviewSet(projectFrom(req), req.params.setId) }); }));
  router.post('/review-sets/archive', asyncRoute((req, res) => { res.json(archiveReviewSet(projectFrom(req), String(req.body.setId || ''), req.body.confirmWrite === true)); }));
  router.post('/review-sets/activate', asyncRoute((req, res) => { res.json(activateReviewSet(projectFrom(req), String(req.body.setId || ''), req.body.confirmWrite === true)); }));
  router.post('/review-sets/choose', asyncRoute((req, res) => {
    const labels = Array.isArray(req.body.labels) ? req.body.labels.map(String) : String(req.body.labels || '').split(',');
    res.json(chooseReviewSetLabels(projectFrom(req), {
      confirmWrite: req.body.confirmWrite === true,
      labels,
      notes: typeof req.body.notes === 'string' ? req.body.notes : undefined,
      selectedBy: req.body.selectedBy === 'agent' || req.body.selectedBy === 'system' ? req.body.selectedBy : 'human',
      setId: typeof req.body.setId === 'string' ? req.body.setId : undefined,
    }));
  }));
  return router;
}
