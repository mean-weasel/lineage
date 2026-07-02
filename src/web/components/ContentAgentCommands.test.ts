import { describe, expect, it } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { ContentOpsQueueSnapshot, ContentTargetSnapshot } from '../../shared/types';
import { ContentOpsQueuePanel } from './ContentOpsQueuePanel';
import { ContentTargetPanel } from './ContentTargetPanel';

function collectButtons(node: ReactNode): ReactElement[] {
  if (!node || typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return [];
  if (Array.isArray(node)) return node.flatMap(collectButtons);
  const element = node as ReactElement<{ children?: ReactNode; type?: string }>;
  const children = collectButtons(element.props?.children);
  return element.type === 'button' ? [element, ...children] : children;
}

function buttonText(button: ReactElement): string {
  const children = button.props.children as ReactNode;
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(item => (typeof item === 'string' ? item : '')).join('');
  return '';
}

function clickButton(node: ReactNode, label: string): void {
  const button = collectButtons(node).find(item => buttonText(item).includes(label));
  expect(button, `Missing button ${label}`).toBeTruthy();
  button?.props.onClick?.();
}

const handoff = {
  agentPrompt: 'Review this selected target.',
  attachAssetTemplate: 'npm run studio:cli -- content post attach-asset',
  clearTargetCommand: 'npm run studio:cli -- content target clear',
  inspectBatchCommand: 'npm run studio:cli -- content batch inspect',
  inspectTargetCommand: 'npm run studio:cli -- content target inspect',
  markPostedTemplate: 'npm run studio:cli -- content post phase --phase posted',
  moveToReviewCommand: 'npm run studio:cli -- content post phase --phase review',
  scheduleTemplate: 'npm run studio:cli -- content post phase --phase scheduled',
  setTargetTemplate: 'npm run studio:cli -- content target set',
};

const targetSnapshot = {
  fetchedAt: '2026-06-26T00:00:00.000Z',
  handoff,
  project: 'bleep-that-shit',
  selected: true,
  target: {
    batch: {
      created_at: '2026-06-26T00:00:00.000Z',
      id: 'batch-1',
      project: 'bleep-that-shit',
      status: 'active',
      title: 'Batch',
      updated_at: '2026-06-26T00:00:00.000Z',
    },
    handoff,
    post: {
      assets: [],
      batch_id: 'batch-1',
      channel: 'tiktok',
      created_at: '2026-06-26T00:00:00.000Z',
      id: 'post-1',
      phase: 'draft',
      project: 'bleep-that-shit',
      title: 'Post',
      updated_at: '2026-06-26T00:00:00.000Z',
    },
    readiness: 'needs_asset',
    selected_at: '2026-06-26T00:00:00.000Z',
  },
} satisfies ContentTargetSnapshot;

const queueSnapshot = {
  fetchedAt: '2026-06-26T00:00:00.000Z',
  handoff: {
    inspectQueueCommand: 'npm run studio:cli -- content queue inspect',
    inspectTargetCommand: 'npm run studio:cli -- content target inspect',
    listPostsCommand: 'npm run studio:cli -- content post list',
  },
  lanes: [],
  next_action: null,
  next_action_lane: null,
  project: 'bleep-that-shit',
  target: null,
  totals: {
    attached_assets: 0,
    lanes: {
      draft_ready: 0,
      in_review: 0,
      needs_asset: 0,
      next_target: 0,
      posted: 0,
      scheduled: 0,
      skipped_or_archived: 0,
    },
    posts: 0,
    selected_target: 0,
    storage: { local: 0, s3: 0, total: 0, unresolved: 0 },
  },
} satisfies ContentOpsQueueSnapshot;

describe('content agent commands', () => {
  it('copies the selected target command and free-form prompt from the target panel', () => {
    const copied: string[] = [];
    const panel = ContentTargetPanel({
      onClear: async () => undefined,
      onCopy: async text => { copied.push(text); },
      pending: false,
      target: targetSnapshot,
    });

    clickButton(panel, 'Copy selected');
    clickButton(panel, 'Copy prompt');

    expect(copied).toContain('npm --silent run studio:cli -- agent selected --project bleep-that-shit');
    expect(copied).toContain(
      'npm --silent run studio:cli -- agent work on the selected target for bleep-that-shit --project bleep-that-shit'
    );
  });

  it('copies the next action command from the queue panel', () => {
    const copied: string[] = [];
    const panel = ContentOpsQueuePanel({
      onCopy: async text => { copied.push(text); },
      onFocusPost: async () => undefined,
      queue: queueSnapshot,
    });

    clickButton(panel, 'Copy agent next');

    expect(copied).toContain('npm --silent run studio:cli -- agent next --project bleep-that-shit');
  });
});
