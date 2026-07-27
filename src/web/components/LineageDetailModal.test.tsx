// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetReviewState, LineageNode, LineageSnapshot } from '../../shared/types';
import { api } from '../api';
import { LineageDetailModal } from './LineageDetailModal';

vi.mock('../api', () => ({
  api: vi.fn(() => Promise.resolve({
    fetchedAt: '2026-07-08T00:00:00.000Z',
    jobs: [],
    project: 'demo-project',
  })),
}));

const node = {
  absolute_path: '/tmp/lineage-assets/vertical-poster.png',
  asset_id: 'local-node',
  campaign: 'Summer launch',
  channel: 'paid-social',
  is_latest: true,
  local_path: 'vertical-poster.png',
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
  vi.unstubAllGlobals();
});

describe('LineageDetailModal', () => {
  it('shows the full local path in asset details', () => {
    renderModal();

    const localPathLabel = Array.from(container!.querySelectorAll('dt')).find(item => item.textContent === 'Local path');

    expect(localPathLabel?.nextElementSibling?.textContent).toBe('/tmp/lineage-assets/vertical-poster.png');
  });

  it('copies the full local path from asset detail actions', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    renderModal();

    await act(async () => {
      button('Copy local path')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(writeText).toHaveBeenCalledWith('/tmp/lineage-assets/vertical-poster.png');
  });

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

  it('opens the future-child target editor without conflating it with current asset details', () => {
    const onEditOutputTargets = vi.fn();
    renderModal({ onEditOutputTargets });

    act(() => button('Inspect or edit next output targets')?.click());

    expect(onEditOutputTargets).toHaveBeenCalledTimes(1);
    expect(container!.textContent).toContain('Generation proof');
  });

  it('shows immutable source-resolution proof and cancels a planned job explicitly', async () => {
    const events: string[] = [];
    const plannedJob = {
      id: 'job-frozen',
      prompt: 'Static child',
      status: 'planned',
      receipts: [],
      inputs: [{ asset_id: node.asset_id }],
      outputs: [],
      source_target_resolutions: [{
        parent_asset_id: node.asset_id,
        origin: 'node_override',
        setting_revision: 7,
        resolution_digest_sha256: 'frozen-resolution-digest',
        targets: [{ kind: 'custom', width: 1080, height: 1350 }],
        resolved_targets: [],
      }],
      target_plan: {
        groups: [{
          id: 'group-feed',
          parent_asset_id: node.asset_id,
          width: 1080,
          height: 1350,
          unlocked: false,
          variant_count: 1,
          grouping_mode: 'consolidated',
          delivery_surfaces: [],
          guidance: [],
        }],
        slots: [],
      },
    };
    vi.mocked(api).mockReset();
    vi.mocked(api)
      .mockResolvedValueOnce({ fetchedAt: '2026-07-27T00:00:00.000Z', jobs: [plannedJob], project: 'demo-project' } as never)
      .mockResolvedValueOnce({ job: { ...plannedJob, status: 'cancelled' } } as never);
    renderModal({ onToast: (type, message) => events.push(`${type}:${message}`) });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

    expect(container!.textContent).toContain('Frozen source target resolution');
    expect(container!.textContent).toContain('node_override');
    expect(container!.textContent).toContain('frozen-resolution-digest');
    expect(container!.textContent).toContain('Planned output geometry · Locked 1080 × 1350 px');
    await act(async () => {
      button('Cancel planned job')!.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const cancelCall = vi.mocked(api).mock.calls.find(call => call[0] === '/api/generation/targets/cancel')!;
    expect(JSON.parse(String((cancelCall[1] as RequestInit).body))).toMatchObject({
      confirmWrite: true,
      jobId: 'job-frozen',
      project: 'demo-project',
    });
    expect(container!.textContent).toContain('cancelled');
    expect(button('Cancel planned job')).toBeUndefined();
    expect(events).toContain('ok:Cancelled planned job job-frozen');
  });

  it('shows identical durable mapping proof and keeps inherited reroll dimensions read-only', async () => {
    const events: string[] = [];
    vi.mocked(api).mockReset();
    vi.mocked(api)
      .mockResolvedValueOnce({
        fetchedAt: '2026-07-27T00:00:00.000Z',
        jobs: [{
          id: 'job-locked',
          prompt: 'Story variant',
          status: 'planned',
          receipts: [],
          inputs: [{ asset_id: node.asset_id }],
          outputs: [],
          target_plan: {
            groups: [{
              id: 'group-story',
              parent_asset_id: node.asset_id,
              width: 1080,
              height: 1920,
              unlocked: false,
              variant_count: 1,
              grouping_mode: 'consolidated',
              delivery_surfaces: [{ platform: 'Instagram', surface: 'Story' }],
              guidance: ['Keep key text centered'],
            }],
            slots: [],
          },
        }],
        project: 'demo-project',
      } as never)
      .mockResolvedValueOnce({ job: { id: 'job-child', source_mode: 'lineage_selection' } } as never);
    const rerollNode = {
      ...node,
      reroll_request: {
        id: 'reroll-request',
        project_id: 'demo-project',
        root_asset_id: snapshot.root_asset_id,
        node_asset_id: node.asset_id,
        status: 'pending',
        requested_by: 'human',
        created_at: '2026-07-27T00:00:00.000Z',
      },
    } satisfies LineageNode;
    renderModal({ node: rerollNode, onToast: (type, message) => events.push(`${type}:${message}`) });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

    expect(container!.textContent).toContain('Locked 1080 × 1920 px');
    expect(container!.textContent).toContain('Instagram Story');
    expect(container!.textContent).toContain('Guidance only');
    const inherited = container!.querySelector<HTMLInputElement>('input[aria-label="Inherited reroll dimensions"]')!;
    expect(inherited.readOnly).toBe(true);
    expect(inherited.value).toBe('1080 × 1920 px');

    setInput(container!.querySelector<HTMLTextAreaElement>('.lineage-reroll-target textarea')!, 'Try a taller child');
    const numeric = container!.querySelectorAll<HTMLInputElement>('.lineage-reroll-target input[type="number"]');
    setInput(numeric[0], '1200');
    setInput(numeric[1], '1500');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(button('Plan re-roll or child variation')!.disabled).toBe(false);
    await act(async () => {
      button('Plan re-roll or child variation')!.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    const rerollCall = vi.mocked(api).mock.calls.find(call => call[0] === '/api/generation/targets/reroll')!;
    expect(rerollCall[0]).toBe('/api/generation/targets/reroll');
    expect(JSON.parse(String((rerollCall[1] as RequestInit).body))).toMatchObject({
      requestedDimensions: { width: 1200, height: 1500 },
      confirmWrite: true,
    });
    expect(events).toContain('ok:Planned child variation job-child');
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

function setInput(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
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
