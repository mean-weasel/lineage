import type express from 'express';
import {
  AgentClaimError,
  createAgentClaim,
  heartbeatAgentClaim,
  inspectAgentClaim,
  listAgentClaims,
  parseClaimTtl,
  releaseAgentClaim,
  releaseStaleAgentClaim,
  revokeAgentClaim,
  transferAgentClaim,
  type AgentClaimScopeType,
} from './agentClaims';

type ProjectFrom = (input: { body?: Record<string, unknown>; query?: Record<string, unknown> }) => string;
type AsyncRoute = (handler: (req: express.Request, res: express.Response) => Promise<void> | void) => express.RequestHandler;

export function claimTokenFromRequest(req: express.Request): string | undefined {
  const header = req.header('X-Lineage-Claim-Token');
  if (header) return header;
  return typeof req.body?.claimToken === 'string' ? req.body.claimToken : undefined;
}

function stringBody(req: express.Request, key: string): string | undefined {
  const value = (req.body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function boolBody(req: express.Request, key: string): boolean {
  return (req.body as Record<string, unknown>)[key] === true;
}

export function registerAgentClaimRoutes(app: express.Express, projectFrom: ProjectFrom, asyncRoute: AsyncRoute): void {
  app.get('/api/agent-claims', asyncRoute((req, res) => {
    const project = typeof req.query.project === 'string' ? req.query.project : undefined;
    res.json(listAgentClaims(project));
  }));

  app.post('/api/agent-claims', asyncRoute((req, res) => {
    res.json(createAgentClaim({
      agentId: stringBody(req, 'agentId'),
      agentKind: stringBody(req, 'agentKind'),
      agentName: stringBody(req, 'agentName') || stringBody(req, 'agent_name') || '',
      channel: stringBody(req, 'channel'),
      force: boolBody(req, 'force'),
      metadata: typeof req.body.metadata === 'object' && req.body.metadata !== null ? req.body.metadata as Record<string, unknown> : undefined,
      project: projectFrom({ body: req.body as Record<string, unknown>, query: req.query }),
      reason: stringBody(req, 'reason'),
      scopeType: (stringBody(req, 'scopeType') || stringBody(req, 'scope_type') || '') as AgentClaimScopeType,
      targetId: stringBody(req, 'targetId') || stringBody(req, 'target_id') || '',
      targetTitle: stringBody(req, 'targetTitle') || stringBody(req, 'target_title'),
      threadId: stringBody(req, 'threadId') || stringBody(req, 'thread_id'),
      ttlSeconds: parseClaimTtl(stringBody(req, 'ttl')),
    }));
  }));

  app.get('/api/agent-claims/:claimId', asyncRoute((req, res) => {
    res.json(inspectAgentClaim(req.params.claimId, typeof req.query.project === 'string' ? req.query.project : undefined));
  }));

  app.post('/api/agent-claims/:claimId/heartbeat', asyncRoute((req, res) => {
    const claimToken = claimTokenFromRequest(req);
    if (!claimToken) throw new AgentClaimError('Heartbeat requires claimToken', 400, 'claim_token_required');
    res.json(heartbeatAgentClaim(claimToken, parseClaimTtl(stringBody(req, 'ttl'))));
  }));

  app.post('/api/agent-claims/:claimId/release', asyncRoute((req, res) => {
    const claimToken = claimTokenFromRequest(req);
    if (!claimToken) throw new AgentClaimError('Release requires claimToken', 400, 'claim_token_required');
    res.json(releaseAgentClaim(claimToken));
  }));

  app.post('/api/agent-claims/:claimId/release-stale', asyncRoute((req, res) => {
    res.json(releaseStaleAgentClaim(projectFrom({ body: req.body as Record<string, unknown>, query: req.query }), req.params.claimId, {
      actor: stringBody(req, 'actor') || 'human',
      confirmWrite: boolBody(req, 'confirmWrite'),
      reason: stringBody(req, 'reason'),
    }));
  }));

  app.post('/api/agent-claims/:claimId/revoke', asyncRoute((req, res) => {
    res.json(revokeAgentClaim(projectFrom({ body: req.body as Record<string, unknown>, query: req.query }), req.params.claimId, {
      actor: stringBody(req, 'actor') || 'human',
      confirmWrite: boolBody(req, 'confirmWrite'),
      reason: stringBody(req, 'reason'),
    }));
  }));

  app.post('/api/agent-claims/:claimId/transfer', asyncRoute((req, res) => {
    res.json(transferAgentClaim(projectFrom({ body: req.body as Record<string, unknown>, query: req.query }), req.params.claimId, {
      actor: stringBody(req, 'actor') || 'human',
      confirmWrite: boolBody(req, 'confirmWrite'),
      reason: stringBody(req, 'reason'),
      toAgentName: stringBody(req, 'toAgentName') || stringBody(req, 'to_agent_name') || '',
    }));
  }));
}
