// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetReviewState, LineageNode, LineageSnapshot } from '../../shared/types';
import { LineageDetailModal } from './LineageDetailModal';

vi.mock('../api', () => ({
  api: vi.fn(() => Promise.resolve({
    fetchedAt: '2026-07-08T00:00:00.000Z',
    jobs: [],
    project: 'demo-project',
  })),
}));

const node = {
  asset_id: 'local-node',
  campaign: 'Summer launch',
  channel: 'paid-social',
  is_latest: true,
  local_path: '/tmp/vertical-poster.png',
  media_type: 'image',
  preview_url: '/api/assets/local-preview?project=demo-project&path=vertical-poster.png',
  project: 'demo-project',
  review_state: 'unreviewed',
  source: 'local',
  status: 'planned',
  title: 'Vertical poster node',
  user_selected: false,
} satisfies LineageNode;

const previousNode = { ...node, asset_id: 'previous-node', title: 'Previous latest node' } satisfies LineageNode;
const nextNode = { ...node, asset_id: 'next-node', title: 'Next latest node' } satisfies LineageNode;
const snapshot = {
  project: 'demo-project',
  root_asset_id: 'root-node',
  active_asset_id: node.asset_id,
  selected: ['previous-node'],
  selection: null,
  selections: [],
  latest: [previousNode.asset_id, node.asset_id, nextNode.asset_id],
  nodes: [previousNode, node, nextNode],
  edges: [
    {
      child_asset_id: node.asset_id,
      created_at: '2026-07-08T00:00:00.000Z',
      id: 'edge-parent',
      parent_asset_id: previousNode.asset_id,
      relation_type: 'derived_from',
    },
    {
      child_asset_id: nextNode.asset_id,
      created_at: '2026-07-08T00:00:00.000Z',
      id: 'edge-child',
      parent_asset_id: node.asset_id,
      relation_type: 'derived_from',
    },
  ],
  fetchedAt: '2026-07-08T00:00:00.000Z',
} satisfies LineageSnapshot;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

describe('LineageDetailModal', () => {
  it('starts dense node information collapsed by default', () => {
    renderModal();

    const disclosures = Array.from(container!.querySelectorAll<HTMLDetailsElement>('.lineage-detail-disclosure'));
    const proof = container!.querySelector<HTMLDetailsElement>('.lineage-detail-proof');

    expect(disclosures).toHaveLength(2);
    expect(disclosures.every(disclosure => !disclosure.open)).toBe(true);
    expect(proof?.open).toBe(false);
    expect(container!.querySelector('.lineage-detail-sidebar')?.contains(proof)).toBe(true);
    expect(container!.querySelector('.lineage-detail-sidebar')?.textContent).toContain('Asset details');
    expect(container!.querySelector('.lineage-detail-sidebar')?.textContent).toContain('Lineage context');
    expect(container!.querySelector('.lineage-detail-sidebar')?.textContent).toContain('Generation proof');
  });

  it('expands an image out of the detail card and closes it with Escape', () => {
    renderModal();

    act(() => expandImageButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const lightbox = container!.querySelector('.lineage-image-lightbox');
    expect(lightbox).toBeTruthy();
    expect(lightbox?.querySelector('img')?.getAttribute('src')).toBe(node.preview_url);

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })));

    expect(container!.querySelector('.lineage-image-lightbox')).toBeNull();
  });

  it('keeps video previews inside the frame without image-only expand controls', () => {
    renderModal({ node: { ...node, media_type: 'video', preview_url: '/asset.mp4' } });

    expect(container!.querySelector('.lineage-detail-preview video')?.getAttribute('src')).toBe('/asset.mp4');
    expect(expandImageButton()).toBeNull();
  });

  it('keeps key footer decisions visible and groups secondary actions under More actions', () => {
    const events: string[] = [];
    renderModal({ ...actionProps(events), selectedCount: 1 });

    const menu = container!.querySelector<HTMLDetailsElement>('.lineage-node-actions-menu');
    const primary = container!.querySelector('.lineage-node-actions-primary');

    expect(menu?.open).toBe(false);
    expect(primary?.textContent).toContain('Use for next variation');
    expect(primary?.textContent).toContain('Replace selection');
    expect(primary?.textContent).toContain('Approve');
    expect(primary?.textContent).toContain('Reject');
    expect(primary?.textContent).toContain('Ignore');
    expect(menu?.textContent).toContain('Clear all next variation');
    expect(menu?.textContent).toContain('Previous latest');
    expect(menu?.textContent).toContain('Next latest');

    act(() => button('Approve')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    act(() => menu?.querySelector('summary')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(events).toEqual(['review:approved:local-node']);
    expect(menu?.open).toBe(true);
  });
});

function renderModal(props: Partial<Parameters<typeof LineageDetailModal>[0]> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LineageDetailModal
        canRemoveFromLineage
        node={node}
        onClearAllNext={() => undefined}
        onClearNext={() => undefined}
        onClose={() => undefined}
        onOpenNode={() => undefined}
        onRemoveFromLineage={() => undefined}
        onReplaceNext={() => undefined}
        onReview={() => undefined}
        onSelectNext={() => undefined}
        onToast={() => undefined}
        selectedCount={0}
        selectionFull={false}
        snapshot={snapshot}
        {...props}
      />
    );
  });
}

function button(label: string): HTMLButtonElement | undefined {
  return Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent === label);
}

function expandImageButton(): HTMLButtonElement | null {
  return container!.querySelector<HTMLButtonElement>('button[aria-label="Expand image"]');
}

function actionProps(events: string[]): Pick<Parameters<typeof LineageDetailModal>[0], 'onClearAllNext' | 'onClearNext' | 'onOpenNode' | 'onRemoveFromLineage' | 'onReplaceNext' | 'onReview' | 'onSelectNext' | 'onToast'> {
  return {
    onClearAllNext: () => events.push('clear-all'),
    onClearNext: () => events.push('clear-next'),
    onOpenNode: assetId => events.push(`open:${assetId}`),
    onRemoveFromLineage: nextNode => events.push(`remove:${nextNode.asset_id}`),
    onReplaceNext: nextNode => events.push(`replace:${nextNode.asset_id}`),
    onReview: (reviewState: AssetReviewState, assetId: string) => events.push(`review:${reviewState}:${assetId}`),
    onSelectNext: nextNode => events.push(`select:${nextNode.asset_id}`),
    onToast: (type, message) => events.push(`toast:${type}:${message}`),
  };
}
