import type express from 'express';
import {
  indexLineageAssets,
} from './assetLineage';
import {
  activateLineageWorkspace,
  archiveLineageWorkspace,
  createLineageWorkspace,
  inspectLineageWorkspace,
  listLineageWorkspaces,
  updateLineageWorkspace,
} from './assetLineageWorkspaces';
import { archiveDemoLineageWorkspace, demoSeedMediaStatus, restoreDemoSeedMedia, seedDemoLineageWorkspace } from './assetLineageDemo';

type ProjectFrom = (input: { body?: Record<string, unknown>; query?: Record<string, unknown> }) => string;
type AsyncRoute = (handler: (req: express.Request, res: express.Response) => Promise<void> | void) => express.RequestHandler;

export function registerLineageWorkspaceRoutes(app: express.Express, projectFrom: ProjectFrom, asyncRoute: AsyncRoute): void {
  app.get('/api/lineage-workspaces', asyncRoute((req, res) => {
    res.json(listLineageWorkspaces(projectFrom(req)));
  }));

  app.post('/api/lineage-workspaces', asyncRoute((req, res) => {
    const project = projectFrom(req);
    if (req.body.confirmWrite === true) indexLineageAssets(project);
    res.json(createLineageWorkspace(project, {
      rootAssetId: String(req.body.rootAssetId || ''),
      title: typeof req.body.title === 'string' ? req.body.title : undefined,
      status: req.body.status === 'paused' || req.body.status === 'archived' ? req.body.status : 'active',
      notes: typeof req.body.notes === 'string' ? req.body.notes : undefined,
      createdBy: req.body.createdBy === 'agent' || req.body.createdBy === 'system' ? req.body.createdBy : 'human',
      activate: req.body.activate !== false,
      confirmWrite: req.body.confirmWrite === true,
    }));
  }));

  app.post('/api/lineage-workspaces/demo/seed', asyncRoute((req, res) => {
    res.json(seedDemoLineageWorkspace(projectFrom(req), {
      activate: req.body.activate !== false,
      confirmWrite: req.body.confirmWrite === true,
    }));
  }));

  app.post('/api/lineage-workspaces/demo/archive', asyncRoute((req, res) => {
    res.json(archiveDemoLineageWorkspace(projectFrom(req), req.body.confirmWrite === true));
  }));

  app.get('/api/lineage-workspaces/demo/media', asyncRoute((_req, res) => {
    res.json({ ok: true, status: demoSeedMediaStatus() });
  }));

  app.post('/api/lineage-workspaces/demo/media/restore', asyncRoute((req, res) => {
    res.json({ ok: true, result: restoreDemoSeedMedia({ confirmWrite: req.body.confirmWrite === true }) });
  }));

  app.get('/api/lineage-workspaces/:workspaceId', asyncRoute((req, res) => {
    res.json({
      ok: true,
      project: projectFrom(req),
      workspace: inspectLineageWorkspace(projectFrom(req), req.params.workspaceId),
    });
  }));

  app.post('/api/lineage-workspaces/:workspaceId', asyncRoute((req, res) => {
    res.json(updateLineageWorkspace(projectFrom(req), req.params.workspaceId, {
      title: typeof req.body.title === 'string' ? req.body.title : undefined,
      status: req.body.status === 'active' || req.body.status === 'paused' || req.body.status === 'archived' ? req.body.status : undefined,
      notes: typeof req.body.notes === 'string' ? req.body.notes : undefined,
      activate: req.body.activate === true,
      confirmWrite: req.body.confirmWrite === true,
    }));
  }));

  app.post('/api/lineage-workspaces/:workspaceId/activate', asyncRoute((req, res) => {
    res.json(activateLineageWorkspace(projectFrom(req), req.params.workspaceId, req.body.confirmWrite === true));
  }));

  app.post('/api/lineage-workspaces/:workspaceId/archive', asyncRoute((req, res) => {
    res.json(archiveLineageWorkspace(projectFrom(req), req.params.workspaceId, req.body.confirmWrite === true));
  }));
}
