import { join } from 'node:path';
import { defaultProject, listAssets, repoRoot } from './assetCore';
import { lineageDb as db, lineageDbPath, nowIso, type DatabaseSync } from './assetLineageDb';
import { LINEAGE_NEXT_VARIATION_LIMIT, normalizeSelectionInput, selectedRows, selectionId } from './assetLineageSelection';
import { cancelLineageTask, listLineageTasks, upsertLineageTask } from './assetLineageTasks';
import { activeLineageWorkspaceRoot } from './assetLineageWorkspaces';
import { requireLineageWorkspaceClaimForWrite } from './lineageClaimGuards';
import type {
  AssetReviewState,
  GrowthAsset,
  LineageAttempt,
  LineageAttemptPromotionResponse,
  LineageAttemptsResponse,
  LineageEdge,
  LineageChildrenResponse,
  LineageIndexSummary,
  LineageLayoutFields,
  LineageLinkFields,
  LineageNode,
  LineageNextResponse,
  LineagePosition,
  LineageRerollRequest,
  LineageRerollRequestMutationResponse,
  LineageRerollRequestsResponse,
  LineageSnapshot,
  LineageTask,
  ReviewFields,
  SelectionFields,
} from '../shared/types';

export class LineageError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function isLineageError(error: unknown): error is LineageError {
  return error instanceof LineageError;
}

function collectAssets(project: string, source: 'catalog' | 'local'): GrowthAsset[] {
  const first = listAssets(project, { source, page: 1, pageSize: 100 });
  const assets = [...first.assets];
  for (let page = 2; page <= first.pagination.totalPages; page += 1) {
    assets.push(...listAssets(project, { source, page, pageSize: 100 }).assets);
  }
  return assets;
}

function upsertProject(database: DatabaseSync, project: string): void {
  const timestamp = nowIso();
  database.prepare(`
    insert into projects (id, product, catalog_path, created_at, updated_at)
    values (?, ?, ?, ?, ?)
    on conflict(id) do update set product = excluded.product, updated_at = excluded.updated_at
  `).run(project, project, join(repoRoot, project, 'assets', 'catalog.json'), timestamp, timestamp);
}

function upsertAsset(database: DatabaseSync, project: string, asset: GrowthAsset): void {
  const timestamp = nowIso();
  const source = asset.source === 'local' ? 'local' : 'catalog';
  database.prepare(`
    insert into assets (
      id, project_id, source, local_path, s3_key, checksum_sha256, media_type, title, status,
      channel, campaign, audience, size_bytes, content_type, created_at, updated_at, last_seen_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      source = excluded.source, local_path = excluded.local_path, s3_key = excluded.s3_key,
      checksum_sha256 = excluded.checksum_sha256, media_type = excluded.media_type,
      title = excluded.title, status = excluded.status, channel = excluded.channel,
      campaign = excluded.campaign, audience = excluded.audience, size_bytes = excluded.size_bytes,
      content_type = excluded.content_type, updated_at = excluded.updated_at, last_seen_at = excluded.last_seen_at
  `).run(
    asset.asset_id, project, source, asset.local?.relative_path || null, asset.s3?.key || null,
    asset.local?.checksum_sha256 || asset.s3?.checksum_sha256 || null, asset.content_type, asset.title,
    asset.status, asset.channel || null, asset.campaign || null, asset.audience || null,
    asset.local?.size_bytes || asset.s3?.size_bytes || null, asset.local?.content_type || asset.s3?.content_type || null,
    timestamp, timestamp, timestamp
  );
  database.prepare(`
    insert into asset_reviews (asset_id, review_state, updated_at)
    values (?, 'unreviewed', ?)
    on conflict(asset_id) do nothing
  `).run(asset.asset_id, timestamp);
}

export function indexLineageAssets(project = defaultProject): LineageIndexSummary {
  const database = db();
  const catalog = collectAssets(project, 'catalog');
  const local = collectAssets(project, 'local');
  upsertProject(database, project);
  for (const asset of [...catalog, ...local]) upsertAsset(database, project, asset);
  database.close();
  return { catalog: catalog.length, local: local.length, total: catalog.length + local.length, database: lineageDbPath() };
}

function requireAsset(database: DatabaseSync, project: string, assetId: string): void {
  const row = database.prepare('select id from assets where project_id = ? and id = ?').get(project, assetId);
  if (!row) throw new LineageError(`Unknown indexed asset: ${assetId}`, 404);
}

function parentOf(database: DatabaseSync, project: string, assetId: string): string | undefined {
  const row = database.prepare('select parent_asset_id from asset_edges where project_id = ? and child_asset_id = ? order by created_at limit 1').get(project, assetId) as { parent_asset_id?: string } | undefined;
  return row?.parent_asset_id;
}

function rootFor(database: DatabaseSync, project: string, assetId: string): string {
  let root = assetId;
  const seen = new Set<string>();
  while (!seen.has(root)) {
    seen.add(root);
    const parent = parentOf(database, project, root);
    if (!parent) return root;
    root = parent;
  }
  return assetId;
}

function assertCanonicalRoot(database: DatabaseSync, project: string, root: string): void {
  requireAsset(database, project, root);
  const canonicalRoot = rootFor(database, project, root);
  if (canonicalRoot !== root) throw new LineageError(`Asset ${root} is not a lineage root`, 400);
}

function explicitWorkspaceRoot(database: DatabaseSync, project: string, assetId: string): string | undefined {
  const row = database.prepare(`
    select root_asset_id from lineage_workspaces
    where project_id = ? and root_asset_id = ? and status != 'archived'
  `).get(project, assetId) as { root_asset_id?: string } | undefined;
  return row?.root_asset_id;
}

function nearestWorkspaceRoot(database: DatabaseSync, project: string, assetId: string): string {
  let current = assetId;
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const explicit = explicitWorkspaceRoot(database, project, current);
    if (explicit) return explicit;
    const parent = parentOf(database, project, current);
    if (!parent) return current;
    current = parent;
  }
  return assetId;
}

function assetChannel(database: DatabaseSync, project: string, assetId: string): string | undefined {
  const row = database.prepare('select channel from assets where project_id = ? and id = ?').get(project, assetId) as { channel?: string } | undefined;
  return row?.channel;
}

function lineageWriteClaimContext(database: DatabaseSync, project: string, assetId: string): { channel?: string; rootAssetId: string } {
  return {
    channel: assetChannel(database, project, assetId),
    rootAssetId: nearestWorkspaceRoot(database, project, assetId),
  };
}

export function getLineageWriteClaimContext(project: string, assetId: string): { channel?: string; rootAssetId: string } {
  const database = db();
  try {
    requireAsset(database, project, assetId);
    return lineageWriteClaimContext(database, project, assetId);
  } finally {
    database.close();
  }
}

function latestSelectedRoot(database: DatabaseSync, project: string): string | undefined {
  const row = database.prepare('select root_asset_id from asset_selections where project_id = ? order by selected_at desc limit 1').get(project) as { root_asset_id?: string } | undefined;
  return row?.root_asset_id;
}

function resolveRoot(database: DatabaseSync, project: string, rootAssetId?: string): string {
  if (rootAssetId) {
    requireAsset(database, project, rootAssetId);
    return rootAssetId;
  }
  const root = activeLineageWorkspaceRoot(project) || latestSelectedRoot(database, project);
  if (!root) throw new LineageError('Lineage command requires --root unless a project selection exists');
  requireAsset(database, project, root);
  return root;
}

function edgeId(project: string, parent: string, child: string): string {
  return `${project}:${parent}:derived_from:${child}`;
}

function rerollRequestId(project: string, root: string, node: string, timestamp: string): string {
  return `${project}:${root}:reroll:${node}:${Date.parse(timestamp) || Date.now()}`;
}

function rowString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function lineageEdgeFromRow(row: Record<string, unknown>): LineageEdge {
  const summary = rowString(row.summary);
  const summaryCreatedBy = rowString(row.summary_created_by) as LineageEdge['summary_created_by'];
  const summaryUpdatedBy = rowString(row.summary_updated_by) as LineageEdge['summary_updated_by'];
  const summaryUpdatedAt = rowString(row.summary_updated_at);
  return {
    id: String(row.id),
    parent_asset_id: String(row.parent_asset_id),
    child_asset_id: String(row.child_asset_id),
    relation_type: row.relation_type as LineageEdge['relation_type'],
    created_at: String(row.created_at),
    ...(summary ? { summary } : {}),
    ...(summaryCreatedBy ? { summary_created_by: summaryCreatedBy } : {}),
    ...(summaryUpdatedBy ? { summary_updated_by: summaryUpdatedBy } : {}),
    ...(summaryUpdatedAt ? { summary_updated_at: summaryUpdatedAt } : {}),
  };
}

function rerollRequestFrom(row: Record<string, unknown>): LineageRerollRequest {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    root_asset_id: String(row.root_asset_id),
    node_asset_id: String(row.node_asset_id),
    status: row.status as LineageRerollRequest['status'],
    requested_by: row.requested_by as LineageRerollRequest['requested_by'],
    notes: rowString(row.notes),
    created_at: String(row.created_at),
    resolved_at: rowString(row.resolved_at),
  };
}

function tasksByTarget(tasks: LineageTask[]): Map<string, Partial<Record<'iterate' | 'reroll', LineageTask>>> {
  const byTarget = new Map<string, Partial<Record<'iterate' | 'reroll', LineageTask>>>();
  for (const task of tasks) {
    if (task.task_type !== 'iterate' && task.task_type !== 'reroll') continue;
    const existing = byTarget.get(task.target_asset_id) || {};
    existing[task.task_type] = task;
    byTarget.set(task.target_asset_id, existing);
  }
  return byTarget;
}

function withRerollTask(request: LineageRerollRequest, task?: LineageTask): LineageRerollRequest {
  return task ? { ...request, task_id: task.id, task } : request;
}

function taskBackedRerollRequest(project: string, rootAssetId: string, task: LineageTask): LineageRerollRequest {
  return {
    id: `${task.id}:request`,
    project_id: project,
    root_asset_id: rootAssetId,
    node_asset_id: task.target_asset_id,
    status: 'pending',
    requested_by: task.created_by,
    notes: task.instructions,
    created_at: task.created_at,
    task_id: task.id,
    task,
  };
}

function attemptFrom(row: Record<string, unknown>): LineageAttempt {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    node_asset_id: String(row.node_asset_id),
    asset_id: String(row.asset_id),
    attempt_index: Number(row.attempt_index),
    source: row.source as LineageAttempt['source'],
    prompt: rowString(row.prompt),
    generation_job_id: rowString(row.generation_job_id),
    file_path: rowString(row.file_path),
    checksum_sha256: rowString(row.checksum_sha256),
    created_at: String(row.created_at),
    promoted_at: rowString(row.promoted_at),
    is_current: Boolean(Number(row.is_current)),
  };
}

function implicitAttempt(row: { asset_id: string; project: string; local_path?: string; checksum_sha256?: string; asset_created_at?: string }, isCurrent = true): LineageAttempt {
  const createdAt = row.asset_created_at || nowIso();
  return {
    id: `${row.project}:${row.asset_id}:attempt:implicit`,
    project_id: row.project,
    node_asset_id: row.asset_id,
    asset_id: row.asset_id,
    attempt_index: 1,
    source: 'initial',
    file_path: row.local_path,
    checksum_sha256: row.checksum_sha256,
    created_at: createdAt,
    promoted_at: createdAt,
    is_current: isCurrent,
  };
}

function withImplicitAttempt(physicalAttempts: LineageAttempt[], row: { asset_id: string; project: string; local_path?: string; checksum_sha256?: string; asset_created_at?: string }): LineageAttempt[] {
  if (physicalAttempts.some(attempt => attempt.source === 'initial')) return physicalAttempts;
  return [...physicalAttempts, implicitAttempt(row, !physicalAttempts.some(attempt => attempt.is_current))];
}

function assertNodeInRoot(database: DatabaseSync, project: string, root: string, node: string): void {
  assertCanonicalRoot(database, project, root);
  requireAsset(database, project, node);
  const nodeRoot = rootFor(database, project, node);
  if (nodeRoot !== root) throw new LineageError(`Asset ${node} is not in lineage rooted at ${root}`);
}

function assertAttemptAssetNotVisibleLineageNode(database: DatabaseSync, project: string, root: string, assetId: string): void {
  const visibleNodeIds = new Set([
    root,
    ...descendants(database, project, root).flatMap(edge => [edge.parent_asset_id, edge.child_asset_id]),
  ]);
  if (visibleNodeIds.has(assetId)) throw new LineageError(`Attempt asset ${assetId} is already a visible lineage node in ${root}`, 400);
}

function canPreviewLocally(mediaType: string, localPath?: string): boolean {
  return Boolean(localPath && ['image', 'video', 'gif'].includes(mediaType));
}

function localPreviewUrl(project: string, localPath?: string): string | undefined {
  if (!localPath) return undefined;
  const params = new URLSearchParams({ project, path: localPath });
  return `/api/assets/local-preview?${params.toString()}`;
}

export function linkLineageAssets(project: string, fields: LineageLinkFields) {
  const database = db();
  requireAsset(database, project, fields.parentAssetId);
  requireAsset(database, project, fields.childAssetId);
  if (fields.parentAssetId === fields.childAssetId) throw new LineageError('Lineage link cannot point to itself');
  const claimContext = lineageWriteClaimContext(database, project, fields.parentAssetId);
  try {
    requireLineageWorkspaceClaimForWrite({
      channel: claimContext.channel,
      claimToken: fields.claimToken,
      confirmWrite: fields.confirmWrite,
      project,
      rootAssetId: claimContext.rootAssetId,
      writeKind: 'lineage_link',
    });
  } catch (error) {
    database.close();
    throw error;
  }
  const edge = {
    id: edgeId(project, fields.parentAssetId, fields.childAssetId), parent_asset_id: fields.parentAssetId,
    child_asset_id: fields.childAssetId, relation_type: 'derived_from' as const, created_at: nowIso(),
  };
  if (!fields.confirmWrite) {
    database.close();
    return { ok: true as const, dryRun: true, edge };
  }
  database.prepare(`
    insert into asset_edges (id, project_id, parent_asset_id, child_asset_id, relation_type, created_at)
    values (?, ?, ?, ?, 'derived_from', ?)
    on conflict(project_id, parent_asset_id, child_asset_id, relation_type) do nothing
  `).run(edge.id, project, edge.parent_asset_id, edge.child_asset_id, edge.created_at);
  database.close();
  return { ok: true as const, message: `Linked ${edge.child_asset_id} from ${edge.parent_asset_id}`, edge };
}

function descendants(database: DatabaseSync, project: string, root: string): LineageEdge[] {
  const edges: LineageEdge[] = [];
  const queue = [root];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const parent = queue.shift()!;
    if (seen.has(parent)) continue;
    seen.add(parent);
    const rows = (database.prepare(`
      select id, parent_asset_id, child_asset_id, relation_type, created_at,
        summary, summary_created_by, summary_updated_by, summary_updated_at
      from asset_edges
      where project_id = ? and parent_asset_id = ?
      order by created_at
    `).all(project, parent) as Array<Record<string, unknown>>).map(lineageEdgeFromRow);
    edges.push(...rows);
    queue.push(...rows.map(row => row.child_asset_id));
  }
  return edges;
}

export function getLineageSnapshot(project: string, assetId: string): LineageSnapshot {
  const database = db();
  requireAsset(database, project, assetId);
  const root = explicitWorkspaceRoot(database, project, assetId) || rootFor(database, project, assetId);
  const edges = descendants(database, project, root);
  const selected = selectedRows(database, project, root);
  const tasks = listLineageTasks(project, root).tasks;
  const ids = [...new Set([
    root,
    ...edges.flatMap(edge => [edge.parent_asset_id, edge.child_asset_id]),
    ...selected.map(row => row.asset_id),
    ...tasks.map(task => task.target_asset_id),
  ])];
  const placeholders = ids.map(() => '?').join(',');
  const rows = database.prepare(`
    select a.id asset_id, a.project_id project, a.source, a.title, a.media_type, a.status, a.channel, a.campaign,
      a.local_path, a.s3_key, a.checksum_sha256, coalesce(r.review_state, 'unreviewed') review_state,
      r.notes review_notes, a.created_at asset_created_at, l.x layout_x, l.y layout_y
    from assets a left join asset_reviews r on r.asset_id = a.id
      left join asset_layouts l on l.project_id = a.project_id and l.root_asset_id = ? and l.asset_id = a.id
    where a.project_id = ? and a.id in (${placeholders})
  `).all(root, project, ...ids) as unknown as Array<Omit<LineageNode, 'attempt_count' | 'current_attempt' | 'is_latest' | 'lineage_tasks' | 'position' | 'preview_url' | 'reroll_request' | 'selection_note' | 'user_selected'> & { asset_created_at?: string; layout_x?: number; layout_y?: number }>;
  const attemptRows = ids.length > 0
    ? database.prepare(`select * from asset_attempts where project_id = ? and node_asset_id in (${placeholders}) order by node_asset_id, attempt_index desc`).all(project, ...ids) as Array<Record<string, unknown>>
    : [];
  const attemptsByNode = new Map<string, LineageAttempt[]>();
  for (const attempt of attemptRows.map(attemptFrom)) {
    attemptsByNode.set(attempt.node_asset_id, [...(attemptsByNode.get(attempt.node_asset_id) || []), attempt]);
  }
  const lineageTasksByNode = tasksByTarget(tasks);
  const rerollRows = ids.length > 0
    ? database.prepare(`select * from asset_reroll_requests where project_id = ? and root_asset_id = ? and status = 'pending' and node_asset_id in (${placeholders}) order by created_at`).all(project, root, ...ids) as Array<Record<string, unknown>>
    : [];
  const rerollsByNode = new Map(rerollRows.map(row => {
    const request = rerollRequestFrom(row);
    return [request.node_asset_id, withRerollTask(request, lineageTasksByNode.get(request.node_asset_id)?.reroll)] as const;
  }));
  const childIds = new Set(edges.map(edge => edge.parent_asset_id));
  const selectedIds = new Set(selected.map(row => row.asset_id));
  const selections = selected.map(row => ({
    asset_id: row.asset_id, notes: row.notes || undefined,
    position: Number(row.position || 0), selected_at: row.selected_at,
  }));
  const selection = selections[0] || null;
  const nodes = rows.map(row => {
    const position: LineagePosition | undefined = typeof row.layout_x === 'number' && typeof row.layout_y === 'number' ? { x: row.layout_x, y: row.layout_y } : undefined;
    const { asset_created_at: _assetCreatedAt, layout_x: _layoutX, layout_y: _layoutY, ...node } = row;
    const nodeSelection = selections.find(item => item.asset_id === row.asset_id);
    const attempts = withImplicitAttempt(attemptsByNode.get(row.asset_id) || [], row);
    const currentAttempt = attempts.find(attempt => attempt.is_current) || attempts[0];
    const previewPath = currentAttempt?.file_path || row.local_path;
    const lineageTasks = lineageTasksByNode.get(row.asset_id);
    return {
      ...node,
      attempt_count: attempts.length,
      current_attempt: currentAttempt,
      is_latest: !childIds.has(row.asset_id),
      lineage_tasks: lineageTasks && Object.keys(lineageTasks).length > 0 ? lineageTasks : undefined,
      position,
      preview_url: canPreviewLocally(row.media_type, previewPath) ? localPreviewUrl(project, previewPath) : undefined,
      reroll_request: rerollsByNode.get(row.asset_id),
      selection_note: nodeSelection?.notes,
      user_selected: selectedIds.has(row.asset_id),
    };
  });
  database.close();
  return {
    project,
    root_asset_id: root,
    active_asset_id: assetId,
    selected: selections.map(row => row.asset_id),
    selection,
    selections,
    tasks,
    latest: nodes.filter(node => node.is_latest).map(node => node.asset_id),
    nodes,
    edges,
    fetchedAt: nowIso(),
  };
}

export function updateLineageLayout(project: string, fields: LineageLayoutFields) {
  if (fields.positions.length === 0) throw new LineageError('Lineage layout requires at least one position');
  const database = db();
  requireAsset(database, project, fields.rootAssetId);
  for (const position of fields.positions) requireAsset(database, project, position.assetId);
  try {
    requireLineageWorkspaceClaimForWrite({
      channel: assetChannel(database, project, fields.rootAssetId),
      claimToken: fields.claimToken,
      confirmWrite: fields.confirmWrite,
      project,
      rootAssetId: fields.rootAssetId,
      writeKind: 'lineage_layout',
    });
  } catch (error) {
    database.close();
    throw error;
  }
  if (!fields.confirmWrite) {
    database.close();
    return { ok: true as const, dryRun: true, root_asset_id: fields.rootAssetId, positions: fields.positions };
  }
  const timestamp = nowIso();
  const statement = database.prepare(`
    insert into asset_layouts (id, project_id, root_asset_id, asset_id, x, y, updated_at)
    values (?, ?, ?, ?, ?, ?, ?)
    on conflict(project_id, root_asset_id, asset_id) do update set
      x = excluded.x, y = excluded.y, updated_at = excluded.updated_at
  `);
  for (const position of fields.positions) {
    statement.run(`${project}:${fields.rootAssetId}:layout:${position.assetId}`, project, fields.rootAssetId, position.assetId, position.x, position.y, timestamp);
  }
  database.close();
  return { ok: true as const, message: `Saved ${fields.positions.length} lineage positions`, root_asset_id: fields.rootAssetId, positions: fields.positions };
}

export function getLineageNextAsset(project: string, rootAssetId?: string): LineageNextResponse {
  const database = db();
  const root = resolveRoot(database, project, rootAssetId);
  database.close();
  const snapshot = getLineageSnapshot(project, root);
  const pendingIterateTasks = (snapshot.tasks || []).filter(task => task.task_type === 'iterate' && task.status === 'pending');
  const taskIdsInSelectionOrder = [
    ...snapshot.selections
      .map(selection => selection.asset_id)
      .filter(assetId => pendingIterateTasks.some(task => task.target_asset_id === assetId)),
    ...pendingIterateTasks
      .map(task => task.target_asset_id)
      .filter(assetId => !snapshot.selections.some(selection => selection.asset_id === assetId)),
  ];
  const taskSelectedIds = [...new Set(taskIdsInSelectionOrder)];
  const selectedIds = taskSelectedIds.length > 0 ? taskSelectedIds : snapshot.selected;
  const selectedNodes = selectedIds
    .map(assetId => snapshot.nodes.find(node => node.asset_id === assetId))
    .filter((node): node is LineageNode => Boolean(node));
  const taskSelections = taskSelectedIds.map((assetId, position) => {
    const task = pendingIterateTasks.find(item => item.target_asset_id === assetId);
    return {
      asset_id: assetId,
      notes: task?.instructions,
      position,
      selected_at: task?.created_at || nowIso(),
    };
  });
  const selectedSelection = taskSelections.length > 0 ? taskSelections[0] : snapshot.selection;
  const selectedSelections = taskSelections.length > 0 ? taskSelections : snapshot.selections;
  const latestNodes = snapshot.nodes.filter(node => snapshot.latest.includes(node.asset_id));
  const warnings: string[] = [];
  for (const selectedNode of selectedNodes) {
    if (selectedNode.is_latest) continue;
    warnings.push('Selected asset is not a latest leaf; agents should treat this as an intentional branch choice.');
  }
  if (selectedNodes.length > 0) {
    return {
      project,
      root_asset_id: snapshot.root_asset_id,
      strategy: 'selected',
      selection_mode: selectedNodes.length > 1 ? 'multiple' : 'single',
      recommended_action: 'evolve_variations',
      reason: 'user_selected',
      next_asset: selectedNodes[0],
      next_assets: selectedNodes,
      latest: snapshot.latest,
      selected: selectedIds,
      selection: selectedSelection,
      selections: selectedSelections,
      candidates: latestNodes,
      warnings,
      fetchedAt: nowIso(),
    };
  }
  if (latestNodes.length === 1) {
    return {
      project,
      root_asset_id: snapshot.root_asset_id,
      strategy: 'single_latest',
      selection_mode: 'fallback',
      recommended_action: 'evolve_variations',
      reason: 'single_latest_fallback',
      next_asset: latestNodes[0],
      next_assets: [latestNodes[0]],
      latest: snapshot.latest,
      selected: selectedIds,
      selection: selectedSelection,
      selections: selectedSelections,
      candidates: latestNodes,
      warnings,
      fetchedAt: nowIso(),
    };
  }
  return {
    project,
    root_asset_id: snapshot.root_asset_id,
    strategy: latestNodes.length > 1 ? 'ambiguous_latest' : 'empty',
    selection_mode: 'none',
    recommended_action: latestNodes.length > 1 ? 'choose_next_base' : 'none',
    reason: latestNodes.length > 1 ? 'multiple_latest_no_selection' : 'no_lineage_candidates',
    next_asset: null,
    next_assets: [],
    latest: snapshot.latest,
    selected: selectedIds,
    selection: selectedSelection,
    selections: selectedSelections,
    candidates: latestNodes,
    warnings,
    fetchedAt: nowIso(),
  };
}

export function getLineageChildren(project: string, parentAssetId: string): LineageChildrenResponse {
  const snapshot = getLineageSnapshot(project, parentAssetId);
  const edges = snapshot.edges.filter(edge => edge.parent_asset_id === parentAssetId);
  const childIds = new Set(edges.map(edge => edge.child_asset_id));
  return {
    project, parent_asset_id: parentAssetId,
    children: snapshot.nodes.filter(node => childIds.has(node.asset_id)),
    edges, fetchedAt: nowIso(),
  };
}

export function listLineageRerollRequests(project: string, rootAssetId: string): LineageRerollRequestsResponse {
  const database = db();
  try {
    assertCanonicalRoot(database, project, rootAssetId);
    const rerollTasks = listLineageTasks(project, rootAssetId).tasks.filter(task => task.task_type === 'reroll');
    const pendingRerollTasks = listLineageTasks(project, rootAssetId, ['pending']).tasks.filter(task => task.task_type === 'reroll');
    const rerollTaskByTarget = new Map(rerollTasks.map(task => [task.target_asset_id, task]));
    const rows = database.prepare(`
      select * from asset_reroll_requests
      where project_id = ? and root_asset_id = ? and status = 'pending'
      order by created_at, id
    `).all(project, rootAssetId) as Array<Record<string, unknown>>;
    const requests = rows.map(row => {
      const request = rerollRequestFrom(row);
      return withRerollTask(request, rerollTaskByTarget.get(request.node_asset_id));
    });
    const legacyTargets = new Set(requests.map(request => request.node_asset_id));
    for (const task of pendingRerollTasks) {
      if (!legacyTargets.has(task.target_asset_id)) requests.push(taskBackedRerollRequest(project, rootAssetId, task));
    }
    return { project, root_asset_id: rootAssetId, requests, fetchedAt: nowIso() };
  } finally {
    database.close();
  }
}

export function getLineageAttempts(project: string, rootAssetId: string, nodeAssetId: string): LineageAttemptsResponse {
  const database = db();
  try {
    assertNodeInRoot(database, project, rootAssetId, nodeAssetId);
    const rows = database.prepare(`
      select * from asset_attempts
      where project_id = ? and node_asset_id = ?
      order by attempt_index desc, created_at desc
    `).all(project, nodeAssetId) as Array<Record<string, unknown>>;
    const asset = database.prepare('select id asset_id, project_id project, local_path, checksum_sha256, created_at asset_created_at from assets where project_id = ? and id = ?').get(project, nodeAssetId) as { asset_id: string; project: string; local_path?: string; checksum_sha256?: string; asset_created_at?: string };
    return { project, root_asset_id: rootAssetId, node_asset_id: nodeAssetId, attempts: withImplicitAttempt(rows.map(attemptFrom), asset), fetchedAt: nowIso() };
  } finally {
    database.close();
  }
}

export function promoteLineageAttempt(project: string, fields: {
  rootAssetId: string;
  nodeAssetId: string;
  attemptId: string;
  confirmWrite: boolean;
}): LineageAttemptPromotionResponse {
  const database = db();
  try {
    assertNodeInRoot(database, project, fields.rootAssetId, fields.nodeAssetId);
    const asset = database.prepare('select id asset_id, project_id project, local_path, checksum_sha256, created_at asset_created_at from assets where project_id = ? and id = ?').get(project, fields.nodeAssetId) as { asset_id: string; project: string; local_path?: string; checksum_sha256?: string; asset_created_at?: string };
    const rows = database.prepare(`
      select * from asset_attempts
      where project_id = ? and node_asset_id = ?
      order by attempt_index desc, created_at desc
    `).all(project, fields.nodeAssetId) as Array<Record<string, unknown>>;
    const attempts = withImplicitAttempt(rows.map(attemptFrom), asset);
    const target = attempts.find(attempt => attempt.id === fields.attemptId);
    if (!target) throw new LineageError(`Attempt ${fields.attemptId} is not in ${fields.nodeAssetId}`, 404);
    const timestamp = nowIso();
    const promotedAttempt = { ...target, is_current: true, promoted_at: timestamp };
    if (!fields.confirmWrite) {
      return {
        ok: true,
        dryRun: true,
        project,
        root_asset_id: fields.rootAssetId,
        node_asset_id: fields.nodeAssetId,
        attempt: promotedAttempt,
        attempts: attempts.map(attempt => ({ ...attempt, is_current: attempt.id === target.id, promoted_at: attempt.id === target.id ? timestamp : attempt.promoted_at })),
        fetchedAt: timestamp,
      };
    }
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare('update asset_attempts set is_current = 0 where project_id = ? and node_asset_id = ?').run(project, fields.nodeAssetId);
      if (target.source !== 'initial') {
        const result = database.prepare(`
          update asset_attempts
          set is_current = 1, promoted_at = ?
          where project_id = ? and node_asset_id = ? and id = ?
        `).run(timestamp, project, fields.nodeAssetId, target.id);
        if (result.changes !== 1) throw new LineageError(`Attempt ${fields.attemptId} is not in ${fields.nodeAssetId}`, 404);
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    const refreshedRows = database.prepare(`
      select * from asset_attempts
      where project_id = ? and node_asset_id = ?
      order by attempt_index desc, created_at desc
    `).all(project, fields.nodeAssetId) as Array<Record<string, unknown>>;
    const refreshedAttempts = withImplicitAttempt(refreshedRows.map(attemptFrom), asset);
    const attempt = refreshedAttempts.find(item => item.id === target.id) || promotedAttempt;
    return {
      ok: true,
      project,
      root_asset_id: fields.rootAssetId,
      node_asset_id: fields.nodeAssetId,
      attempt,
      attempts: refreshedAttempts,
      fetchedAt: nowIso(),
    };
  } finally {
    database.close();
  }
}

export function recordLineageRerollAttempt(project: string, fields: {
  rootAssetId: string;
  nodeAssetId: string;
  assetId: string;
  prompt: string;
  generationJobId: string;
  filePath: string;
  checksumSha256: string;
  confirmWrite: boolean;
}): { ok: true; attempt: LineageAttempt; dryRun?: true } {
  const database = db();
  try {
    assertNodeInRoot(database, project, fields.rootAssetId, fields.nodeAssetId);
    requireAsset(database, project, fields.assetId);
    assertAttemptAssetNotVisibleLineageNode(database, project, fields.rootAssetId, fields.assetId);
    const timestamp = nowIso();
    const maxRow = database.prepare('select max(attempt_index) max_index from asset_attempts where project_id = ? and node_asset_id = ?').get(project, fields.nodeAssetId) as { max_index?: number | null };
    const attemptIndex = Number(maxRow.max_index || 1) + 1;
    const attempt: LineageAttempt = {
      id: `${project}:${fields.nodeAssetId}:attempt:${attemptIndex}`,
      project_id: project,
      node_asset_id: fields.nodeAssetId,
      asset_id: fields.assetId,
      attempt_index: attemptIndex,
      source: 'reroll',
      prompt: fields.prompt,
      generation_job_id: fields.generationJobId,
      file_path: fields.filePath,
      checksum_sha256: fields.checksumSha256,
      created_at: timestamp,
      promoted_at: timestamp,
      is_current: true,
    };
    if (!fields.confirmWrite) return { ok: true, dryRun: true, attempt };
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare('update asset_attempts set is_current = 0 where project_id = ? and node_asset_id = ?').run(project, fields.nodeAssetId);
      database.prepare(`
        insert into asset_attempts (
          id, project_id, node_asset_id, asset_id, attempt_index, source, prompt, generation_job_id,
          file_path, checksum_sha256, created_at, promoted_at, is_current
        ) values (?, ?, ?, ?, ?, 'reroll', ?, ?, ?, ?, ?, ?, 1)
      `).run(
        attempt.id, project, fields.nodeAssetId, fields.assetId, attempt.attempt_index, fields.prompt,
        fields.generationJobId, fields.filePath, fields.checksumSha256, timestamp, timestamp
      );
      database.prepare(`
        update asset_reroll_requests
        set status = 'resolved', resolved_at = ?
        where project_id = ? and root_asset_id = ? and node_asset_id = ? and status = 'pending'
      `).run(timestamp, project, fields.rootAssetId, fields.nodeAssetId);
      database.prepare(`
        insert into asset_reviews (asset_id, review_state, reviewed_at, ignored_at, notes, updated_at)
        values (?, 'unreviewed', ?, null, null, ?)
        on conflict(asset_id) do update set
          review_state = excluded.review_state, reviewed_at = excluded.reviewed_at,
          ignored_at = excluded.ignored_at, updated_at = excluded.updated_at
      `).run(fields.nodeAssetId, timestamp, timestamp);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    return { ok: true, attempt };
  } finally {
    database.close();
  }
}

export function markLineageRerollRequest(project: string, fields: { rootAssetId: string; nodeAssetId: string; notes?: string; requestedBy?: 'agent' | 'human' | 'system'; confirmWrite: boolean }): LineageRerollRequestMutationResponse {
  const database = db();
  try {
    assertNodeInRoot(database, project, fields.rootAssetId, fields.nodeAssetId);
    const existing = database.prepare(`
      select * from asset_reroll_requests
      where project_id = ? and root_asset_id = ? and node_asset_id = ? and status = 'pending'
      order by created_at desc limit 1
    `).get(project, fields.rootAssetId, fields.nodeAssetId) as Record<string, unknown> | undefined;
    const timestamp = nowIso();
    const request: LineageRerollRequest = existing ? {
      ...rerollRequestFrom(existing),
      notes: fields.notes || rerollRequestFrom(existing).notes,
      requested_by: fields.requestedBy || rerollRequestFrom(existing).requested_by,
    } : {
      id: rerollRequestId(project, fields.rootAssetId, fields.nodeAssetId, timestamp),
      project_id: project,
      root_asset_id: fields.rootAssetId,
      node_asset_id: fields.nodeAssetId,
      status: 'pending',
      requested_by: fields.requestedBy || 'human',
      notes: fields.notes,
      created_at: timestamp,
    };
    if (!fields.confirmWrite) return { ok: true, dryRun: true, request };
    const taskResult = upsertLineageTask(project, {
      createdBy: request.requested_by,
      instructions: request.notes,
      rootAssetId: fields.rootAssetId,
      targetAssetId: fields.nodeAssetId,
      taskType: 'reroll',
    });
    if (existing) {
      database.prepare(`
        update asset_reroll_requests
        set requested_by = ?, notes = ?
        where id = ?
      `).run(request.requested_by, request.notes || null, request.id);
    } else {
      database.prepare(`
        insert into asset_reroll_requests (id, project_id, root_asset_id, node_asset_id, status, requested_by, notes, created_at, resolved_at)
        values (?, ?, ?, ?, 'pending', ?, ?, ?, null)
      `).run(request.id, project, fields.rootAssetId, fields.nodeAssetId, request.requested_by, request.notes || null, request.created_at);
    }
    database.prepare(`
      insert into asset_reviews (asset_id, review_state, reviewed_at, ignored_at, notes, updated_at)
      values (?, 'needs_revision', ?, null, ?, ?)
      on conflict(asset_id) do update set
        review_state = excluded.review_state, reviewed_at = excluded.reviewed_at,
        ignored_at = excluded.ignored_at, notes = coalesce(excluded.notes, asset_reviews.notes), updated_at = excluded.updated_at
    `).run(fields.nodeAssetId, timestamp, request.notes || null, timestamp);
    return {
      ok: true,
      request: withRerollTask(rerollRequestFrom(database.prepare('select * from asset_reroll_requests where id = ?').get(request.id) as Record<string, unknown>), taskResult.task),
      task_id: taskResult.task.id,
      task: taskResult.task,
    };
  } finally {
    database.close();
  }
}

export function clearLineageRerollRequest(project: string, fields: { rootAssetId: string; nodeAssetId: string; confirmWrite: boolean }): LineageRerollRequestMutationResponse {
  const database = db();
  try {
    assertNodeInRoot(database, project, fields.rootAssetId, fields.nodeAssetId);
    const existing = database.prepare(`
      select * from asset_reroll_requests
      where project_id = ? and root_asset_id = ? and node_asset_id = ? and status = 'pending'
      order by created_at desc limit 1
    `).get(project, fields.rootAssetId, fields.nodeAssetId) as Record<string, unknown> | undefined;
    if (!existing) throw new LineageError(`No pending re-roll request for ${fields.nodeAssetId}`, 404);
    const timestamp = nowIso();
    const request = { ...rerollRequestFrom(existing), status: 'cancelled' as const, resolved_at: timestamp };
    if (!fields.confirmWrite) return { ok: true, dryRun: true, request };
    const task = listLineageTasks(project, fields.rootAssetId, ['pending']).tasks.find(item => item.task_type === 'reroll' && item.target_asset_id === fields.nodeAssetId);
    const cancelledTask = task ? cancelLineageTask(project, {
      actor: 'human',
      confirmWrite: true,
      taskId: task.id,
    }).task : undefined;
    database.prepare(`
      update asset_reroll_requests
      set status = 'cancelled', resolved_at = ?
      where id = ?
    `).run(timestamp, request.id);
    return {
      ok: true,
      request: withRerollTask(request, cancelledTask),
      task_id: cancelledTask?.id,
      task: cancelledTask,
    };
  } finally {
    database.close();
  }
}

export function updateSelectedAsset(project: string, fields: SelectionFields) {
  const database = db();
  let root: string;
  let current: ReturnType<typeof selectedRows>;
  let inputAssetIds: string[];
  let mode: NonNullable<SelectionFields['mode']>;
  let limit: number;
  let nextIds: string[];
  const notesByAsset = new Map<string, string | undefined>();
  try {
    inputAssetIds = normalizeSelectionInput(fields);
    root = fields.rootAssetId || (inputAssetIds[0] ? rootFor(database, project, inputAssetIds[0]) : '');
    if (!root) throw new LineageError('Selection requires rootAssetId or assetId');
    requireAsset(database, project, root);
    for (const assetId of inputAssetIds) requireAsset(database, project, assetId);
    mode = fields.mode || 'replace';
    limit = fields.maxSelections || LINEAGE_NEXT_VARIATION_LIMIT;
    if (!fields.confirmWrite) {
      return { ok: true as const, dryRun: true, root_asset_id: root, asset_ids: inputAssetIds, mode, clear: Boolean(fields.clear), max_selections: limit };
    }
    current = selectedRows(database, project, root);
    nextIds = current.map(row => row.asset_id);
    if (fields.clear) {
      nextIds = [];
    } else if (mode === 'replace') {
      nextIds = inputAssetIds;
    } else if (mode === 'add') {
      nextIds = [...nextIds, ...inputAssetIds];
    } else if (mode === 'remove') {
      nextIds = nextIds.filter(assetId => !inputAssetIds.includes(assetId));
    } else if (mode === 'toggle') {
      for (const assetId of inputAssetIds) {
        nextIds = nextIds.includes(assetId) ? nextIds.filter(id => id !== assetId) : [...nextIds, assetId];
      }
    }
    nextIds = [...new Set(nextIds)];
    if (!fields.clear && inputAssetIds.length === 0) throw new LineageError('Selection set requires assetId or assetIds');
    if (nextIds.length > limit) throw new LineageError(`Select at most ${limit} assets for next variation`);
    for (const assetId of nextIds) {
      const existing = current.find(row => row.asset_id === assetId);
      notesByAsset.set(assetId, inputAssetIds.includes(assetId) ? fields.notes || existing?.notes : existing?.notes);
    }
  } finally {
    database.close();
  }

  const removedIds = current.map(row => row.asset_id).filter(assetId => !nextIds.includes(assetId));
  const openIterateTasks = listLineageTasks(project, root, ['pending']).tasks.filter(task => task.task_type === 'iterate');
  for (const assetId of removedIds) {
    const task = openIterateTasks.find(item => item.target_asset_id === assetId);
    if (task) {
      cancelLineageTask(project, {
        actor: 'human',
        confirmWrite: true,
        taskId: task.id,
      });
    }
  }
  for (const assetId of nextIds) {
    upsertLineageTask(project, {
      createdBy: 'human',
      instructions: notesByAsset.get(assetId),
      rootAssetId: root,
      targetAssetId: assetId,
      taskType: 'iterate',
    });
  }

  const writeDatabase = db();
  writeDatabase.prepare('delete from asset_selections where project_id = ? and root_asset_id = ?').run(project, root);
  const timestamp = nowIso();
  const insert = writeDatabase.prepare(`
    insert into asset_selections (id, project_id, root_asset_id, asset_id, position, notes, selected_at)
    values (?, ?, ?, ?, ?, ?, ?)
  `);
  nextIds.forEach((assetId, position) => {
    insert.run(selectionId(project, root, assetId), project, root, assetId, position, notesByAsset.get(assetId) || null, timestamp);
  });
  writeDatabase.close();
  const message = nextIds.length === 0 ? `Cleared selected assets for ${root}` : `Selected ${nextIds.length} asset${nextIds.length === 1 ? '' : 's'} for ${root}`;
  return { ok: true as const, message, root_asset_id: root, asset_id: nextIds[0] || null, asset_ids: nextIds, mode };
}

export function updateAssetReview(project: string, fields: ReviewFields) {
  const allowed = new Set<AssetReviewState>(['unreviewed', 'approved', 'needs_revision', 'rejected', 'ignored']);
  if (!allowed.has(fields.reviewState)) throw new LineageError(`Unsupported review state: ${fields.reviewState}`);
  const database = db();
  requireAsset(database, project, fields.assetId);
  if (!fields.confirmWrite) {
    database.close();
    return { ok: true as const, dryRun: true, asset_id: fields.assetId, review_state: fields.reviewState, notes: fields.notes };
  }
  const timestamp = nowIso();
  database.prepare(`
    insert into asset_reviews (asset_id, review_state, reviewed_at, ignored_at, notes, updated_at)
    values (?, ?, ?, ?, ?, ?)
    on conflict(asset_id) do update set
      review_state = excluded.review_state, reviewed_at = excluded.reviewed_at,
      ignored_at = excluded.ignored_at, notes = excluded.notes, updated_at = excluded.updated_at
  `).run(fields.assetId, fields.reviewState, timestamp, fields.reviewState === 'ignored' ? timestamp : null, fields.notes || null, timestamp);
  database.close();
  return { ok: true as const, message: `Marked ${fields.assetId} ${fields.reviewState}`, asset_id: fields.assetId, review_state: fields.reviewState };
}
