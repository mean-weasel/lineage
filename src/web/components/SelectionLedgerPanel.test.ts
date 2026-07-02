import { describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { AssetSelectionSnapshot, GrowthAsset } from '../../shared/types';
import { SelectionLedgerPanel } from './SelectionLedgerPanel';

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
  const button = collectButtons(node).find(item => flattenText(item).includes(label) && !item.props.disabled);
  expect(button, `Missing button ${label}`).toBeTruthy();
  button?.props.onClick?.();
}

function asset(fields: Partial<GrowthAsset>): GrowthAsset {
  return {
    asset_id: 'asset-a',
    audience: 'creators',
    campaign: 'campaign',
    channel: 'meta',
    content_type: 'image',
    cta: 'Try it',
    hook: 'Hook',
    product: 'demo-project',
    project: 'demo-project',
    source: 'catalog',
    status: 'working',
    title: 'Asset A',
    utm_content: 'asset_a',
    ...fields,
  };
}

const assets = [
  asset({
    asset_id: 'asset-a',
    s3: {
      bucket: 'bucket',
      key: 'asset-a.png',
      region: 'us-east-1',
      version_id: 'v1',
    },
    title: 'Variation A',
  }),
  asset({
    asset_id: 'asset-b',
    local: {
      absolute_path: '/tmp/asset-b.png',
      checksum_sha256: 'hash-b',
      content_type: 'image/png',
      relative_path: 'asset-b.png',
      size_bytes: 100,
      updated_at: '2026-06-26T00:00:00.000Z',
    },
    title: 'Variation B',
  }),
  asset({
    asset_id: 'asset-d',
    s3: {
      bucket: 'bucket',
      key: 'asset-d.png',
      region: 'us-east-1',
      version_id: 'v2',
    },
    title: 'Variation D',
  }),
];
const candidateAssets = [asset({ asset_id: 'asset-c', title: 'Variation C from lookup' })];

const selection = {
  active_review_set: {
    created_at: '2026-06-26T00:00:00.000Z',
    created_by: 'agent',
    id: 'demo-project:review:review-ux-demo',
    items: [
      reviewItem('A', 'asset-a', 0),
      reviewItem('B', 'asset-b', 1, true),
      reviewItem('C', 'asset-c', 2),
      reviewItem('D', 'asset-d', 3, true),
    ],
    key: 'review-ux-demo',
    kind: 'review',
    label: 'Review UX demo',
    project: 'demo-project',
    status: 'active',
    updated_at: '2026-06-26T00:00:00.000Z',
  },
  current: {
    created_at: '2026-06-26T00:00:00.000Z',
    created_by: 'system',
    id: 'demo-project:current:current',
    items: [
      reviewItem('B', 'asset-b', 0, true, 'primary'),
      reviewItem('D', 'asset-d', 1, true, 'primary'),
    ],
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

const archivedReviewSet = {
  ...selection.active_review_set,
  id: 'demo-project:review:older-review',
  key: 'older-review',
  label: 'Older review',
  status: 'archived' as const,
};
const selectionWithHistory = {
  ...selection,
  review_sets: [selection.active_review_set, archivedReviewSet],
} satisfies AssetSelectionSnapshot;

function reviewItem(label: string, assetId: string, position: number, selected = false, role: 'candidate' | 'primary' = 'candidate') {
  return {
    asset_id: assetId,
    created_at: '2026-06-26T00:00:00.000Z',
    id: `${role}-${label}`,
    position,
    role,
    selected_at: selected ? '2026-06-26T00:00:00.000Z' : undefined,
    selected_by: selected ? 'human' as const : undefined,
    set_id: `set-${role}`,
    updated_at: '2026-06-26T00:00:00.000Z',
    variation_label: label,
  };
}

describe('SelectionLedgerPanel', () => {
  it('renders active review set candidates and selected labels', () => {
    const panel = SelectionLedgerPanel({
      assets,
      candidateAssets,
      error: null,
      loading: false,
      onClear: () => undefined,
      onChooseReviewLabels: async () => undefined,
      onRefresh: () => undefined,
      onToggleReviewLabel: () => undefined,
      pending: false,
      project: 'demo-project',
      reviewDraftLabels: ['B', 'D'],
      selection: selectionWithHistory,
    });
    const text = flattenText(panel);

    expect(text).toContain('Active review set');
    expect(text).toContain('Review UX demo');
    expect(text).toContain('4 candidates');
    expect(text).toContain('A');
    expect(text).toContain('Variation A');
    expect(text).toContain('B');
    expect(text).toContain('Variation B');
    expect(text).toContain('C');
    expect(text).toContain('Variation C from lookup');
    expect(text).toContain('catalog only');
    expect(text).toContain('D');
    expect(text).toContain('2 labels chosen');
    expect(text).toContain('Recent review sets');
    expect(text).toContain('Older review');
    expect(text).toContain('archived');
    expect(text).toContain('Review set handoff');
    expect(text).toContain('next work context');
    expect(text).toContain('Agent work packet');
    expect(text).toContain('4 candidates · 2 selected · SQLite-backed');
    expect(text).toContain('Continue from next context');
    expect(text).toContain('selections review-set packet');
    expect(text).toContain('selections review-set inspect');
    expect(text).toContain('selections review-set set-next');
    expect(text).toContain('keep working on my selections');
    expect(text).toContain('S3 backed');
    expect(text).toContain('local only');
  });

  it('lets the caller toggle labels and choose the draft set', () => {
    const toggled: string[] = [];
    const chosen: string[][] = [];
    const archived: string[] = [];
    const activated: string[] = [];
    const inspected: string[] = [];
    const panel = SelectionLedgerPanel({
      assets,
      candidateAssets,
      error: null,
      loading: false,
      onActivateReviewSet: async setId => { activated.push(setId); },
      onArchiveReviewSet: async setId => { archived.push(setId); },
      onClear: () => undefined,
      onChooseReviewLabels: async labels => { chosen.push(labels); },
      onInspectReviewSet: setId => { inspected.push(setId); },
      onRefresh: () => undefined,
      onToggleReviewLabel: label => { toggled.push(label); },
      pending: false,
      project: 'demo-project',
      reviewDraftLabels: ['B', 'D'],
      selection: selectionWithHistory,
    });

    clickButton(panel, 'Variation A');
    clickButton(panel, 'Select labels');
    clickButton(panel, 'Inspect');
    clickButton(panel, 'Archive');
    clickButton(panel, 'Set next');

    expect(toggled).toEqual(['A']);
    expect(chosen).toEqual([['B', 'D']]);
    expect(inspected).toEqual(['demo-project:review:review-ux-demo']);
    expect(archived).toEqual(['demo-project:review:review-ux-demo']);
    expect(activated).toEqual(['demo-project:review:older-review']);
  });

  it('calls the next-context continuation handler from the work packet action', () => {
    const onContinueFromNextContext = vi.fn();
    const panel = SelectionLedgerPanel({
      assets,
      candidateAssets,
      error: null,
      loading: false,
      onClear: () => undefined,
      onContinueFromNextContext,
      onRefresh: () => undefined,
      pending: false,
      project: 'demo-project',
      selection: selectionWithHistory,
    });

    clickButton(panel, 'Continue from next context');

    expect(onContinueFromNextContext).toHaveBeenCalledTimes(1);
  });

  it('keeps the compact current-selection view when no review set exists', () => {
    const panel = SelectionLedgerPanel({
      assets,
      error: null,
      loading: false,
      onClear: () => undefined,
      onRefresh: () => undefined,
      pending: false,
      project: 'demo-project',
      selection: { ...selection, active_review_set: null, review_sets: [] },
    });
    const text = flattenText(panel);

    expect(text).toContain('Current asset selections');
    expect(text).toContain('2 selected');
    expect(text).not.toContain('Active review set');
    expect(text).not.toContain('Continue from next context');
  });
});
