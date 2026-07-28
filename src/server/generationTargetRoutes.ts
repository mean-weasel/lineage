import type express from 'express';
import type { GenerationTargetMap } from '../shared/outputTargetTypes';
import { outputTargetRegistry } from '../shared/outputTargetRegistry';
import { lineageDb } from './assetLineageDb';
import {
  readCanvasGenerationTargetDefaults,
  writeCanvasGenerationTargetDefaults,
  type CanvasDefaultsMutation,
} from './generationTargetDefaults';
import { cancelImageGeneration, planImageGeneration, planImageReroll } from './generationReceipts';
import {
  clearNodeNextOutputTargetSetting,
  NodeNextOutputTargetError,
  readNodeNextOutputTargetSetting,
  resolveEffectiveNodeNextOutputTargets,
  writeNodeNextOutputTargetSetting,
} from './nodeNextOutputTargets';

type ProjectFrom = (input: { body?: Record<string, unknown>; query?: Record<string, unknown> }) => string;
type AsyncRoute = (handler: (req: express.Request, res: express.Response) => Promise<void> | void) => express.RequestHandler;

function readCanvasTargetSettings(project: string, rootAssetId: string) {
  const database = lineageDb();
  try {
    return {
      ok: true as const,
      project,
      root_asset_id: rootAssetId,
      registry: structuredClone(outputTargetRegistry),
      defaults: readCanvasGenerationTargetDefaults(database, project, rootAssetId) ?? null,
      mutation_policy: {
        actor: 'human' as const,
        origin: 'canvas' as const,
        agent_access: 'read_only' as const,
      },
    };
  } finally {
    database.close();
  }
}

function saveCanvasTargetSettings(
  project: string,
  rootAssetId: string,
  mutation: Omit<CanvasDefaultsMutation, 'actor' | 'origin'>,
) {
  const database = lineageDb();
  try {
    return {
      ok: true as const,
      defaults: writeCanvasGenerationTargetDefaults(database, project, rootAssetId, {
        ...mutation,
        actor: 'human',
        origin: 'canvas',
      }),
    };
  } finally {
    database.close();
  }
}

function clearCanvasTargetSettings(project: string, rootAssetId: string) {
  const database = lineageDb();
  try {
    database.prepare('delete from generation_target_defaults where project_id = ? and root_asset_id = ?')
      .run(project, rootAssetId);
    return { ok: true as const, cleared: true as const, project, root_asset_id: rootAssetId };
  } finally {
    database.close();
  }
}

function requireHumanWrite(body: Record<string, unknown>): void {
  if (body.confirmWrite !== true) throw new Error('Canvas target settings require confirmWrite from an explicit human action');
}

function sendNodeTargetError(res: express.Response, error: unknown): boolean {
  if (!(error instanceof NodeNextOutputTargetError)) return false;
  res.status(error.status).json({ error: error.code, message: error.message });
  return true;
}

export function canvasDefaultsMutationFromBody(body: Record<string, unknown>): CanvasDefaultsMutation {
  requireHumanWrite(body);
  return {
    actor: 'human',
    origin: 'canvas',
    default_variant_count: body.default_variant_count === undefined ? undefined : Number(body.default_variant_count),
    targets: Array.isArray(body.targets) ? body.targets as CanvasDefaultsMutation['targets'] : [],
    separate_surface_ids: Array.isArray(body.separate_surface_ids) ? body.separate_surface_ids.map(String) : [],
  };
}

export function registerGenerationTargetRoutes(app: express.Express, projectFrom: ProjectFrom, asyncRoute: AsyncRoute): void {
  app.get('/api/generation/targets', asyncRoute((req, res) => {
    const rootAssetId = typeof req.query.rootAssetId === 'string' ? req.query.rootAssetId : '';
    if (!rootAssetId) throw new Error('Output target settings require rootAssetId');
    res.json(readCanvasTargetSettings(projectFrom(req), rootAssetId));
  }));

  app.put('/api/generation/targets/defaults', asyncRoute((req, res) => {
    requireHumanWrite(req.body);
    const rootAssetId = String(req.body.rootAssetId || '');
    if (!rootAssetId) throw new Error('Output target defaults require rootAssetId');
    const mutation = canvasDefaultsMutationFromBody(req.body);
    res.json(saveCanvasTargetSettings(projectFrom(req), rootAssetId, mutation));
  }));

  app.delete('/api/generation/targets/defaults', asyncRoute((req, res) => {
    requireHumanWrite(req.body);
    const rootAssetId = String(req.body.rootAssetId || '');
    if (!rootAssetId) throw new Error('Output target defaults require rootAssetId');
    res.json(clearCanvasTargetSettings(projectFrom(req), rootAssetId));
  }));

  app.get('/api/generation/targets/node', asyncRoute((req, res) => {
    const rootAssetId = typeof req.query.rootAssetId === 'string' ? req.query.rootAssetId : '';
    const nodeAssetId = typeof req.query.nodeAssetId === 'string' ? req.query.nodeAssetId : '';
    if (!rootAssetId || !nodeAssetId) throw new Error('Node output targets require rootAssetId and nodeAssetId');
    const project = projectFrom(req);
    const database = lineageDb();
    try {
      try {
        res.json({
          ok: true,
          project,
          root_asset_id: rootAssetId,
          node_asset_id: nodeAssetId,
          setting: readNodeNextOutputTargetSetting(database, project, rootAssetId, nodeAssetId) ?? null,
          effective: resolveEffectiveNodeNextOutputTargets(database, project, rootAssetId, nodeAssetId),
        });
      } catch (error) {
        if (!sendNodeTargetError(res, error)) throw error;
      }
    } finally {
      database.close();
    }
  }));

  app.put('/api/generation/targets/node', asyncRoute((req, res) => {
    requireHumanWrite(req.body);
    const rootAssetId = String(req.body.rootAssetId || '');
    const nodeAssetId = String(req.body.nodeAssetId || '');
    if (!rootAssetId || !nodeAssetId) throw new Error('Node output targets require rootAssetId and nodeAssetId');
    const expectedRevision = req.body.expectedRevision === null ? null : Number(req.body.expectedRevision);
    if (expectedRevision !== null && (!Number.isInteger(expectedRevision) || expectedRevision <= 0)) {
      throw new Error('Node output target replacement requires expectedRevision or null for first creation');
    }
    const project = projectFrom(req);
    const database = lineageDb();
    try {
      try {
        const setting = writeNodeNextOutputTargetSetting(database, {
          projectId: project,
          rootAssetId,
          nodeAssetId,
          expectedRevision,
          targets: Array.isArray(req.body.targets) ? req.body.targets : [],
          provenance: { actor: 'human', origin: 'canvas' },
        });
        res.json({
          ok: true,
          setting,
          effective: resolveEffectiveNodeNextOutputTargets(database, project, rootAssetId, nodeAssetId),
        });
      } catch (error) {
        if (!sendNodeTargetError(res, error)) throw error;
      }
    } finally {
      database.close();
    }
  }));

  app.delete('/api/generation/targets/node', asyncRoute((req, res) => {
    requireHumanWrite(req.body);
    const rootAssetId = String(req.body.rootAssetId || '');
    const nodeAssetId = String(req.body.nodeAssetId || '');
    const expectedRevision = Number(req.body.expectedRevision);
    if (!rootAssetId || !nodeAssetId || !Number.isInteger(expectedRevision) || expectedRevision <= 0) {
      throw new Error('Node output target clear requires rootAssetId, nodeAssetId, and expectedRevision');
    }
    const project = projectFrom(req);
    const database = lineageDb();
    try {
      try {
        clearNodeNextOutputTargetSetting(database, { projectId: project, rootAssetId, nodeAssetId, expectedRevision });
        res.json({
          ok: true,
          cleared: true,
          effective: resolveEffectiveNodeNextOutputTargets(database, project, rootAssetId, nodeAssetId),
        });
      } catch (error) {
        if (!sendNodeTargetError(res, error)) throw error;
      }
    } finally {
      database.close();
    }
  }));

  app.post('/api/generation/targets/plan', asyncRoute((req, res) => {
    const preview = req.body.preview === true;
    if (!preview) requireHumanWrite(req.body);
    res.json(planImageGeneration(projectFrom(req), {
      prompt: String(req.body.prompt || ''),
      fromLineageSelection: true,
      targetMap: req.body.targetMap as GenerationTargetMap,
      fromNodeTargets: req.body.fromNodeTargets === true,
      expectedTargetResolutionDigest: typeof req.body.expectedTargetResolutionDigest === 'string'
        ? req.body.expectedTargetResolutionDigest
        : undefined,
      variantsPerTarget: req.body.variantsPerTarget === undefined
        ? undefined
        : Number(req.body.variantsPerTarget),
      dryRun: preview,
    }));
  }));

  app.post('/api/generation/targets/reroll', asyncRoute((req, res) => {
    const preview = req.body.preview === true;
    if (!preview) requireHumanWrite(req.body);
    const requestedDimensions = req.body.requestedDimensions && typeof req.body.requestedDimensions === 'object'
      ? {
          width: Number(req.body.requestedDimensions.width),
          height: Number(req.body.requestedDimensions.height),
        }
      : undefined;
    res.json(planImageReroll(projectFrom(req), {
      rootAssetId: String(req.body.rootAssetId || ''),
      targetAssetId: String(req.body.targetAssetId || ''),
      prompt: String(req.body.prompt || ''),
      dryRun: preview,
      requestedDimensions,
    }));
  }));

  app.post('/api/generation/targets/cancel', asyncRoute((req, res) => {
    requireHumanWrite(req.body);
    res.json(cancelImageGeneration(projectFrom(req), {
      jobId: String(req.body.jobId || ''),
      confirmWrite: true,
    }));
  }));
}
