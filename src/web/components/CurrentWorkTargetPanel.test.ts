import { describe, expect, it } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { AssetSelectionSnapshot, ContentOpsQueueSnapshot, ContentTargetSnapshot, GrowthAsset } from '../../shared/types';
import { CurrentWorkTargetPanel } from './CurrentWorkTargetPanel';

function flattenText(node: ReactNode): string {
  if (!node || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join('');
  const element = node as ReactElement<{ children?: ReactNode }>;
  return flattenText(element.props?.children);
}

function collectButtons(node: ReactNode): ReactElement[] {
  if (!node || typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return [];
  if (Array.isArray(node)) return node.flatMap(collectButtons);
  const element = node as ReactElement<{ children?: ReactNode; type?: string }>;
  const children = collectButtons(element.props?.children);
  return element.type === 'button' ? [element, ...children] : children;
}

function clickButton(node: ReactNode, label: string): void {
  const button = collectButtons(node).find(item => flattenText(item).includes(label));
  expect(button, `Missing button ${label}`).toBeTruthy();
  button?.props.onClick?.();
}

const handoff = {
  agentPrompt: 'Continue the selected target.',
  attachAssetTemplate: 'attach',
  clearTargetCommand: 'clear',
  inspectBatchCommand: 'inspect batch',
  inspectTargetCommand: 'inspect target',
  markPostedTemplate: 'posted',
  moveToReviewCommand: 'review',
  scheduleTemplate: 'schedule',
  setTargetTemplate: 'set target',
};

const target = {
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
      id: 'selected-post',
      phase: 'draft',
      project: 'demo-project',
      title: 'Selected post',
      updated_at: '2026-06-26T00:00:00.000Z',
    },
    readiness: 'draft_ready',
    selected_at: '2026-06-26T00:00:00.000Z',
  },
} satisfies ContentTargetSnapshot;

const queue = {
  fetchedAt: '2026-06-26T00:00:00.000Z',
  handoff: {
    inspectQueueCommand: 'inspect queue',
    inspectTargetCommand: 'inspect target',
    listPostsCommand: 'list posts',
  },
  lanes: [],
  next_action: {
    asset_storage: { local: 1, s3: 0, total: 1, unresolved: 0 },
    attached_asset_count: 1,
    handoff,
    is_target: false,
    post: {
      assets: [],
      batch_id: 'batch-1',
      channel: 'linkedin',
      created_at: '2026-06-26T00:00:00.000Z',
      id: 'queue-post',
      phase: 'draft',
      project: 'demo-project',
      title: 'Queue post',
      updated_at: '2026-06-26T00:00:00.000Z',
    },
    readiness: 'needs_asset',
  },
  next_action_lane: { id: 'needs_asset', label: 'Needs Assets', total: 1 },
  project: 'demo-project',
  target: target.target,
  totals: {
    attached_assets: 1,
    lanes: {
      draft_ready: 0,
      in_review: 0,
      needs_asset: 1,
      next_target: 1,
      posted: 0,
      scheduled: 0,
      skipped_or_archived: 0,
    },
    posts: 2,
    selected_target: 1,
    storage: { local: 1, s3: 0, total: 1, unresolved: 0 },
  },
} satisfies ContentOpsQueueSnapshot;

const selectedAsset = {
  asset_id: 'asset-1',
  audience: 'creators',
  campaign: 'campaign',
  channel: 'meta',
  content_type: 'image',
  cta: 'Try it',
  hook: 'Hook',
  local: {
    absolute_path: '/tmp/asset.png',
    checksum_sha256: 'abc123',
    content_type: 'image/png',
    relative_path: 'asset.png',
    size_bytes: 123,
    updated_at: '2026-06-26T00:00:00.000Z',
  },
  product: 'demo-project',
  project: 'demo-project',
  source: 'local',
  status: 'working',
  title: 'Selected asset',
  utm_content: 'asset_1',
} satisfies GrowthAsset;

const selection = {
  active_review_set: null,
  current: {
    created_at: '2026-06-26T00:00:00.000Z',
    created_by: 'system',
    id: 'demo-project:current:current',
    items: [{
      asset_id: 'asset-1',
      created_at: '2026-06-26T00:00:00.000Z',
      id: 'item-1',
      position: 0,
      role: 'primary',
      selected_at: '2026-06-26T00:00:00.000Z',
      selected_by: 'human',
      set_id: 'demo-project:current:current',
      updated_at: '2026-06-26T00:00:00.000Z',
      variation_label: 'B',
    }, {
      asset_id: 'asset-2',
      created_at: '2026-06-26T00:00:00.000Z',
      id: 'item-2',
      position: 1,
      role: 'primary',
      selected_at: '2026-06-26T00:00:00.000Z',
      selected_by: 'human',
      set_id: 'demo-project:current:current',
      updated_at: '2026-06-26T00:00:00.000Z',
      variation_label: 'D',
    }],
    key: 'current',
    kind: 'current',
    label: 'Current selections',
    project: 'demo-project',
    status: 'active',
    updated_at: '2026-06-26T00:00:00.000Z',
  },
  fetchedAt: '2026-06-26T00:00:00.000Z',
  project: 'demo-project',
  review_sets: [],
} satisfies AssetSelectionSnapshot;

describe('CurrentWorkTargetPanel', () => {
  it('renders distinct content target, queue, and asset context slots', () => {
    const panel = CurrentWorkTargetPanel({
      loading: false,
      onCopy: async () => undefined,
      onRefresh: () => undefined,
      project: 'demo-project',
      queue,
      selectedAsset,
      target,
      view: 'content',
    });
    const text = flattenText(panel);

    expect(text).toContain('Content selected target');
    expect(text).toContain('Selected post');
    expect(text).toContain('Content queue next');
    expect(text).toContain('Queue post');
    expect(text).toContain('Selected asset');
    expect(text).toContain('UI context, not an agent target');
    expect(text).toContain('Asset selections');
  });

  it('copies only the existing content CLI commands and raw asset id', () => {
    const copied: string[] = [];
    const panel = CurrentWorkTargetPanel({
      loading: false,
      onCopy: async text => { copied.push(text); },
      onRefresh: () => undefined,
      project: 'demo-project',
      queue,
      selectedAsset,
      target,
      view: 'content',
    });

    clickButton(panel, 'Copy selected');
    clickButton(panel, 'Copy prompt');
    clickButton(panel, 'Copy next');
    clickButton(panel, 'Copy asset ID');

    expect(copied).toContain('npx lineage agent selected --project demo-project');
    expect(copied).toContain(
      'npx lineage agent work on the selected target for demo-project --project demo-project'
    );
    expect(copied).toContain('npx lineage agent next --project demo-project');
    expect(copied).toContain('asset-1');
  });

  it('renders current asset selections from the SQLite ledger handoff state', () => {
    const copied: string[] = [];
    const panel = CurrentWorkTargetPanel({
      loading: false,
      onCopy: async text => { copied.push(text); },
      onRefresh: () => undefined,
      project: 'demo-project',
      queue,
      selectedAsset,
      selection,
      target,
      view: 'content',
    });
    const text = flattenText(panel);

    expect(text).toContain('2 selected assets');
    expect(text).toContain('B:asset-1');
    expect(text).toContain('D:asset-2');
    clickButton(panel, 'Copy selections');
    expect(copied).toContain('npx lineage agent selections --project demo-project');
  });

  it('marks lineage context so only selected asset context is visible in that drawer mode', () => {
    const panel = CurrentWorkTargetPanel({
      drawerOpen: true,
      loading: false,
      onCopy: async () => undefined,
      onRefresh: () => undefined,
      project: 'demo-project',
      queue,
      selectedAsset,
      selection,
      target,
      view: 'lineage',
    });

    expect(panel.props.className).toContain('lineage-context');
  });
});
