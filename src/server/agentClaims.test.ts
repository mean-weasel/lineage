import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useLineageTestProfile } from '../test/lineageTestProfile';
import express, { type Express } from 'express';
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { defaultProject, repoRoot } from './assetCore';
import { lineageDb } from './assetLineageDb';
import {
  AgentClaimError,
  createAgentClaim,
  heartbeatAgentClaim,
  inspectAgentClaim,
  listAgentClaims,
  releaseAgentClaim,
  releaseStaleAgentClaim,
  revokeAgentClaim,
  validateAgentClaimForWrite,
} from './agentClaims';
import { isAgentClaimError } from './agentClaims';
import { registerAgentClaimRoutes } from './agentClaimRoutes';

const require = createRequire(import.meta.url);
const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-agent-claims');
const dbFile = join(scratchDir, 'agent-claims.sqlite');
const originalEnv = { ...process.env };
let server: ReturnType<Express['listen']> | null = null;

beforeEach(() => {
  rmSync(scratchDir, { force: true, recursive: true });
  useLineageTestProfile(dbFile);
});

afterEach(() => {
  server?.close();
  server = null;
  process.env = { ...originalEnv };
});

function createWorkspaceClaim(overrides: Partial<Parameters<typeof createAgentClaim>[0]> = {}) {
  return createAgentClaim({
    agentName: 'Codex thread 123',
    channel: 'tiktok',
    project: defaultProject,
    scopeType: 'lineage_workspace',
    targetId: `${defaultProject}:lineage-workspace:root-asset`,
    targetTitle: 'TikTok lineage',
    ...overrides,
  });
}

function ageClaimHeartbeat(claimId: string, heartbeatAt: string, expiresAt = '2099-01-01T00:00:00.000Z') {
  const database = lineageDb();
  try {
    database.prepare('update agent_claims set heartbeat_at = ?, expires_at = ? where id = ?').run(heartbeatAt, expiresAt, claimId);
  } finally {
    database.close();
  }
}

function createLegacyAgentClaimDb() {
  mkdirSync(scratchDir, { recursive: true });
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const database = new DatabaseSync(dbFile);
  try {
    database.exec(`
      pragma foreign_keys = on;
      create table projects (
        id text primary key,
        product text not null,
        catalog_path text,
        created_at text not null,
        updated_at text not null
      );
      create table agent_claims (
        id text primary key,
        token_hash text not null,
        project_id text not null references projects(id),
        channel text,
        scope_type text not null check (scope_type in ('lineage_workspace', 'content_post', 'content_queue_lane', 'selection_set', 'project_channel')),
        target_id text not null,
        target_title text,
        agent_id text,
        agent_name text not null,
        agent_kind text not null,
        thread_id text,
        status text not null check (status in ('active', 'expired', 'released', 'revoked', 'transferred')),
        created_at text not null,
        heartbeat_at text not null,
        expires_at text not null,
        released_at text,
        revoked_at text,
        revoked_by text,
        override_reason text,
        metadata_json text
      );
      create unique index agent_claims_token_hash on agent_claims(token_hash);
      create index agent_claims_project_status on agent_claims(project_id, status, heartbeat_at);
      create index agent_claims_target on agent_claims(project_id, channel, scope_type, target_id, status);
      create table agent_claim_events (
        id text primary key,
        claim_id text not null references agent_claims(id) on delete cascade,
        event_type text not null,
        actor text,
        message text,
        created_at text not null,
        metadata_json text
      );
      create index agent_claim_events_claim_created on agent_claim_events(claim_id, created_at);
      insert into projects (id, product, created_at, updated_at)
      values ('${defaultProject}', '${defaultProject}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      insert into agent_claims (
        id, token_hash, project_id, scope_type, target_id, agent_name, agent_kind, status,
        created_at, heartbeat_at, expires_at
      ) values (
        'claim_legacy', 'legacy-token-hash', '${defaultProject}', 'lineage_workspace', '${defaultProject}:lineage-workspace:legacy-root',
        'Legacy agent', 'codex', 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
        '2099-01-01T00:00:00.000Z'
      );
      insert into agent_claim_events (id, claim_id, event_type, actor, message, created_at)
      values ('event_legacy', 'claim_legacy', 'created', 'Legacy agent', 'Legacy claim created.', '2026-01-01T00:00:00.000Z');
    `);
  } finally {
    database.close();
  }
}

function appWithAgentClaimRoutes() {
  const app = express();
  app.use(express.json());
  registerAgentClaimRoutes(app, input => {
    const candidate = input.body?.project || input.query?.project;
    return typeof candidate === 'string' ? candidate : defaultProject;
  }, handler => (req, res, next) => { Promise.resolve(handler(req, res)).catch(next); });
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (isAgentClaimError(error)) {
      res.status(error.status).json({ error: error.code, message: error.message, conflicts: error.conflicts });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  });
  server = app.listen(0);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('agent claims', () => {
  it('creates claims without exposing token hashes in read APIs', () => {
    const created = createWorkspaceClaim();
    const status = listAgentClaims(defaultProject);
    const inspected = inspectAgentClaim(created.claim!.id, defaultProject);
    const serializedReads = JSON.stringify({ inspected, status });

    expect(created.claim_token).toMatch(/^claim_[a-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(status.claims).toHaveLength(1);
    expect(status.claims[0]).toMatchObject({
      agent_name: 'Codex thread 123',
      channel: 'tiktok',
      derived_state: 'active',
      scope_type: 'lineage_workspace',
      status: 'active',
    });
    expect(inspected.events.map(event => event.event_type)).toContain('created');
    expect(serializedReads).not.toContain('token_hash');
    expect(serializedReads).not.toContain(created.claim_token);
  });

  it('projects expired status from read-only claims without mutating the stored row', () => {
    const created = createWorkspaceClaim();
    ageClaimHeartbeat(created.claim!.id, '2026-01-01T00:00:00.000Z', '2026-01-01T00:01:00.000Z');
    process.env.LINEAGE_DB_ACCESS = 'read-only';

    expect(listAgentClaims(defaultProject).claims[0]).toMatchObject({ status: 'expired', derived_state: 'expired' });
    expect(inspectAgentClaim(created.claim!.id, defaultProject).claim).toMatchObject({ status: 'expired', derived_state: 'expired' });
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const database = new DatabaseSync(dbFile, { readOnly: true });
    expect(database.prepare('select status from agent_claims where id = ?').get(created.claim!.id)).toMatchObject({ status: 'active' });
    database.close();
  });

  it('blocks exact target conflicts unless force and reason are present', () => {
    const first = createWorkspaceClaim();

    expect(() => createWorkspaceClaim({ agentName: 'Codex thread 456' })).toThrow(AgentClaimError);
    expect(() => createWorkspaceClaim({ agentName: 'Codex thread 456', force: true })).toThrow('requires --reason');

    const second = createWorkspaceClaim({ agentName: 'Codex thread 456', force: true, reason: 'Taking over stale work.' });
    const claims = listAgentClaims(defaultProject).claims;

    expect(second.conflicts_revoked).toEqual([first.claim!.id]);
    expect(claims.find(claim => claim.id === first.claim!.id)?.status).toBe('revoked');
    expect(claims.find(claim => claim.id === second.claim!.id)?.status).toBe('active');
  });

  it('treats project channel claims as rare broad claims with channel-bounded conflicts', () => {
    const specific = createWorkspaceClaim({
      channel: 'tiktok',
      targetId: `${defaultProject}:lineage-workspace:tiktok-root`,
    });

    expect(() =>
      createWorkspaceClaim({
        agentName: 'Broad TikTok owner',
        channel: 'tiktok',
        scopeType: 'project_channel',
        targetId: `${defaultProject}:channel:tiktok`,
      })
    ).toThrow('Target already has an active overlapping agent claim.');

    const linkedinBroad = createWorkspaceClaim({
      agentName: 'Broad LinkedIn owner',
      channel: 'linkedin',
      scopeType: 'project_channel',
      targetId: `${defaultProject}:channel:linkedin`,
    });

    expect(linkedinBroad.claim).toMatchObject({ channel: 'linkedin', scope_type: 'project_channel' });
    expect(() =>
      createWorkspaceClaim({
        agentName: 'LinkedIn specific owner',
        channel: 'linkedin',
        scopeType: 'content_post',
        targetId: 'linkedin-post',
      })
    ).toThrow('Target already has an active overlapping agent claim.');
    expect(specific.claim).toMatchObject({ channel: 'tiktok' });
  });

  it('validates write scope, supports heartbeat, and release invalidates the token', () => {
    const created = createWorkspaceClaim();
    const allowed = validateAgentClaimForWrite({
      channel: 'tiktok',
      claimToken: created.claim_token,
      confirmWrite: true,
      dangerLevel: 'enforce',
      project: defaultProject,
      scopeType: 'lineage_workspace',
      targetId: `${defaultProject}:lineage-workspace:root-asset`,
      writeKind: 'link_child',
    });
    const mismatch = validateAgentClaimForWrite({
      channel: 'linkedin',
      claimToken: created.claim_token,
      confirmWrite: true,
      dangerLevel: 'enforce',
      project: defaultProject,
      scopeType: 'lineage_workspace',
      targetId: `${defaultProject}:lineage-workspace:root-asset`,
      writeKind: 'link_child',
    });

    expect(allowed.ok).toBe(true);
    expect(mismatch).toMatchObject({ code: 'claim_channel_mismatch', ok: false });
    expect(heartbeatAgentClaim(created.claim_token).claim).toMatchObject({ status: 'active' });
    expect(releaseAgentClaim(created.claim_token).claim).toMatchObject({ status: 'released' });
    expect(validateAgentClaimForWrite({
      claimToken: created.claim_token,
      dangerLevel: 'enforce',
      project: defaultProject,
      scopeType: 'lineage_workspace',
      targetId: `${defaultProject}:lineage-workspace:root-asset`,
      writeKind: 'link_child',
    })).toMatchObject({ code: 'claim_not_active', ok: false });
  });

  it('allows project channel claims to validate same-channel writes but not other channels', () => {
    const broad = createWorkspaceClaim({
      channel: 'tiktok',
      scopeType: 'project_channel',
      targetId: `${defaultProject}:channel:tiktok`,
    });

    expect(validateAgentClaimForWrite({
      channel: 'tiktok',
      claimToken: broad.claim_token,
      confirmWrite: true,
      dangerLevel: 'enforce',
      project: defaultProject,
      scopeType: 'content_post',
      targetId: 'tiktok-post',
      writeKind: 'content_post_phase',
    })).toMatchObject({ ok: true });
    expect(validateAgentClaimForWrite({
      channel: 'linkedin',
      claimToken: broad.claim_token,
      confirmWrite: true,
      dangerLevel: 'enforce',
      project: defaultProject,
      scopeType: 'content_post',
      targetId: 'linkedin-post',
      writeKind: 'content_post_phase',
    })).toMatchObject({ code: 'claim_channel_mismatch', ok: false });
  });

  it('supports lineage_task claims for task-level occupancy', () => {
    process.env.LINEAGE_DB = dbFile;
    const created = createAgentClaim({
      agentName: 'Task agent',
      project: defaultProject,
      scopeType: 'lineage_task',
      targetId: 'task_demo_root_iterate_child',
      targetTitle: 'Iterate child image',
    });

    expect(created.claim).toMatchObject({
      project: defaultProject,
      scope_type: 'lineage_task',
      target_id: 'task_demo_root_iterate_child',
    });

    expect(validateAgentClaimForWrite({
      claimToken: created.claim_token,
      dangerLevel: 'enforce',
      project: defaultProject,
      scopeType: 'lineage_task',
      targetId: 'task_demo_root_iterate_child',
      writeKind: 'lineage_task_start',
    })).toMatchObject({ ok: true });
  });

  it('migrates legacy agent claim scopes without breaking claim event foreign keys', () => {
    createLegacyAgentClaimDb();

    const database = lineageDb();
    try {
      const eventForeignKeys = database.prepare('pragma foreign_key_list(agent_claim_events)').all() as Array<{ table: string }>;
      const event = database.prepare('select * from agent_claim_events where id = ?').get('event_legacy') as { claim_id?: string } | undefined;

      expect(eventForeignKeys.some(foreignKey => foreignKey.table === 'agent_claims')).toBe(true);
      expect(eventForeignKeys.some(foreignKey => foreignKey.table === 'agent_claims_old')).toBe(false);
      expect(event).toMatchObject({ claim_id: 'claim_legacy' });
    } finally {
      database.close();
    }

    const created = createAgentClaim({
      agentName: 'Task agent after migration',
      project: defaultProject,
      scopeType: 'lineage_task',
      targetId: 'task_legacy_root_iterate_child',
      targetTitle: 'Iterate legacy child image',
    });

    expect(created.claim).toMatchObject({
      project: defaultProject,
      scope_type: 'lineage_task',
      target_id: 'task_legacy_root_iterate_child',
    });
  });

  it('requires confirmation and reason for human revocation', () => {
    const created = createWorkspaceClaim();

    expect(() => revokeAgentClaim(defaultProject, created.claim!.id, { confirmWrite: false, reason: 'stale' })).toThrow('confirmWrite=true');
    expect(() => revokeAgentClaim(defaultProject, created.claim!.id, { confirmWrite: true })).toThrow('requires a reason');
    expect(revokeAgentClaim(defaultProject, created.claim!.id, { confirmWrite: true, reason: 'stale thread' }).claim).toMatchObject({
      status: 'revoked',
    });
  });

  it('allows confirmed human release only for stale active claims', () => {
    const created = createWorkspaceClaim();

    expect(() =>
      releaseStaleAgentClaim(defaultProject, created.claim!.id, { confirmWrite: false, reason: 'stale handoff' })
    ).toThrow('confirmWrite=true');
    expect(() =>
      releaseStaleAgentClaim(defaultProject, created.claim!.id, { confirmWrite: true, reason: 'not stale yet' })
    ).toThrow('Only stale active claims can be released');

    ageClaimHeartbeat(created.claim!.id, '2026-01-01T00:00:00.000Z');

    const released = releaseStaleAgentClaim(defaultProject, created.claim!.id, {
      actor: 'human',
      confirmWrite: true,
      reason: 'Stale thread released from UI.',
    });
    const inspected = inspectAgentClaim(created.claim!.id, defaultProject);

    expect(released.claim).toMatchObject({ status: 'released' });
    expect(inspected.events.map(event => event.event_type)).toContain('released');
  });

  it('serves confirmed stale release over HTTP without exposing raw tokens', async () => {
    const baseUrl = appWithAgentClaimRoutes();
    const created = createWorkspaceClaim({ targetId: `${defaultProject}:lineage-workspace:stale-http` });
    ageClaimHeartbeat(created.claim!.id, '2026-01-01T00:00:00.000Z');

    const response = await fetch(`${baseUrl}/api/agent-claims/${created.claim!.id}/release-stale`, {
      body: JSON.stringify({
        confirmWrite: true,
        project: defaultProject,
        reason: 'Stale claim released from conflict controls.',
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const released = await response.json() as { claim: { status: string } };

    expect(response.ok).toBe(true);
    expect(released.claim.status).toBe('released');
    expect(JSON.stringify(released)).not.toContain(created.claim_token);
  });

  it('serves claim lifecycle endpoints with header and body claim token support', async () => {
    const baseUrl = appWithAgentClaimRoutes();
    const createdResponse = await fetch(`${baseUrl}/api/agent-claims`, {
      body: JSON.stringify({
        agentName: 'HTTP agent',
        project: defaultProject,
        scopeType: 'lineage_workspace',
        targetId: `${defaultProject}:lineage-workspace:http-root`,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const created = await createdResponse.json() as { claim: { id: string; status: string }; claim_token: string };
    const heartbeatResponse = await fetch(`${baseUrl}/api/agent-claims/${created.claim.id}/heartbeat`, {
      headers: { 'X-Lineage-Claim-Token': created.claim_token },
      method: 'POST',
    });
    const releaseResponse = await fetch(`${baseUrl}/api/agent-claims/${created.claim.id}/release`, {
      body: JSON.stringify({ claimToken: created.claim_token }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const release = await releaseResponse.json() as { claim: { status: string } };
    const statusResponse = await fetch(`${baseUrl}/api/agent-claims?project=${defaultProject}`);
    const status = await statusResponse.json();

    expect(createdResponse.ok).toBe(true);
    expect(heartbeatResponse.ok).toBe(true);
    expect(releaseResponse.ok).toBe(true);
    expect(release.claim.status).toBe('released');
    expect(JSON.stringify(status)).not.toContain(created.claim_token);
  });
});
