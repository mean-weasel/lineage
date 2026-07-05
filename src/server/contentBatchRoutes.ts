import { Router, type Request } from 'express';
import {
  attachContentPostAsset,
  createContentBatch,
  createContentPost,
  detachContentPostAsset,
  getContentBatch,
  listContentBatches,
  listContentPosts,
  updateContentPost,
} from './contentBatches';
import { importDemoContentBatch } from './contentBatchImport';
import { getContentOpsQueue } from './contentOpsQueue';
import { clearContentTarget, getContentTarget, setContentTarget } from './contentTargets';
import type { ContentPostPhase } from '../shared/types';

type ProjectResolver = (input: { body?: Record<string, unknown>; query?: Record<string, unknown> }) => string;

function stringBody(req: Request, key: string): string | undefined {
  const value = (req.body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function boolBody(req: Request, key: string): boolean {
  return (req.body as Record<string, unknown>)[key] === true;
}

function claimTokenFromRequest(req: Request): string | undefined {
  const header = req.header('X-Lineage-Claim-Token');
  if (header) return header;
  const value = (req.body as Record<string, unknown>).claimToken;
  return typeof value === 'string' ? value : undefined;
}

function bodyProjectShape(req: Request): { body?: Record<string, unknown>; query?: Record<string, unknown> } {
  return { body: req.body as Record<string, unknown>, query: req.query };
}

export function contentBatchRouter(projectFrom: ProjectResolver): Router {
  const router = Router();

  router.get('/batches', (req, res) => {
    res.json(listContentBatches(projectFrom(req)));
  });

  router.post('/batches', (req, res) => {
    res.json(createContentBatch(projectFrom(bodyProjectShape(req)), {
      batchId: stringBody(req, 'batchId') || stringBody(req, 'id') || '',
      campaign: stringBody(req, 'campaign'),
      channel: stringBody(req, 'channel'),
      confirmWrite: boolBody(req, 'confirmWrite'),
      notes: stringBody(req, 'notes'),
      title: stringBody(req, 'title') || '',
    }));
  });

  router.post('/import/demo', (req, res) => {
    const kind = stringBody(req, 'kind');
    res.json(importDemoContentBatch(projectFrom(bodyProjectShape(req)), {
      batchId: stringBody(req, 'batchId') || '',
      campaign: stringBody(req, 'campaign'),
      confirmWrite: boolBody(req, 'confirmWrite'),
      kind: kind === 'concepts' || kind === 'drafts' || kind === 'all' ? kind : 'all',
      title: stringBody(req, 'title'),
    }));
  });

  router.get('/target', (req, res) => {
    res.json(getContentTarget(projectFrom(req)));
  });

  router.get('/queue', (req, res) => {
    res.json(getContentOpsQueue(projectFrom(req)));
  });

  router.post('/target', (req, res) => {
    res.json(setContentTarget(projectFrom(bodyProjectShape(req)), {
      confirmWrite: boolBody(req, 'confirmWrite'),
      notes: stringBody(req, 'notes'),
      postId: stringBody(req, 'postId') || '',
    }));
  });

  router.post('/target/clear', (req, res) => {
    res.json(clearContentTarget(projectFrom(bodyProjectShape(req)), boolBody(req, 'confirmWrite')));
  });

  router.get('/batches/:batchId', (req, res) => {
    res.json(getContentBatch(projectFrom(req), req.params.batchId));
  });

  router.get('/posts', (req, res) => {
    res.json(listContentPosts(projectFrom(req), {
      batchId: typeof req.query.batchId === 'string' ? req.query.batchId : undefined,
      channel: typeof req.query.channel === 'string' ? req.query.channel : undefined,
      phase: typeof req.query.phase === 'string' ? req.query.phase : undefined,
    }));
  });

  router.post('/posts', (req, res) => {
    res.json(createContentPost(projectFrom(bodyProjectShape(req)), {
      batchId: stringBody(req, 'batchId') || '',
      body: stringBody(req, 'body'),
      campaign: stringBody(req, 'campaign'),
      channel: stringBody(req, 'channel') || '',
      confirmWrite: boolBody(req, 'confirmWrite'),
      cta: stringBody(req, 'cta'),
      notes: stringBody(req, 'notes'),
      phase: stringBody(req, 'phase') as ContentPostPhase | undefined,
      postId: stringBody(req, 'postId') || stringBody(req, 'id') || '',
      sourcePath: stringBody(req, 'sourcePath'),
      title: stringBody(req, 'title') || '',
    }));
  });

  router.post('/posts/:postId', (req, res) => {
    res.json(updateContentPost(projectFrom(bodyProjectShape(req)), {
      batchId: stringBody(req, 'batchId'),
      body: stringBody(req, 'body'),
      campaign: stringBody(req, 'campaign'),
      channel: stringBody(req, 'channel'),
      confirmWrite: boolBody(req, 'confirmWrite'),
      claimToken: claimTokenFromRequest(req),
      cta: stringBody(req, 'cta'),
      notes: stringBody(req, 'notes'),
      phase: stringBody(req, 'phase') as ContentPostPhase | undefined,
      postedAt: stringBody(req, 'postedAt'),
      postId: req.params.postId,
      scheduledAt: stringBody(req, 'scheduledAt'),
      sourcePath: stringBody(req, 'sourcePath'),
      title: stringBody(req, 'title'),
      url: stringBody(req, 'url'),
    }));
  });

  router.post('/posts/:postId/assets', (req, res) => {
    res.json(attachContentPostAsset(projectFrom(bodyProjectShape(req)), {
      assetId: stringBody(req, 'assetId') || '',
      confirmWrite: boolBody(req, 'confirmWrite'),
      claimToken: claimTokenFromRequest(req),
      notes: stringBody(req, 'notes'),
      postId: req.params.postId,
      role: stringBody(req, 'role'),
    }));
  });

  router.post('/posts/:postId/assets/detach', (req, res) => {
    res.json(detachContentPostAsset(projectFrom(bodyProjectShape(req)), {
      assetId: stringBody(req, 'assetId') || '',
      confirmWrite: boolBody(req, 'confirmWrite'),
      claimToken: claimTokenFromRequest(req),
      postId: req.params.postId,
      role: stringBody(req, 'role'),
    }));
  });

  return router;
}
