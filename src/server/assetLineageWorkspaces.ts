import { lineageDb, nowIso, type DatabaseSync } from './assetLineageDb';
import { cancelLineageIterateTasksForAssets } from './assetLineageTasks';
import type {
  LineageWorkspace,
  LineageWorkspaceActor,
  LineageWorkspaceFields,
  LineageWorkspaceSnapshot,
  LineageWorkspaceStatus,
  LineageWorkspaceUpdateFields,
} from '../shared/types';

type Row = Record<string, unknown>;

const actors = new Set<LineageWorkspaceActor>(['human', 'agent', 'system']);
const statuses = new Set<LineageWorkspaceStatus>(['active', 'paused', 'archived']);

export class LineageWorkspaceError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function isLineageWorkspaceError(error: unknown): error is LineageWorkspaceError {
  return error instanceof LineageWorkspaceError;
}

export function lineageWorkspaceId(project: string, rootAssetId: string): string {
  return `${project}:lineage-workspace:${rootAssetId}`;
}

function ensureProject(database: DatabaseSync, project: string): void {
  const timestamp = nowIso();
  database.prepare(`
    insert into projects (id, product, created_at, updated_at)
    values (?, ?, ?, ?)
    on conflict(id) do update set product = excluded.product, updated_at = excluded.updated_at
  `).run(project, project, timestamp, timestamp);
}

function normalizeStatus(value: LineageWorkspaceStatus | undefined, fallback: LineageWorkspaceStatus): LineageWorkspaceStatus {
  const status = value || fallback;
  if (!statuses.has(status)) throw new LineageWorkspaceError(`Unsupported lineage workspace status: ${status}`);
  return status;
}

function normalizeActor(value: LineageWorkspaceActor | undefined): LineageWorkspaceActor {
  const actor = value || 'human';
  if (!actors.has(actor)) throw new LineageWorkspaceError(`Unsupported lineage workspace actor: ${actor}`);
  return actor;
}

function requireAsset(database: DatabaseSync, project: string, assetId: string): { id: string; title: string } {
  const row = database.prepare('select id, title from assets where project_id = ? and id = ?').get(project, assetId) as { id: string; title: string } | undefined;
  if (!row) throw new LineageWorkspaceError(`Unknown indexed asset: ${assetId}`, 404);
  return row;
}

function rowToWorkspace(row: Row): LineageWorkspace {
  return {
    id: String(row.id),
    project: String(row.project_id),
    root_asset_id: String(row.root_asset_id),
    title: String(row.title),
    status: String(row.status) as LineageWorkspaceStatus,
    notes: typeof row.notes === 'string' ? row.notes : undefined,
    created_by: String(row.created_by) as LineageWorkspaceActor,
    active_at: typeof row.active_at === 'string' ? row.active_at : undefined,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function workspaceById(database: DatabaseSync, project: string, id: string): LineageWorkspace | null {
  const row = database.prepare('select * from lineage_workspaces where project_id = ? and id = ?').get(project, id) as Row | undefined;
  return row ? rowToWorkspace(row) : null;
}

function workspaceByRoot(database: DatabaseSync, project: string, rootAssetId: string): LineageWorkspace | null {
  const row = database.prepare('select * from lineage_workspaces where project_id = ? and root_asset_id = ?').get(project, rootAssetId) as Row | undefined;
  return row ? rowToWorkspace(row) : null;
}

function knownRoots(database: DatabaseSync, project: string): Array<{ root_asset_id: string; selected_at?: string }> {
  const rows = database.prepare(`
    select root_asset_id, max(selected_at) selected_at from asset_selections where project_id = ? group by root_asset_id
    union
    select root_asset_id, null selected_at from asset_layouts where project_id = ? group by root_asset_id
    union
    select parent_asset_id root_asset_id, null selected_at
    from asset_edges
    where project_id = ?
      and parent_asset_id not in (select child_asset_id from asset_edges where project_id = ?)
    group by parent_asset_id
  `).all(project, project, project, project) as Array<{ root_asset_id: string; selected_at?: string | null }>;
  const roots = new Map<string, { root_asset_id: string; selected_at?: string }>();
  for (const row of rows) {
    const existing = roots.get(row.root_asset_id);
    roots.set(row.root_asset_id, {
      root_asset_id: row.root_asset_id,
      selected_at: row.selected_at || existing?.selected_at,
    });
  }
  return [...roots.values()];
}

function seedLegacyWorkspaces(database: DatabaseSync, project: string): void {
  if (process.env.LINEAGE_DB_ACCESS === 'read-only') return;
  ensureProject(database, project);
  const timestamp = nowIso();
  const statement = database.prepare(`
    insert into lineage_workspaces (
      id, project_id, root_asset_id, title, status, notes, created_by, active_at, created_at, updated_at
    )
    select ?, ?, a.id, a.title || ' lineage', 'active', null, 'system', ?, ?, ?
    from assets a
    where a.project_id = ? and a.id = ?
    on conflict(project_id, root_asset_id) do nothing
  `);
  for (const root of knownRoots(database, project)) {
    statement.run(
      lineageWorkspaceId(project, root.root_asset_id),
      project,
      root.selected_at || null,
      timestamp,
      timestamp,
      project,
      root.root_asset_id
    );
  }
}

function inferredLegacyWorkspaces(database: DatabaseSync, project: string): LineageWorkspace[] {
  if (process.env.LINEAGE_DB_ACCESS !== 'read-only') return [];
  const persistedRoots = new Set(
    (database.prepare('select root_asset_id from lineage_workspaces where project_id = ?').all(project) as Array<{ root_asset_id: string }>)
      .map(row => row.root_asset_id),
  );
  const asset = database.prepare('select id, title from assets where project_id = ? and id = ?');
  return knownRoots(database, project).flatMap(root => {
    if (persistedRoots.has(root.root_asset_id)) return [];
    const row = asset.get(project, root.root_asset_id) as { id: string; title: string } | undefined;
    if (!row) return [];
    const timestamp = root.selected_at || nowIso();
    return [{
      active_at: root.selected_at,
      created_at: timestamp,
      created_by: 'system' as const,
      id: lineageWorkspaceId(project, root.root_asset_id),
      project,
      root_asset_id: root.root_asset_id,
      status: 'active' as const,
      title: `${row.title} lineage`,
      updated_at: timestamp,
    }];
  });
}

function sortWorkspaces(workspaces: LineageWorkspace[]): LineageWorkspace[] {
  const statusRank: Record<LineageWorkspaceStatus, number> = { active: 0, paused: 1, archived: 2 };
  return workspaces.sort((left, right) => statusRank[left.status] - statusRank[right.status]
    || (right.active_at || '').localeCompare(left.active_at || '')
    || right.updated_at.localeCompare(left.updated_at)
    || left.title.localeCompare(right.title));
}

function listRows(database: DatabaseSync, project: string): LineageWorkspace[] {
  return (database.prepare(`
    select * from lineage_workspaces
    where project_id = ?
    order by
      case status when 'active' then 0 when 'paused' then 1 else 2 end,
      active_at desc nulls last,
      updated_at desc,
      title
  `).all(project) as Row[]).map(rowToWorkspace);
}

export function listLineageWorkspaces(project: string): LineageWorkspaceSnapshot {
  const database = lineageDb();
  try {
    seedLegacyWorkspaces(database, project);
    const workspaces = sortWorkspaces([...listRows(database, project), ...inferredLegacyWorkspaces(database, project)]);
    return {
      project,
      active_workspace: workspaces.find(workspace => workspace.status !== 'archived') || null,
      workspaces,
      fetchedAt: nowIso(),
    };
  } finally {
    database.close();
  }
}

export function inspectLineageWorkspace(project: string, workspaceId: string): LineageWorkspace {
  const database = lineageDb();
  try {
    seedLegacyWorkspaces(database, project);
    const workspace = workspaceById(database, project, workspaceId)
      || workspaceByRoot(database, project, workspaceId)
      || inferredLegacyWorkspaces(database, project).find(item => item.id === workspaceId || item.root_asset_id === workspaceId);
    if (!workspace) throw new LineageWorkspaceError(`Unknown lineage workspace: ${workspaceId}`, 404);
    return workspace;
  } finally {
    database.close();
  }
}

export function createLineageWorkspace(project: string, fields: LineageWorkspaceFields) {
  const rootAssetId = fields.rootAssetId.trim();
  if (!rootAssetId) throw new LineageWorkspaceError('Lineage workspace requires rootAssetId');
  const status = normalizeStatus(fields.status, 'active');
  const actor = normalizeActor(fields.createdBy);
  const database = lineageDb();
  try {
    const root = requireAsset(database, project, rootAssetId);
    const timestamp = nowIso();
    const workspace: LineageWorkspace = {
      id: lineageWorkspaceId(project, rootAssetId),
      project,
      root_asset_id: rootAssetId,
      title: fields.title?.trim() || `${root.title} lineage`,
      status,
      notes: fields.notes?.trim() || undefined,
      created_by: actor,
      active_at: fields.activate !== false && status !== 'archived' ? timestamp : undefined,
      created_at: timestamp,
      updated_at: timestamp,
    };
    if (!fields.confirmWrite) return { ok: true as const, dryRun: true as const, workspace };
    ensureProject(database, project);
    database.prepare(`
      insert into lineage_workspaces (
        id, project_id, root_asset_id, title, status, notes, created_by, active_at, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(project_id, root_asset_id) do update set
        title = excluded.title,
        status = excluded.status,
        notes = excluded.notes,
        active_at = coalesce(excluded.active_at, lineage_workspaces.active_at),
        updated_at = excluded.updated_at
    `).run(
      workspace.id,
      project,
      workspace.root_asset_id,
      workspace.title,
      workspace.status,
      workspace.notes || null,
      workspace.created_by,
      workspace.active_at || null,
      workspace.created_at,
      workspace.updated_at
    );
    return {
      ok: true as const,
      message: `Saved lineage workspace ${workspace.title}`,
      workspace: workspaceById(database, project, workspace.id),
    };
  } finally {
    database.close();
  }
}

export function updateLineageWorkspace(project: string, workspaceId: string, fields: LineageWorkspaceUpdateFields) {
  const database = lineageDb();
  try {
    seedLegacyWorkspaces(database, project);
    const current = workspaceById(database, project, workspaceId) || workspaceByRoot(database, project, workspaceId);
    if (!current) throw new LineageWorkspaceError(`Unknown lineage workspace: ${workspaceId}`, 404);
    const timestamp = nowIso();
    const next: LineageWorkspace = {
      ...current,
      title: fields.title?.trim() || current.title,
      status: normalizeStatus(fields.status, current.status),
      notes: fields.notes === undefined ? current.notes : fields.notes.trim() || undefined,
      active_at: fields.activate ? timestamp : current.active_at,
      updated_at: timestamp,
    };
    if (!fields.confirmWrite) return { ok: true as const, dryRun: true as const, workspace: next };
    database.prepare(`
      update lineage_workspaces
      set title = ?, status = ?, notes = ?, active_at = ?, updated_at = ?
      where project_id = ? and id = ?
    `).run(next.title, next.status, next.notes || null, next.active_at || null, timestamp, project, current.id);
    return {
      ok: true as const,
      message: `Updated lineage workspace ${next.title}`,
      workspace: workspaceById(database, project, current.id),
    };
  } finally {
    database.close();
  }
}

export function activateLineageWorkspace(project: string, workspaceId: string, confirmWrite: boolean) {
  return updateLineageWorkspace(project, workspaceId, { activate: true, status: 'active', confirmWrite });
}

export function archiveLineageWorkspace(project: string, workspaceId: string, confirmWrite: boolean) {
  const database = lineageDb();
  try {
    seedLegacyWorkspaces(database, project);
    const current = workspaceById(database, project, workspaceId) || workspaceByRoot(database, project, workspaceId);
    if (!current) throw new LineageWorkspaceError(`Unknown lineage workspace: ${workspaceId}`, 404);
    const timestamp = nowIso();
    const next: LineageWorkspace = {
      ...current,
      status: 'archived',
      active_at: undefined,
      updated_at: timestamp,
    };
    if (!confirmWrite) return { ok: true as const, dryRun: true as const, workspace: next };
    cancelLineageIterateTasksForAssets(project, {
      actor: 'human',
      confirmWrite: true,
      rootAssetId: current.root_asset_id,
    });
    database.prepare(`
      update lineage_workspaces
      set status = 'archived', active_at = null, updated_at = ?
      where project_id = ? and id = ?
    `).run(timestamp, project, current.id);
    database.prepare('delete from asset_selections where project_id = ? and root_asset_id = ?').run(project, current.root_asset_id);
    return {
      ok: true as const,
      message: `Archived lineage workspace ${current.title}`,
      workspace: workspaceById(database, project, current.id),
    };
  } finally {
    database.close();
  }
}

export function activeLineageWorkspaceRoot(project: string): string | undefined {
  const database = lineageDb();
  try {
    seedLegacyWorkspaces(database, project);
    return sortWorkspaces([...listRows(database, project), ...inferredLegacyWorkspaces(database, project)])
      .find(workspace => workspace.status !== 'archived')?.root_asset_id;
  } finally {
    database.close();
  }
}
