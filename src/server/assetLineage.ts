import { join } from 'node:path';
import { defaultProject, listAssets, repoRoot } from './assetCore';
import { lineageDb as db, lineageDbPath, nowIso, type DatabaseSync } from './assetLineageDb';
import { LINEAGE_NEXT_VARIATION_LIMIT, normalizeSelectionInput, selectedRows, selectionId } from './assetLineageSelection';
import { activeLineageWorkspaceRoot } from './assetLineageWorkspaces';
import { requireLineageWorkspaceClaimForWrite } from './lineageClaimGuards';
import type {
  AssetReviewState,
  GrowthAsset,
  LineageEdge,
  LineageChildrenResponse,
  LineageIndexSummary,
  LineageLayoutFields,
  LineageLinkFields,
  LineageNode,
  LineageNextResponse,
  LineagePosition,
  LineageSnapshot,
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

function explicitWorkspaceRoot(database: DatabaseSync, project: string, assetId: string): string | undefined {
  const row = database.prepare(`
    select root_asset_id from lineage_workspaces
    where project_id = ? and root_asset_id = ? and status != 'archived'
  `).get(project, assetId) as { root_asset_id?: string } | undefined;
  return row?.root_asset_id;
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
  const root = rootFor(database, project, fields.parentAssetId);
  try {
    requireLineageWorkspaceClaimForWrite({
      claimToken: fields.claimToken,
      confirmWrite: fields.confirmWrite,
      project,
      rootAssetId: root,
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
    const rows = database.prepare('select id, parent_asset_id, child_asset_id, relation_type, created_at from asset_edges where project_id = ? and parent_asset_id = ? order by created_at').all(project, parent) as unknown as LineageEdge[];
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
  const ids = [...new Set([root, ...edges.flatMap(edge => [edge.parent_asset_id, edge.child_asset_id])])];
  const placeholders = ids.map(() => '?').join(',');
  const rows = database.prepare(`
    select a.id asset_id, a.project_id project, a.source, a.title, a.media_type, a.status, a.channel, a.campaign,
      a.local_path, a.s3_key, a.checksum_sha256, coalesce(r.review_state, 'unreviewed') review_state,
      r.notes review_notes, l.x layout_x, l.y layout_y
    from assets a left join asset_reviews r on r.asset_id = a.id
      left join asset_layouts l on l.project_id = a.project_id and l.root_asset_id = ? and l.asset_id = a.id
    where a.project_id = ? and a.id in (${placeholders})
  `).all(root, project, ...ids) as Array<Omit<LineageNode, 'is_latest' | 'position' | 'preview_url' | 'selection_note' | 'user_selected'> & { layout_x?: number; layout_y?: number }>;
  const selected = selectedRows(database, project, root);
  const childIds = new Set(edges.map(edge => edge.parent_asset_id));
  const selectedIds = new Set(selected.map(row => row.asset_id));
  const selections = selected.map(row => ({
    asset_id: row.asset_id, notes: row.notes || undefined,
    position: Number(row.position || 0), selected_at: row.selected_at,
  }));
  const selection = selections[0] || null;
  const nodes = rows.map(row => {
    const position: LineagePosition | undefined = typeof row.layout_x === 'number' && typeof row.layout_y === 'number' ? { x: row.layout_x, y: row.layout_y } : undefined;
    const { layout_x: _layoutX, layout_y: _layoutY, ...node } = row;
    const nodeSelection = selections.find(item => item.asset_id === row.asset_id);
    return {
      ...node,
      is_latest: !childIds.has(row.asset_id),
      position,
      preview_url: canPreviewLocally(row.media_type, row.local_path) ? localPreviewUrl(project, row.local_path) : undefined,
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
  const selectedNodes = snapshot.selected
    .map(assetId => snapshot.nodes.find(node => node.asset_id === assetId))
    .filter((node): node is LineageNode => Boolean(node));
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
      selected: snapshot.selected,
      selection: snapshot.selection,
      selections: snapshot.selections,
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
      selected: snapshot.selected,
      selection: snapshot.selection,
      selections: snapshot.selections,
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
    selected: snapshot.selected,
    selection: snapshot.selection,
    selections: snapshot.selections,
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

export function updateSelectedAsset(project: string, fields: SelectionFields) {
  const database = db();
  const inputAssetIds = normalizeSelectionInput(fields);
  const root = fields.rootAssetId || (inputAssetIds[0] ? rootFor(database, project, inputAssetIds[0]) : '');
  if (!root) throw new LineageError('Selection requires rootAssetId or assetId');
  requireAsset(database, project, root);
  for (const assetId of inputAssetIds) requireAsset(database, project, assetId);
  const mode = fields.mode || 'replace';
  const limit = fields.maxSelections || LINEAGE_NEXT_VARIATION_LIMIT;
  if (!fields.confirmWrite) {
    database.close();
    return { ok: true as const, dryRun: true, root_asset_id: root, asset_ids: inputAssetIds, mode, clear: Boolean(fields.clear), max_selections: limit };
  }
  const current = selectedRows(database, project, root);
  let nextIds = current.map(row => row.asset_id);
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
  database.prepare('delete from asset_selections where project_id = ? and root_asset_id = ?').run(project, root);
  const timestamp = nowIso();
  const insert = database.prepare(`
    insert into asset_selections (id, project_id, root_asset_id, asset_id, position, notes, selected_at)
    values (?, ?, ?, ?, ?, ?, ?)
  `);
  nextIds.forEach((assetId, position) => {
    const existing = current.find(row => row.asset_id === assetId);
    const notes = inputAssetIds.includes(assetId) ? fields.notes || existing?.notes : existing?.notes;
    insert.run(selectionId(project, root, assetId), project, root, assetId, position, notes || null, timestamp);
  });
  database.close();
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
