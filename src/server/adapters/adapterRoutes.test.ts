import express, { type Express } from 'express';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useLineageTestProfile } from '../../test/lineageTestProfile';
import { defaultProject, repoRoot } from '../assetCore';
import { createContentBatch, createContentPost } from '../contentBatches';
import { registerAdapterRoutes } from './adapterRoutes';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-adapter-routes');
const dbFile = join(scratchDir, 'adapter-routes.sqlite');
let server: ReturnType<Express['listen']> | null = null;

function resetDb() {
  rmSync(scratchDir, { force: true, recursive: true });
  useLineageTestProfile(dbFile);
}

function appWithRoutes() {
  const app = express();
  app.use(express.json());
  registerAdapterRoutes(app, input => {
    const candidate = input.body?.project || input.query?.project;
    return typeof candidate === 'string' ? candidate : defaultProject;
  }, handler => (req, res, next) => { Promise.resolve(handler(req, res)).catch(next); });
  server = app.listen(0);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function seedPost() {
  createContentBatch(defaultProject, {
    batchId: 'adapter-routes',
    channel: 'linkedin',
    confirmWrite: true,
    title: 'Adapter routes',
  });
  createContentPost(defaultProject, {
    batchId: 'adapter-routes',
    body: 'Route-level Buffer dry-run proof.',
    channel: 'linkedin',
    confirmWrite: true,
    cta: 'Inspect payload',
    postId: 'adapter-route-post',
    title: 'Adapter route post',
  });
}

describe('adapter routes', () => {
  beforeEach(resetDb);

  afterEach(() => {
    server?.close();
    server = null;
  });

  it('serves adapter status over HTTP', async () => {
    const baseUrl = appWithRoutes();
    const response = await fetch(`${baseUrl}/api/adapters/status?project=${defaultProject}`);
    const body = await response.json();

    expect(response.ok).toBe(true);
    expect(body).toMatchObject({
      ok: true,
      posting: [{ can_dry_run: true, can_post: false, provider: 'buffer' }],
      storage: [{ provider: 'local' }],
    });
  });

  it('serves and updates adapter settings without echoing env secrets', async () => {
    process.env.LINEAGE_SCHEDULER_TOKEN = 'route-buffer-secret';
    process.env.LINEAGE_SCHEDULER_ORGANIZATION_ID = 'route-buffer-org';
    const baseUrl = appWithRoutes();
    const before = await fetch(`${baseUrl}/api/adapters/settings?project=${defaultProject}`);
    const updated = await fetch(`${baseUrl}/api/adapters/settings/scheduler/buffer`, {
      body: JSON.stringify({ confirmWrite: true, enabled: true, project: defaultProject, safeConfig: { defaultMode: 'dry-run' } }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const after = await fetch(`${baseUrl}/api/adapters/settings?project=${defaultProject}`);
    const beforeBody = await before.json();
    const updatedBody = await updated.json();
    const afterBody = await after.json();

    expect(before.ok).toBe(true);
    expect(updated.ok).toBe(true);
    expect(after.ok).toBe(true);
    expect(updatedBody.setting).toMatchObject({ adapter_type: 'scheduler', enabled: true, provider: 'buffer' });
    expect(afterBody.settings.find((setting: { provider: string }) => setting.provider === 'buffer')).toMatchObject({
      enabled: true,
      safe_config: { defaultMode: 'dry-run' },
    });
    expect(JSON.stringify({ beforeBody, updatedBody, afterBody })).not.toContain('route-buffer-secret');
    expect(JSON.stringify({ beforeBody, updatedBody, afterBody })).not.toContain('route-buffer-org');
    delete process.env.LINEAGE_SCHEDULER_TOKEN;
    delete process.env.LINEAGE_SCHEDULER_ORGANIZATION_ID;
  });

  it('serves Buffer dry-run payloads over HTTP without live posting', async () => {
    seedPost();
    const baseUrl = appWithRoutes();
    const response = await fetch(`${baseUrl}/api/adapters/posting/buffer/dry-run`, {
      body: JSON.stringify({
        bufferChannelId: 'buffer-linkedin-page',
        postId: 'adapter-route-post',
        project: defaultProject,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const body = await response.json();

    expect(response.ok).toBe(true);
    expect(body).toMatchObject({
      can_post: false,
      mode: 'dry-run-only',
      payload: {
        channelId: 'buffer-linkedin-page',
        mode: 'addToQueue',
        text: 'Route-level Buffer dry-run proof.\n\nInspect payload',
      },
      post: { id: 'adapter-route-post' },
      provider: 'buffer',
    });
  });
});
