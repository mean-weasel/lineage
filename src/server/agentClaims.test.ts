import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import { rmSync } from 'node:fs';
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

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-agent-claims');
const dbFile = join(scratchDir, 'agent-claims.sqlite');
const originalEnv = { ...process.env };
let server: ReturnType<Express['listen']> | null = null;

beforeEach(() => {
  rmSync(scratchDir, { force: true, recursive: true });
  process.env.LINEAGE_DB = dbFile;
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
