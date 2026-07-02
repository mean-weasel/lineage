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
  attachAssetTemplate: 'npx lineage content post attach-asset',
  clearTargetCommand: 'npx lineage content target clear',
  inspectBatchCommand: 'npx lineage content batch inspect',
  inspectTargetCommand: 'npx lineage content target inspect',
  markPostedTemplate: 'npx lineage content post phase --phase posted',
  moveToReviewCommand: 'npx lineage content post phase --phase review',
  scheduleTemplate: 'npx lineage content post phase --phase scheduled',
  setTargetTemplate: 'npx lineage content target set',
};

const targetSnapshot = {
  fetchedAt: '2026-06-26T00:00:00.000Z',
  handoff,
  project: 'demo-project',
  selected: true,
  target: {
    batch: {
      created_at: '2026-06-26T00:00:00.000Z',
      id: 'batch-1',
      project: 'demo-project',
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
      project: 'demo-project',
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
    inspectQueueCommand: 'npx lineage content queue inspect',
    inspectTargetCommand: 'npx lineage content target inspect',
    listPostsCommand: 'npx lineage content post list',
  },
  lanes: [],
  next_action: null,
  next_action_lane: null,
  project: 'demo-project',
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

    expect(copied).toContain('npx lineage agent selected --project demo-project');
    expect(copied).toContain(
      'npx lineage agent work on the selected target for demo-project --project demo-project'
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

    expect(copied).toContain('npx lineage agent next --project demo-project');
  });
});
