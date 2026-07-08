import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { lineageDb, nowIso, type DatabaseSync } from './assetLineageDb';

export type AgentClaimScopeType = 'lineage_workspace' | 'lineage_task' | 'content_post' | 'content_queue_lane' | 'selection_set' | 'project_channel';
type AgentClaimStatus = 'active' | 'expired' | 'released' | 'revoked' | 'transferred';

export interface AgentClaim {
  id: string;
  project: string;
  channel?: string;
  scope_type: AgentClaimScopeType;
  target_id: string;
  target_title?: string;
  agent_id?: string;
  agent_name: string;
  agent_kind: string;
  thread_id?: string;
  status: AgentClaimStatus;
  created_at: string;
  heartbeat_at: string;
  expires_at: string;
  released_at?: string;
  revoked_at?: string;
  revoked_by?: string;
  override_reason?: string;
  metadata?: Record<string, unknown>;
  heartbeat_age_seconds: number;
  derived_state: 'active' | 'idle' | 'stale' | 'expired';
}

interface AgentClaimEvent {
  claim_id: string;
  event_type: string;
  actor?: string;
  message?: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface CreateAgentClaimFields {
  project: string;
  channel?: string;
  scopeType: AgentClaimScopeType;
  targetId: string;
  targetTitle?: string;
  agentId?: string;
  agentName: string;
  agentKind?: string;
  threadId?: string;
  ttlSeconds?: number;
  force?: boolean;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface ValidateAgentClaimForWriteFields {
  claimToken?: string;
  project: string;
  channel?: string;
  scopeType: AgentClaimScopeType;
  targetId: string;
  writeKind: string;
  dangerLevel: 'claim' | 'warn' | 'enforce' | 'danger';
  confirmWrite?: boolean;
  recordEvent?: boolean;
}

export type AgentClaimValidationResult =
  | { ok: true; claim: AgentClaim; warnings: string[] }
  | { ok: false; code: string; message: string; conflicts: AgentClaim[] };

type Row = Record<string, unknown>;

const defaultTtlSeconds = 20 * 60;
const idleAfterSeconds = 5 * 60;
const staleAfterSeconds = 15 * 60;
const scopes = new Set<AgentClaimScopeType>(['lineage_workspace', 'lineage_task', 'content_post', 'content_queue_lane', 'selection_set', 'project_channel']);
const claimTokenPattern = /claim_[a-z0-9_-]+\.[A-Za-z0-9_-]+/g;

export class AgentClaimError extends Error {
  constructor(message: string, public status = 400, public code = 'agent_claim_error', public conflicts: AgentClaim[] = []) {
    super(message);
  }
}

export function isAgentClaimError(error: unknown): error is AgentClaimError {
  return error instanceof AgentClaimError;
}

export function redactAgentClaimTokens(input: string): string {
  return input.replace(claimTokenPattern, '[redacted-claim-token]');
}

export function parseClaimTtl(value?: string): number {
  if (!value) return defaultTtlSeconds;
  const match = value.trim().match(/^(\d+)(s|m|h)?$/);
  if (!match) throw new AgentClaimError(`Invalid claim ttl: ${value}`);
  const amount = Number(match[1]);
  const unit = match[2] || 's';
  const multiplier = unit === 'h' ? 3600 : unit === 'm' ? 60 : 1;
  const seconds = amount * multiplier;
  if (!Number.isInteger(seconds) || seconds < 30 || seconds > 24 * 60 * 60) {
    throw new AgentClaimError('Claim ttl must be between 30 seconds and 24 hours');
  }
  return seconds;
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(6).toString('base64url').toLowerCase()}`;
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function expiresAtFrom(timestamp: string, ttlSeconds: number): string {
  return new Date(new Date(timestamp).getTime() + ttlSeconds * 1000).toISOString();
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

function derivedState(row: { status: AgentClaimStatus; heartbeat_at: string; expires_at: string }, now = new Date()): AgentClaim['derived_state'] {
  if (row.status !== 'active') return row.status === 'expired' ? 'expired' : 'stale';
  if (new Date(row.expires_at).getTime() <= now.getTime()) return 'expired';
  const ageSeconds = Math.max(0, Math.floor((now.getTime() - new Date(row.heartbeat_at).getTime()) / 1000));
  if (ageSeconds >= staleAfterSeconds) return 'stale';
  if (ageSeconds >= idleAfterSeconds) return 'idle';
  return 'active';
}

function rowToClaim(row: Row, now = new Date()): AgentClaim {
  const heartbeatAt = String(row.heartbeat_at);
  return {
    id: String(row.id),
    project: String(row.project_id),
    channel: typeof row.channel === 'string' ? row.channel : undefined,
    scope_type: String(row.scope_type) as AgentClaimScopeType,
    target_id: String(row.target_id),
    target_title: typeof row.target_title === 'string' ? row.target_title : undefined,
    agent_id: typeof row.agent_id === 'string' ? row.agent_id : undefined,
    agent_name: String(row.agent_name),
    agent_kind: String(row.agent_kind),
    thread_id: typeof row.thread_id === 'string' ? row.thread_id : undefined,
    status: String(row.status) as AgentClaimStatus,
    created_at: String(row.created_at),
    heartbeat_at: heartbeatAt,
    expires_at: String(row.expires_at),
    released_at: typeof row.released_at === 'string' ? row.released_at : undefined,
    revoked_at: typeof row.revoked_at === 'string' ? row.revoked_at : undefined,
    revoked_by: typeof row.revoked_by === 'string' ? row.revoked_by : undefined,
    override_reason: typeof row.override_reason === 'string' ? row.override_reason : undefined,
    metadata: parseMetadata(row.metadata_json),
    heartbeat_age_seconds: Math.max(0, Math.floor((now.getTime() - new Date(heartbeatAt).getTime()) / 1000)),
    derived_state: derivedState({
      expires_at: String(row.expires_at),
      heartbeat_at: heartbeatAt,
      status: String(row.status) as AgentClaimStatus,
    }, now),
  };
}

function eventToRow(row: Row): AgentClaimEvent {
  return {
    claim_id: String(row.claim_id),
    event_type: String(row.event_type),
    actor: typeof row.actor === 'string' ? row.actor : undefined,
    message: typeof row.message === 'string' ? row.message : undefined,
    created_at: String(row.created_at),
    metadata: parseMetadata(row.metadata_json),
  };
}

function ensureProject(database: DatabaseSync, project: string): void {
  const timestamp = nowIso();
  database.prepare(`
    insert into projects (id, product, created_at, updated_at)
    values (?, ?, ?, ?)
    on conflict(id) do update set product = excluded.product, updated_at = excluded.updated_at
  `).run(project, project, timestamp, timestamp);
}

function recordEvent(database: DatabaseSync, claimId: string, eventType: string, actor?: string, message?: string, metadata?: Record<string, unknown>): void {
  database.prepare(`
    insert into agent_claim_events (id, claim_id, event_type, actor, message, created_at, metadata_json)
    values (?, ?, ?, ?, ?, ?, ?)
  `).run(randomId('claim_event'), claimId, eventType, actor || null, message || null, nowIso(), metadataJson(metadata));
}

function expireActiveClaims(database: DatabaseSync): void {
  const timestamp = nowIso();
  const expired = database.prepare(`
    select id from agent_claims where status = 'active' and expires_at <= ?
  `).all(timestamp) as Array<{ id: string }>;
  if (expired.length === 0) return;
  database.prepare(`
    update agent_claims set status = 'expired' where status = 'active' and expires_at <= ?
  `).run(timestamp);
  for (const claim of expired) recordEvent(database, claim.id, 'expired', 'system', 'Claim expired after missed heartbeat.');
}

function normalizeScope(scopeType: AgentClaimScopeType): AgentClaimScopeType {
  if (!scopes.has(scopeType)) throw new AgentClaimError(`Unsupported claim scope: ${scopeType}`);
  return scopeType;
}

function channelOverlaps(left?: string, right?: string): boolean {
  return !left || !right || left === right;
}

function claimOverlaps(candidate: Pick<AgentClaim, 'project' | 'channel' | 'scope_type' | 'target_id'>, existing: AgentClaim): boolean {
  if (candidate.project !== existing.project) return false;
  if (!channelOverlaps(candidate.channel, existing.channel)) return false;
  if (candidate.scope_type === existing.scope_type && candidate.target_id === existing.target_id) return true;
  return candidate.scope_type === 'project_channel' || existing.scope_type === 'project_channel';
}

function activeClaims(database: DatabaseSync, project?: string): AgentClaim[] {
  const rows = project
    ? database.prepare("select * from agent_claims where project_id = ? and status = 'active' order by heartbeat_at desc").all(project)
    : database.prepare("select * from agent_claims where status = 'active' order by project_id, heartbeat_at desc").all();
  return (rows as Row[]).map(row => rowToClaim(row));
}

function findClaimById(database: DatabaseSync, claimId: string, project?: string): AgentClaim | null {
  const row = project
    ? database.prepare('select * from agent_claims where project_id = ? and id = ?').get(project, claimId)
    : database.prepare('select * from agent_claims where id = ?').get(claimId);
  return row ? rowToClaim(row as Row) : null;
}

function findClaimRowByToken(database: DatabaseSync, claimToken: string): Row | null {
  const claimId = claimToken.split('.')[0];
  const row = database.prepare('select * from agent_claims where id = ?').get(claimId) as Row | undefined;
  if (!row) return null;
  return safeEqual(String(row.token_hash), tokenHash(claimToken)) ? row : null;
}

function denied(code: string, message: string, conflicts: AgentClaim[] = []): AgentClaimValidationResult {
  return { ok: false, code, message, conflicts };
}

function scopeAllowsWrite(claim: AgentClaim, scopeType: AgentClaimScopeType, targetId: string, writeKind: string): boolean {
  if (claim.scope_type === scopeType && claim.target_id === targetId) return true;
  if (claim.scope_type === 'project_channel') return true;
  if (claim.scope_type === 'lineage_workspace' && scopeType === 'lineage_workspace') return claim.target_id === targetId;
  if (claim.scope_type === 'content_queue_lane' && writeKind === 'content_queue_next') return true;
  return false;
}

export function createAgentClaim(fields: CreateAgentClaimFields) {
  const project = fields.project.trim();
  const targetId = fields.targetId.trim();
  const agentName = fields.agentName.trim();
  if (!project) throw new AgentClaimError('Agent claim requires project');
  if (!targetId) throw new AgentClaimError('Agent claim requires target');
  if (!agentName) throw new AgentClaimError('Agent claim requires agent name');
  const scopeType = normalizeScope(fields.scopeType);
  const ttlSeconds = fields.ttlSeconds || defaultTtlSeconds;
  const database = lineageDb();
  try {
    ensureProject(database, project);
    expireActiveClaims(database);
    const candidate = { project, channel: fields.channel?.trim() || undefined, scope_type: scopeType, target_id: targetId };
    const conflicts = activeClaims(database, project).filter(claim => claimOverlaps(candidate, claim));
    if (conflicts.length > 0 && !fields.force) {
      throw new AgentClaimError('Target already has an active overlapping agent claim.', 409, 'target_already_claimed', conflicts);
    }
    if (conflicts.length > 0 && !fields.reason?.trim()) {
      throw new AgentClaimError('Overriding an active claim requires --reason.', 400, 'override_reason_required', conflicts);
    }
    const timestamp = nowIso();
    for (const conflict of conflicts) {
      database.prepare(`
        update agent_claims
        set status = 'revoked', revoked_at = ?, revoked_by = ?, override_reason = ?
        where id = ? and status = 'active'
      `).run(timestamp, agentName, fields.reason || null, conflict.id);
      recordEvent(database, conflict.id, 'revoked', agentName, fields.reason || 'Revoked by forced claim takeover.');
      recordEvent(database, conflict.id, 'conflict', agentName, `Overridden by ${agentName}.`, { new_claim_target: targetId });
    }
    const id = randomId('claim');
    const secret = randomBytes(24).toString('base64url');
    const claimToken = `${id}.${secret}`;
    const expiresAt = expiresAtFrom(timestamp, ttlSeconds);
    database.prepare(`
      insert into agent_claims (
        id, token_hash, project_id, channel, scope_type, target_id, target_title, agent_id, agent_name,
        agent_kind, thread_id, status, created_at, heartbeat_at, expires_at, metadata_json
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
    `).run(
      id,
      tokenHash(claimToken),
      project,
      candidate.channel || null,
      scopeType,
      targetId,
      fields.targetTitle?.trim() || null,
      fields.agentId?.trim() || null,
      agentName,
      fields.agentKind?.trim() || 'codex',
      fields.threadId?.trim() || null,
      timestamp,
      timestamp,
      expiresAt,
      metadataJson(fields.metadata)
    );
    recordEvent(database, id, 'created', agentName, `Claimed ${scopeType} ${targetId}.`, { ttl_seconds: ttlSeconds });
    const claim = findClaimById(database, id);
    return { ok: true as const, claim, claim_token: claimToken, conflicts_revoked: conflicts.map(conflict => conflict.id) };
  } finally {
    database.close();
  }
}

export function listAgentClaims(project?: string) {
  const database = lineageDb();
  try {
    expireActiveClaims(database);
    const rows = project
      ? database.prepare('select * from agent_claims where project_id = ? order by status, heartbeat_at desc').all(project)
      : database.prepare('select * from agent_claims order by project_id, status, heartbeat_at desc').all();
    return { ok: true as const, claims: (rows as Row[]).map(row => rowToClaim(row)), fetchedAt: nowIso() };
  } finally {
    database.close();
  }
}

export function inspectAgentClaim(claimId: string, project?: string) {
  const database = lineageDb();
  try {
    expireActiveClaims(database);
    const claim = findClaimById(database, claimId, project);
    if (!claim) throw new AgentClaimError(`Unknown agent claim: ${claimId}`, 404, 'claim_not_found');
    const events = database.prepare('select * from agent_claim_events where claim_id = ? order by created_at').all(claim.id) as Row[];
    return { ok: true as const, claim, events: events.map(eventToRow) };
  } finally {
    database.close();
  }
}

export function heartbeatAgentClaim(claimToken: string, ttlSeconds = defaultTtlSeconds) {
  const database = lineageDb();
  try {
    expireActiveClaims(database);
    const row = findClaimRowByToken(database, claimToken);
    if (!row) throw new AgentClaimError('Unknown or invalid agent claim token.', 401, 'claim_token_invalid');
    const claim = rowToClaim(row);
    if (claim.status !== 'active') throw new AgentClaimError(`Agent claim is ${claim.status}.`, 409, 'claim_not_active');
    const timestamp = nowIso();
    database.prepare('update agent_claims set heartbeat_at = ?, expires_at = ? where id = ?').run(timestamp, expiresAtFrom(timestamp, ttlSeconds), claim.id);
    recordEvent(database, claim.id, 'heartbeat', claim.agent_name, 'Claim heartbeat received.');
    return { ok: true as const, claim: findClaimById(database, claim.id) };
  } finally {
    database.close();
  }
}

export function releaseAgentClaim(claimToken: string) {
  const database = lineageDb();
  try {
    expireActiveClaims(database);
    const row = findClaimRowByToken(database, claimToken);
    if (!row) throw new AgentClaimError('Unknown or invalid agent claim token.', 401, 'claim_token_invalid');
    const claim = rowToClaim(row);
    if (claim.status !== 'active') throw new AgentClaimError(`Agent claim is ${claim.status}.`, 409, 'claim_not_active');
    const timestamp = nowIso();
    database.prepare("update agent_claims set status = 'released', released_at = ? where id = ?").run(timestamp, claim.id);
    recordEvent(database, claim.id, 'released', claim.agent_name, 'Claim released by token holder.');
    return { ok: true as const, claim: findClaimById(database, claim.id) };
  } finally {
    database.close();
  }
}

export function releaseStaleAgentClaim(project: string, claimId: string, fields: { actor?: string; confirmWrite: boolean; reason?: string }) {
  if (!fields.confirmWrite) throw new AgentClaimError('Releasing a stale agent claim requires confirmWrite=true.', 400, 'confirm_write_required');
  if (!fields.reason?.trim()) throw new AgentClaimError('Releasing a stale agent claim requires a reason.', 400, 'reason_required');
  const database = lineageDb();
  try {
    expireActiveClaims(database);
    const claim = findClaimById(database, claimId, project);
    if (!claim) throw new AgentClaimError(`Unknown agent claim: ${claimId}`, 404, 'claim_not_found');
    if (claim.status !== 'active' || claim.derived_state !== 'stale') {
      throw new AgentClaimError('Only stale active claims can be released without the claim token.', 409, 'claim_not_stale', [claim]);
    }
    const timestamp = nowIso();
    database.prepare("update agent_claims set status = 'released', released_at = ?, revoked_by = ?, override_reason = ? where id = ?").run(timestamp, fields.actor || 'human', fields.reason, claim.id);
    recordEvent(database, claim.id, 'released', fields.actor || 'human', fields.reason);
    return { ok: true as const, claim: findClaimById(database, claim.id) };
  } finally {
    database.close();
  }
}

export function revokeAgentClaim(project: string, claimId: string, fields: { actor?: string; confirmWrite: boolean; reason?: string }) {
  if (!fields.confirmWrite) throw new AgentClaimError('Revoking an agent claim requires confirmWrite=true.', 400, 'confirm_write_required');
  if (!fields.reason?.trim()) throw new AgentClaimError('Revoking an agent claim requires a reason.', 400, 'reason_required');
  const database = lineageDb();
  try {
    expireActiveClaims(database);
    const claim = findClaimById(database, claimId, project);
    if (!claim) throw new AgentClaimError(`Unknown agent claim: ${claimId}`, 404, 'claim_not_found');
    const timestamp = nowIso();
    database.prepare(`
      update agent_claims set status = 'revoked', revoked_at = ?, revoked_by = ?, override_reason = ?
      where id = ?
    `).run(timestamp, fields.actor || 'human', fields.reason, claim.id);
    recordEvent(database, claim.id, 'revoked', fields.actor || 'human', fields.reason);
    return { ok: true as const, claim: findClaimById(database, claim.id) };
  } finally {
    database.close();
  }
}

export function revokeAgentClaimInDatabase(database: DatabaseSync, project: string, claimId: string, fields: { actor?: string; reason?: string }) {
  expireActiveClaims(database);
  const claim = findClaimById(database, claimId, project);
  if (!claim) throw new AgentClaimError(`Unknown agent claim: ${claimId}`, 404, 'claim_not_found');
  if (claim.status !== 'active') return claim;
  const timestamp = nowIso();
  database.prepare(`
    update agent_claims set status = 'revoked', revoked_at = ?, revoked_by = ?, override_reason = ?
    where id = ? and status = 'active'
  `).run(timestamp, fields.actor || 'human', fields.reason || null, claim.id);
  recordEvent(database, claim.id, 'revoked', fields.actor || 'human', fields.reason);
  return findClaimById(database, claim.id, project);
}

export function transferAgentClaim(project: string, claimId: string, fields: { confirmWrite: boolean; toAgentName: string; actor?: string; reason?: string }) {
  if (!fields.confirmWrite) throw new AgentClaimError('Transferring an agent claim requires confirmWrite=true.', 400, 'confirm_write_required');
  const toAgentName = fields.toAgentName.trim();
  if (!toAgentName) throw new AgentClaimError('Transfer requires toAgentName.', 400, 'agent_name_required');
  const database = lineageDb();
  try {
    expireActiveClaims(database);
    const claim = findClaimById(database, claimId, project);
    if (!claim) throw new AgentClaimError(`Unknown agent claim: ${claimId}`, 404, 'claim_not_found');
    if (claim.status !== 'active') throw new AgentClaimError(`Agent claim is ${claim.status}.`, 409, 'claim_not_active');
    database.prepare('update agent_claims set agent_name = ? where id = ?').run(toAgentName, claim.id);
    recordEvent(database, claim.id, 'transferred', fields.actor || 'human', fields.reason || `Transferred claim to ${toAgentName}.`, { to_agent_name: toAgentName });
    return { ok: true as const, claim: findClaimById(database, claim.id) };
  } finally {
    database.close();
  }
}

export function recordAgentClaimWriteAllowed(claim: Pick<AgentClaim, 'id' | 'agent_name'>, fields: Pick<ValidateAgentClaimForWriteFields, 'dangerLevel' | 'targetId' | 'writeKind'>) {
  const database = lineageDb();
  try {
    recordEvent(database, claim.id, 'write_allowed', claim.agent_name, `${fields.writeKind} allowed.`, {
      danger_level: fields.dangerLevel,
      target_id: fields.targetId,
      write_kind: fields.writeKind,
    });
    return { ok: true as const };
  } finally {
    database.close();
  }
}

export function validateAgentClaimForWrite(fields: ValidateAgentClaimForWriteFields): AgentClaimValidationResult {
  if (fields.dangerLevel === 'danger' && !fields.confirmWrite) {
    return denied('human_confirmation_required', 'Dangerous write requires explicit human confirmation.');
  }
  if (!fields.claimToken) return denied('claim_required', 'Mutating agent write requires a matching claim token.');
  const database = lineageDb();
  try {
    expireActiveClaims(database);
    const row = findClaimRowByToken(database, fields.claimToken);
    if (!row) return denied('claim_token_invalid', 'Unknown or invalid claim token.');
    const claim = rowToClaim(row);
    if (claim.status !== 'active') return denied('claim_not_active', `Agent claim is ${claim.status}.`);
    if (new Date(claim.expires_at).getTime() <= Date.now()) return denied('claim_expired', 'Agent claim has expired.');
    if (claim.project !== fields.project) return denied('claim_project_mismatch', `Claim project ${claim.project} does not match ${fields.project}.`, [claim]);
    if (fields.channel && claim.channel && claim.channel !== fields.channel) {
      return denied('claim_channel_mismatch', `Claim channel ${claim.channel} does not match ${fields.channel}.`, [claim]);
    }
    if (!scopeAllowsWrite(claim, fields.scopeType, fields.targetId, fields.writeKind)) {
      return denied('claim_scope_mismatch', `Claim does not cover ${fields.scopeType} ${fields.targetId}.`, [claim]);
    }
    if (fields.recordEvent !== false) {
      recordEvent(database, claim.id, 'write_allowed', claim.agent_name, `${fields.writeKind} allowed.`, {
        danger_level: fields.dangerLevel,
        target_id: fields.targetId,
        write_kind: fields.writeKind,
      });
    }
    return { ok: true, claim, warnings: [] };
  } finally {
    database.close();
  }
}
