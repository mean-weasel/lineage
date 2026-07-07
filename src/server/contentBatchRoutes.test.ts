import express, { type Express } from 'express';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAgentClaim, isAgentClaimError } from './agentClaims';
import { defaultProject, repoRoot } from './assetCore';
import { contentBatchRouter } from './contentBatchRoutes';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-content-routes');
const dbFile = join(scratchDir, 'content-routes.sqlite');
let server: ReturnType<Express['listen']> | null = null;

function projectFrom(input: { body?: Record<string, unknown>; query?: Record<string, unknown> }): string {
  const candidate = input.body?.project || input.query?.project;
  return typeof candidate === 'string' ? candidate : defaultProject;
}

function appWithContentRoutes() {
  const app = express();
  app.use(express.json());
  app.use('/api/content', contentBatchRouter(projectFrom));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (isAgentClaimError(error)) {
      res.status(error.status).json({ conflicts: error.conflicts, error: error.code, message: error.message });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  });
  server = app.listen(0);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function requestJson<T>(baseUrl: string, path: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, body ? {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  } : undefined);
  return response.json() as Promise<T>;
}

async function postJson(baseUrl: string, path: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
    method: 'POST',
  });
  return { body: await response.json() as Record<string, unknown>, status: response.status };
}

describe('content batch routes', () => {
  beforeEach(() => {
    rmSync(scratchDir, { force: true, recursive: true });
    process.env.LINEAGE_DB = dbFile;
    process.env.LINEAGE_CONTENT_SOURCE_ROOT = join(scratchDir, 'missing-content-source');
  });

  afterEach(() => {
    server?.close();
    server = null;
  });

  it('imports demo markdown batches through the HTTP contract', async () => {
    const baseUrl = appWithContentRoutes();
    const preview = await requestJson<{ dryRun: boolean; counts: { drafts: number } }>(baseUrl, '/api/content/import/demo', {
      batchId: 'route-preview',
      confirmWrite: false,
      kind: 'drafts',
      project: defaultProject,
    });
    const imported = await requestJson<{ batch_id: string; counts: { drafts: number } }>(baseUrl, '/api/content/import/demo', {
      batchId: 'route-import',
      confirmWrite: true,
      kind: 'drafts',
      project: defaultProject,
      title: 'Route import',
    });
    const detail = await requestJson<{ posts: Array<{ body?: string; channel: string; source_path?: string }> }>(
      baseUrl,
      `/api/content/batches/route-import?project=${defaultProject}`
    );

    expect(preview.dryRun).toBe(true);
    expect(existsSync(dbFile)).toBe(true);
    expect(imported).toMatchObject({ batch_id: 'route-import' });
    expect(imported.counts.drafts).toBe(0);
    expect(detail.posts).toEqual([]);
  });

  it('sets, inspects, and clears selected content target through HTTP routes', async () => {
    const baseUrl = appWithContentRoutes();
    await requestJson(baseUrl, '/api/content/batches', {
      batchId: 'route-target',
      channel: 'tiktok',
      confirmWrite: true,
      project: defaultProject,
      title: 'Route target batch',
    });
    await requestJson(baseUrl, '/api/content/posts', {
      batchId: 'route-target',
      body: 'Demo route post body',
      channel: 'tiktok',
      confirmWrite: true,
      phase: 'draft',
      postId: 'draft-demo-route-target',
      project: defaultProject,
      title: 'Demo route target',
    });
    const empty = await requestJson<{ selected: boolean; target: null }>(baseUrl, `/api/content/target?project=${defaultProject}`);
    const selected = await requestJson<{ selected: boolean; target: { post: { id: string }; readiness: string } }>(baseUrl, '/api/content/target', {
      confirmWrite: true,
      notes: 'Next asset variation base',
      postId: 'draft-demo-route-target',
      project: defaultProject,
    });
    const cleared = await requestJson<{ selected: boolean; target: null }>(baseUrl, '/api/content/target/clear', {
      confirmWrite: true,
      project: defaultProject,
    });

    expect(empty).toMatchObject({ selected: false, target: null });
    expect(selected).toMatchObject({ selected: true, target: { post: { id: 'draft-demo-route-target' }, readiness: 'needs_asset' } });
    expect(cleared).toMatchObject({ selected: false, target: null });
  });

  it('enforces content post claims through body and header tokens on mutating routes', async () => {
    const baseUrl = appWithContentRoutes();
    await requestJson(baseUrl, '/api/content/batches', {
      batchId: 'route-claim',
      channel: 'tiktok',
      confirmWrite: true,
      project: defaultProject,
      title: 'Route claim batch',
    });
    await requestJson(baseUrl, '/api/content/posts', {
      batchId: 'route-claim',
      body: 'Claimed route post body',
      channel: 'tiktok',
      confirmWrite: true,
      phase: 'draft',
      postId: 'claimed-route-post',
      project: defaultProject,
      title: 'Claimed route post',
    });
    const claim = createAgentClaim({
      agentName: 'route claim test agent',
      channel: 'tiktok',
      project: defaultProject,
      scopeType: 'content_post',
      targetId: 'claimed-route-post',
      targetTitle: 'Claimed route post',
    });

    const denied = await postJson(baseUrl, '/api/content/posts/claimed-route-post/assets', {
      assetId: 'asset-1',
      confirmWrite: true,
      project: defaultProject,
    });
    const attached = await postJson(baseUrl, '/api/content/posts/claimed-route-post/assets', {
      assetId: 'asset-1',
      claimToken: claim.claim_token,
      confirmWrite: true,
      project: defaultProject,
    });
    const phased = await postJson(baseUrl, '/api/content/posts/claimed-route-post', {
      confirmWrite: true,
      phase: 'review',
      project: defaultProject,
    }, { 'X-Lineage-Claim-Token': claim.claim_token });

    expect(denied).toMatchObject({ status: 401, body: { error: 'claim_required' } });
    expect(attached).toMatchObject({ status: 200, body: { ok: true, post: { id: 'claimed-route-post' } } });
    expect(phased).toMatchObject({ status: 200, body: { ok: true, post: { phase: 'review' } } });
  });
});
