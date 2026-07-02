import type express from 'express';
import type { AdapterProvider, AdapterType } from '../../shared/adapterSettingsTypes';
import { getAdapterSettings, updateAdapterSetting } from './adapterSettings';
import { getAdapterStatus } from './adapterStatus';
import { dryRunBufferContentPost } from './posting/bufferPostingService';

type ProjectFrom = (input: { body?: Record<string, unknown>; query?: Record<string, unknown> }) => string;
type AsyncRoute = (handler: (req: express.Request, res: express.Response) => Promise<void> | void) => express.RequestHandler;

export function registerAdapterRoutes(app: express.Express, projectFrom: ProjectFrom, asyncRoute: AsyncRoute): void {
  app.get('/api/adapters/status', asyncRoute((req, res) => {
    res.json({ ok: true, ...getAdapterStatus(projectFrom(req)) });
  }));

  app.get('/api/adapters/settings', asyncRoute((req, res) => {
    res.json({ ok: true, ...getAdapterSettings(projectFrom(req)) });
  }));

  app.post('/api/adapters/settings/:adapterType/:provider', asyncRoute((req, res) => {
    res.json({
      ok: true,
      setting: updateAdapterSetting(projectFrom(req), {
        adapterType: req.params.adapterType as AdapterType,
        confirmWrite: req.body.confirmWrite === true,
        enabled: req.body.enabled === true,
        provider: req.params.provider as AdapterProvider,
        safeConfig: req.body.safeConfig && typeof req.body.safeConfig === 'object' ? req.body.safeConfig as Record<string, unknown> : undefined,
      }),
    });
  }));

  app.post('/api/adapters/posting/buffer/dry-run', asyncRoute((req, res) => {
    res.json(dryRunBufferContentPost(projectFrom(req), {
      bufferChannelId: String(req.body.bufferChannelId || req.body.bufferChannelID || req.body.buffer_channel_id || ''),
      execute: req.body.execute === true,
      postId: typeof req.body.postId === 'string' ? req.body.postId : undefined,
      target: req.body.target === 'selected' ? 'selected' : undefined,
    }));
  }));
}
