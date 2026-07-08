import { randomBytes } from 'node:crypto';
import { createAgentClaim, releaseAgentClaim, validateAgentClaimForWrite, type AgentClaim } from './agentClaims';
import { lineageDb, nowIso, type DatabaseSync } from './assetLineageDb';
import type {
  LineageTask,
  LineageTaskActor,
  LineageTaskEvent,
  LineageTaskMutationResponse,
  LineageTaskStatus,
  LineageTasksResponse,
  LineageTaskType,
} from '../shared/types';

export class LineageTaskError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

type Row = Record<string, unknown>;
type LineageTaskMutationResult = Omit<LineageTaskMutationResponse, 'events'> & { project: string; events: LineageTaskEvent[] };
type LineageTaskClaimResult = LineageTaskMutationResult & { claim: AgentClaim; claim_token: string };

const activeStatuses: LineageTaskStatus[] = ['pending', 'claimed', 'in_progress'];
const taskTypes = new Set<LineageTaskType>(['iterate', 'reroll']);
const taskStatuses = new Set<LineageTaskStatus>(['pending', 'claimed', 'in_progress', 'resolved', 'cancelled']);

export function taskIdFor(project: string, rootAssetId: string, targetAssetId: string, taskType: LineageTaskType): string {
  return `${project}:${rootAssetId}:lineage-task:${taskType}:${targetAssetId}`;
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(6).toString('base64url').toLowerCase()}`;
}

function metadataJson(metadata?: Record<string, unknown>): string | null {
  return metadata ? JSON.stringify(metadata) : null;
}

function parseMetadata(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function normalizeProject(project: string): string {
  const trimmed = project.trim();
  if (!trimmed) throw new LineageTaskError('Lineage task requires project');
  return trimmed;
}

function normalizeTaskType(taskType: LineageTaskType): LineageTaskType {
  if (!taskTypes.has(taskType)) throw new LineageTaskError(`Unsupported lineage task type: ${taskType}`);
  return taskType;
}

function normalizeStatus(status: LineageTaskStatus): LineageTaskStatus {
  if (!taskStatuses.has(status)) throw new LineageTaskError(`Unsupported lineage task status: ${status}`);
  return status;
}

function normalizeActor(actor: string, label: string): string {
  const trimmed = actor.trim();
  if (!trimmed) throw new LineageTaskError(`${label} is required`);
  return trimmed;
}

function requireAsset(database: DatabaseSync, project: string, assetId: string): void {
  const row = database.prepare('select id from assets where project_id = ? and id = ?').get(project, assetId);
  if (!row) throw new LineageTaskError(`Unknown indexed asset: ${assetId}`, 404);
}

function taskFromRow(row: Row): LineageTask {
  const metadata = parseMetadata(row.metadata_json);
  const claimId = typeof metadata?.claim_id === 'string' ? metadata.claim_id : undefined;
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    root_asset_id: String(row.root_asset_id),
    target_asset_id: String(row.target_asset_id),
    task_type: String(row.task_type) as LineageTaskType,
    status: String(row.status) as LineageTaskStatus,
    instructions: typeof row.instructions === 'string' ? row.instructions : undefined,
    created_by: String(row.created_by) as LineageTaskActor,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    claimed_at: typeof row.claimed_at === 'string' ? row.claimed_at : undefined,
    started_at: typeof row.started_at === 'string' ? row.started_at : undefined,
    resolved_at: typeof row.resolved_at === 'string' ? row.resolved_at : undefined,
    cancelled_at: typeof row.cancelled_at === 'string' ? row.cancelled_at : undefined,
    resolved_generation_job_id: typeof row.resolved_generation_job_id === 'string' ? row.resolved_generation_job_id : undefined,
    resolved_asset_id: typeof row.resolved_asset_id === 'string' ? row.resolved_asset_id : undefined,
    claimed_by_claim_id: claimId,
    metadata,
  };
}

function eventFromRow(row: Row): LineageTaskEvent {
  return {
    id: String(row.id),
    task_id: String(row.task_id),
    event_type: String(row.event_type) as LineageTaskEvent['event_type'],
    actor: typeof row.actor === 'string' ? row.actor : undefined,
    message: typeof row.message === 'string' ? row.message : undefined,
    created_at: String(row.created_at),
    metadata: parseMetadata(row.metadata_json),
  };
}

function findTask(database: DatabaseSync, project: string, taskId: string): LineageTask | null {
  const row = database.prepare('select * from lineage_tasks where project_id = ? and id = ?').get(project, taskId) as Row | undefined;
  return row ? taskFromRow(row) : null;
}

function requireTask(database: DatabaseSync, project: string, taskId: string): LineageTask {
  const task = findTask(database, project, taskId);
  if (!task) throw new LineageTaskError(`Unknown lineage task: ${taskId}`, 404);
  return task;
}

function taskEvents(database: DatabaseSync, taskId: string): LineageTaskEvent[] {
  const rows = database.prepare('select * from lineage_task_events where task_id = ? order by created_at, rowid').all(taskId) as Row[];
  return rows.map(eventFromRow);
}

function recordEvent(database: DatabaseSync, taskId: string, eventType: string, actor?: string, message?: string, metadata?: Record<string, unknown>): void {
  database.prepare(`
    insert into lineage_task_events (id, task_id, event_type, actor, message, created_at, metadata_json)
    values (?, ?, ?, ?, ?, ?, ?)
  `).run(randomId('lineage_task_event'), taskId, eventType, actor || null, message || null, nowIso(), metadataJson(metadata));
}

function taskWithEvents(database: DatabaseSync, project: string, taskId: string): LineageTaskMutationResult {
  return { project, ok: true, task: requireTask(database, project, taskId), events: taskEvents(database, taskId) };
}

function assertChanged(result: { changes: number | bigint }, message: string): void {
  if (Number(result.changes) !== 1) throw new LineageTaskError(message, 409);
}

function transaction<T>(database: DatabaseSync, callback: () => T): T {
  database.exec('BEGIN IMMEDIATE');
  try {
    const value = callback();
    database.exec('COMMIT');
    return value;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function taskReadWithEvents(database: DatabaseSync, project: string, taskId: string) {
  return { task: requireTask(database, project, taskId), events: taskEvents(database, taskId) };
}

export function listLineageTasks(project: string, rootAssetId: string, statuses: LineageTaskStatus[] = activeStatuses): LineageTasksResponse {
  const normalizedProject = normalizeProject(project);
  const normalizedStatuses = statuses.map(normalizeStatus);
  const database = lineageDb();
  try {
    requireAsset(database, normalizedProject, rootAssetId);
    if (normalizedStatuses.length === 0) {
      return { project: normalizedProject, root_asset_id: rootAssetId, tasks: [], fetchedAt: nowIso() };
    }
    const placeholders = normalizedStatuses.map(() => '?').join(',');
    const rows = database.prepare(`
      select * from lineage_tasks
      where project_id = ? and root_asset_id = ? and status in (${placeholders})
      order by updated_at desc, created_at desc, id
    `).all(normalizedProject, rootAssetId, ...normalizedStatuses) as Row[];
    return { project: normalizedProject, root_asset_id: rootAssetId, tasks: rows.map(taskFromRow), fetchedAt: nowIso() };
  } finally {
    database.close();
  }
}

export function getLineageTask(project: string, taskId: string) {
  const normalizedProject = normalizeProject(project);
  const database = lineageDb();
  try {
    return { project: normalizedProject, ...taskReadWithEvents(database, normalizedProject, taskId) };
  } finally {
    database.close();
  }
}

export function upsertLineageTask(project: string, fields: {
  createdBy: LineageTaskActor;
  instructions?: string;
  rootAssetId: string;
  targetAssetId: string;
  taskType: LineageTaskType;
}): LineageTaskMutationResult {
  const normalizedProject = normalizeProject(project);
  const taskType = normalizeTaskType(fields.taskType);
  const taskId = taskIdFor(normalizedProject, fields.rootAssetId, fields.targetAssetId, taskType);
  const database = lineageDb();
  try {
    requireAsset(database, normalizedProject, fields.rootAssetId);
    requireAsset(database, normalizedProject, fields.targetAssetId);
    const existing = database.prepare(`
      select * from lineage_tasks
      where project_id = ? and root_asset_id = ? and target_asset_id = ? and task_type = ?
        and status in ('pending', 'claimed', 'in_progress')
      order by created_at desc limit 1
    `).get(normalizedProject, fields.rootAssetId, fields.targetAssetId, taskType) as Row | undefined;
    const instructions = fields.instructions?.trim() || undefined;
    if (existing) {
      const task = taskFromRow(existing);
      if (task.status !== 'pending' && instructions !== undefined && instructions !== task.instructions) {
        throw new LineageTaskError('Only pending lineage tasks can update instructions.', 409);
      }
      if (task.status === 'pending' && instructions !== undefined && instructions !== task.instructions) {
        const timestamp = nowIso();
        transaction(database, () => {
          const result = database.prepare(`
            update lineage_tasks
            set instructions = ?, updated_at = ?
            where id = ? and status = 'pending'
          `).run(instructions, timestamp, task.id);
          assertChanged(result, 'Only pending lineage tasks can update instructions.');
          recordEvent(database, task.id, 'instructions_updated', fields.createdBy, 'Instructions updated.');
        });
      }
      return taskWithEvents(database, normalizedProject, task.id);
    }
    const closedTask = findTask(database, normalizedProject, taskId);
    if (closedTask) {
      const timestamp = nowIso();
      transaction(database, () => {
        const result = database.prepare(`
          update lineage_tasks
          set status = 'pending', instructions = ?, created_by = ?, updated_at = ?,
            claimed_at = null, started_at = null, resolved_at = null, cancelled_at = null,
            resolved_generation_job_id = null, resolved_asset_id = null, metadata_json = null
          where id = ? and status not in ('pending', 'claimed', 'in_progress')
        `).run(instructions || null, fields.createdBy, timestamp, taskId);
        assertChanged(result, 'Lineage task changed while reopening.');
        recordEvent(database, taskId, 'created', fields.createdBy, 'Lineage task created.');
      });
      return taskWithEvents(database, normalizedProject, taskId);
    }
    const timestamp = nowIso();
    transaction(database, () => {
      database.prepare(`
        insert into lineage_tasks (
          id, project_id, root_asset_id, target_asset_id, task_type, status, instructions,
          created_by, created_at, updated_at, metadata_json
        ) values (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, null)
      `).run(taskId, normalizedProject, fields.rootAssetId, fields.targetAssetId, taskType, instructions || null, fields.createdBy, timestamp, timestamp);
      recordEvent(database, taskId, 'created', fields.createdBy, 'Lineage task created.');
    });
    return taskWithEvents(database, normalizedProject, taskId);
  } finally {
    database.close();
  }
}

export function updateLineageTaskInstructions(project: string, fields: { taskId: string; instructions: string }): LineageTaskMutationResult {
  const normalizedProject = normalizeProject(project);
  const instructions = fields.instructions.trim();
  const database = lineageDb();
  try {
    const task = requireTask(database, normalizedProject, fields.taskId);
    if (task.status !== 'pending') throw new LineageTaskError('Only pending lineage tasks can update instructions.', 409);
    const timestamp = nowIso();
    transaction(database, () => {
      const result = database.prepare(`
        update lineage_tasks
        set instructions = ?, updated_at = ?
        where id = ? and status = 'pending'
      `).run(instructions || null, timestamp, task.id);
      assertChanged(result, 'Only pending lineage tasks can update instructions.');
      recordEvent(database, task.id, 'instructions_updated', 'human', 'Instructions updated.');
    });
    return taskWithEvents(database, normalizedProject, task.id);
  } finally {
    database.close();
  }
}

export function addLineageTaskComment(project: string, fields: { taskId: string; actor: string; message: string }): LineageTaskMutationResult {
  const normalizedProject = normalizeProject(project);
  const actor = normalizeActor(fields.actor, 'Comment actor');
  const message = fields.message.trim();
  if (!message) throw new LineageTaskError('Comment message is required');
  const database = lineageDb();
  try {
    const task = requireTask(database, normalizedProject, fields.taskId);
    transaction(database, () => {
      recordEvent(database, task.id, 'comment_added', actor, message);
    });
    return taskWithEvents(database, normalizedProject, task.id);
  } finally {
    database.close();
  }
}

export function claimLineageTask(project: string, fields: { taskId: string; agentName: string }): LineageTaskClaimResult {
  const normalizedProject = normalizeProject(project);
  const agentName = normalizeActor(fields.agentName, 'Agent name');
  const beforeClaimDb = lineageDb();
  try {
    const task = requireTask(beforeClaimDb, normalizedProject, fields.taskId);
    if (task.status !== 'pending') throw new LineageTaskError('Only pending lineage tasks can be claimed.', 409);
  } finally {
    beforeClaimDb.close();
  }

  const claimResult = createAgentClaim({
    agentName,
    project: normalizedProject,
    scopeType: 'lineage_task',
    targetId: fields.taskId,
    targetTitle: fields.taskId,
  });
  if (!claimResult.claim) throw new LineageTaskError('Unable to create lineage task claim.', 500);
  const claim = claimResult.claim;

  const database = lineageDb();
  try {
    const task = requireTask(database, normalizedProject, fields.taskId);
    if (task.status !== 'pending') {
      releaseAgentClaim(claimResult.claim_token);
      throw new LineageTaskError('Only pending lineage tasks can be claimed.', 409);
    }
    const timestamp = nowIso();
    const metadata = { ...(task.metadata || {}), claim_id: claim.id };
    try {
      transaction(database, () => {
        const result = database.prepare(`
          update lineage_tasks
          set status = 'claimed', claimed_at = ?, updated_at = ?, metadata_json = ?
          where id = ? and status = 'pending'
        `).run(timestamp, timestamp, metadataJson(metadata), task.id);
        assertChanged(result, 'Only pending lineage tasks can be claimed.');
        recordEvent(database, task.id, 'claimed', agentName, 'Lineage task claimed.', { claim_id: claim.id });
      });
    } catch (error) {
      releaseAgentClaim(claimResult.claim_token);
      throw error;
    }
    return {
      ...taskWithEvents(database, normalizedProject, task.id),
      claim,
      claim_token: claimResult.claim_token,
    };
  } finally {
    database.close();
  }
}

export function startLineageTask(project: string, fields: { taskId: string; claimToken: string }): LineageTaskMutationResult {
  const normalizedProject = normalizeProject(project);
  const validation = validateAgentClaimForWrite({
    claimToken: fields.claimToken,
    dangerLevel: 'enforce',
    project: normalizedProject,
    scopeType: 'lineage_task',
    targetId: fields.taskId,
    writeKind: 'lineage_task_start',
  });
  if (!validation.ok) throw new LineageTaskError(validation.message, 409);
  const database = lineageDb();
  try {
    const task = requireTask(database, normalizedProject, fields.taskId);
    if (task.status !== 'claimed') throw new LineageTaskError('Only claimed lineage tasks can be started.', 409);
    if (task.claimed_by_claim_id && task.claimed_by_claim_id !== validation.claim.id) {
      throw new LineageTaskError('Claim token does not match the task claim.', 409);
    }
    const timestamp = nowIso();
    const metadata = { ...(task.metadata || {}), claim_id: validation.claim.id };
    transaction(database, () => {
      const result = database.prepare(`
        update lineage_tasks
        set status = 'in_progress', started_at = ?, updated_at = ?, metadata_json = ?
        where id = ? and status = 'claimed'
      `).run(timestamp, timestamp, metadataJson(metadata), task.id);
      assertChanged(result, 'Only claimed lineage tasks can be started.');
      recordEvent(database, task.id, 'started', validation.claim.agent_name, 'Lineage task started.', { claim_id: validation.claim.id });
    });
    return taskWithEvents(database, normalizedProject, task.id);
  } finally {
    database.close();
  }
}

export function cancelLineageTask(project: string, fields: { taskId: string; actor: string; confirmWrite: boolean; override?: boolean }): LineageTaskMutationResult {
  const normalizedProject = normalizeProject(project);
  const actor = normalizeActor(fields.actor, 'Cancel actor');
  const database = lineageDb();
  try {
    const task = requireTask(database, normalizedProject, fields.taskId);
    if (task.status === 'cancelled') return { project: normalizedProject, ok: true, task, events: taskEvents(database, task.id) };
    if (!['pending', 'claimed', 'in_progress'].includes(task.status)) {
      throw new LineageTaskError(`Only open lineage tasks can be cancelled; task is ${task.status}.`, 409);
    }
    if (task.status !== 'pending' && !fields.override) {
      throw new LineageTaskError('Cancelling an active lineage task requires override=true.', 409);
    }
    const timestamp = nowIso();
    const cancelledTask = { ...task, status: 'cancelled' as const, cancelled_at: timestamp, updated_at: timestamp };
    if (!fields.confirmWrite) return { project: normalizedProject, ok: true, dryRun: true as const, task: cancelledTask, events: taskEvents(database, task.id) };
    transaction(database, () => {
      const result = database.prepare(`
        update lineage_tasks
        set status = 'cancelled', cancelled_at = ?, updated_at = ?
        where id = ? and status = ?
      `).run(timestamp, timestamp, task.id, task.status);
      assertChanged(result, `Only ${task.status} lineage task ${task.id} could be cancelled.`);
      recordEvent(database, task.id, 'cancelled', actor, 'Lineage task cancelled.');
    });
    return taskWithEvents(database, normalizedProject, task.id);
  } finally {
    database.close();
  }
}
