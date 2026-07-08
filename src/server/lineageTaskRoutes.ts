import type express from 'express';
import {
  addLineageTaskComment,
  cancelLineageTask,
  claimLineageTask,
  getLineageTask,
  listLineageTasks,
  overrideLineageTask,
  startLineageTask,
  updateLineageTaskInstructions,
} from './assetLineageTasks';

type ProjectFrom = (input: { body?: Record<string, unknown>; query?: Record<string, unknown> }) => string;
type AsyncRoute = (handler: (req: express.Request, res: express.Response) => Promise<void> | void) => express.RequestHandler;

function stringBody(req: express.Request, key: string): string | undefined {
  const value = (req.body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function boolBody(req: express.Request, key: string): boolean {
  return (req.body as Record<string, unknown>)[key] === true;
}

export function registerLineageTaskRoutes(app: express.Express, projectFrom: ProjectFrom, asyncRoute: AsyncRoute): void {
  app.get('/api/lineage/:rootAssetId/tasks', asyncRoute((req, res) => {
    res.json(listLineageTasks(projectFrom(req), req.params.rootAssetId));
  }));

  app.get('/api/lineage/tasks/:taskId', asyncRoute((req, res) => {
    res.json(getLineageTask(projectFrom(req), req.params.taskId));
  }));

  app.post('/api/lineage/tasks/:taskId/instructions', asyncRoute((req, res) => {
    res.json(updateLineageTaskInstructions(projectFrom(req), {
      instructions: stringBody(req, 'instructions') || '',
      taskId: req.params.taskId,
    }));
  }));

  app.post('/api/lineage/tasks/:taskId/comment', asyncRoute((req, res) => {
    res.json(addLineageTaskComment(projectFrom(req), {
      actor: stringBody(req, 'actor') || '',
      message: stringBody(req, 'message') || stringBody(req, 'comment') || '',
      taskId: req.params.taskId,
    }));
  }));

  app.post('/api/lineage/tasks/:taskId/claim', asyncRoute((req, res) => {
    res.json(claimLineageTask(projectFrom(req), {
      agentName: stringBody(req, 'agentName') || stringBody(req, 'agent_name') || '',
      taskId: req.params.taskId,
    }));
  }));

  app.post('/api/lineage/tasks/:taskId/start', asyncRoute((req, res) => {
    res.json(startLineageTask(projectFrom(req), {
      claimToken: stringBody(req, 'claimToken') || stringBody(req, 'claim_token') || '',
      taskId: req.params.taskId,
    }));
  }));

  app.post('/api/lineage/tasks/:taskId/cancel', asyncRoute((req, res) => {
    res.json(cancelLineageTask(projectFrom(req), {
      actor: stringBody(req, 'actor') || '',
      confirmWrite: boolBody(req, 'confirmWrite') || boolBody(req, 'confirm_write'),
      override: boolBody(req, 'override'),
      taskId: req.params.taskId,
    }));
  }));

  app.post('/api/lineage/tasks/:taskId/override', asyncRoute((req, res) => {
    res.json(overrideLineageTask(projectFrom(req), {
      actor: stringBody(req, 'actor') || '',
      instructions: stringBody(req, 'instructions'),
      reason: stringBody(req, 'reason') || '',
      taskId: req.params.taskId,
    }));
  }));
}
