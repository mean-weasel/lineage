// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetReviewState, LineageAttempt, LineageNode, LineageSnapshot } from '../../shared/types';
import { LineageAttemptHistoryModal } from './LineageAttemptHistoryModal';

const node = {
  asset_id: 'local-node',
  is_latest: true,
  media_type: 'image',
  preview_url: '/api/assets/local-preview?project=demo-project&path=original.png',
  project: 'demo-project',
  review_state: 'unreviewed',
  source: 'local',
  status: 'planned',
  title: 'Swissifier attempt node',
  user_selected: false,
} satisfies LineageNode;

const attempts = [
  attempt(3, 'local-v3', 'reroll-v3.png', true),
  attempt(2, 'local-v2', 'reroll-v2.png', false),
  {
    id: 'demo-project:local-node:attempt:implicit',
    project_id: 'demo-project',
    node_asset_id: 'local-node',
    asset_id: 'local-node',
    attempt_index: 1,
    source: 'initial',
    file_path: 'original.png',
    checksum_sha256: 'sha-v1',
    created_at: '2026-07-07T00:00:00.000Z',
    promoted_at: '2026-07-07T00:00:00.000Z',
    is_current: false,
  },
] satisfies LineageAttempt[];

const previousNode = { ...node, asset_id: 'previous-node', title: 'Previous latest node' } satisfies LineageNode;
const nextNode = { ...node, asset_id: 'next-node', title: 'Next latest node' } satisfies LineageNode;
const snapshot = {
  project: 'demo-project',
  root_asset_id: 'root-node',
  active_asset_id: node.asset_id,
  selected: ['another-node'],
  selection: null,
  selections: [],
  latest: [previousNode.asset_id, node.asset_id, nextNode.asset_id],
  nodes: [previousNode, node, nextNode],
  edges: [],
  fetchedAt: '2026-07-07T00:00:00.000Z',
} satisfies LineageSnapshot;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.style.overflow = '';
  vi.restoreAllMocks();
});

describe('LineageAttemptHistoryModal', () => {
  it('defaults to viewing the current attempt and locks background scroll', () => {
    renderModal();

    expect(document.body.style.overflow).toBe('hidden');
    expect(previewImage()).toContain('reroll-v3.png');
    expect(row('v3')?.getAttribute('aria-selected')).toBe('true');
    expect(row('v3')?.textContent).toContain('current');
    expect(row('v3')?.textContent).toContain('viewing');
  });

  it('selects previous attempts for preview without moving the current badge', () => {
    renderModal();

    act(() => row('v2')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(previewImage()).toContain('reroll-v2.png');
    expect(row('v2')?.getAttribute('aria-selected')).toBe('true');
    expect(row('v2')?.textContent).toContain('viewing');
    expect(row('v3')?.textContent).toContain('current');
  });

  it('selects the original attempt from keyboard interaction', () => {
    renderModal();

    act(() => row('v1')?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })));

    expect(previewImage()).toContain('original.png');
    expect(row('v1')?.getAttribute('aria-selected')).toBe('true');
    expect(row('v3')?.textContent).toContain('current');
  });

  it('uses a separate Set current action for promotion', () => {
    const promoted: LineageAttempt[] = [];
    renderModal({ onPromoteAttempt: attempt => { promoted.push(attempt); } });
    const promoteV2 = Array.from(container!.querySelectorAll('button')).find(button => button.textContent === 'Set current');

    act(() => promoteV2?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(promoted.map(attempt => attempt.attempt_index)).toEqual([2]);
    expect(row('v3')?.textContent).toContain('current');
  });

  it('keeps focused Set current activation separate from row selection', () => {
    const promoted: LineageAttempt[] = [];
    renderModal({ onPromoteAttempt: attempt => { promoted.push(attempt); } });
    const promoteV2 = Array.from(container!.querySelectorAll('button')).find(button => button.textContent === 'Set current');

    promoteV2?.focus();
    act(() => promoteV2?.click());

    expect(promoted.map(attempt => attempt.attempt_index)).toEqual([2]);
    expect(row('v2')?.getAttribute('aria-selected')).toBe('false');
  });

  it('still lets Escape close when Set current is focused', () => {
    const onClose = vi.fn();
    renderModal({ onClose, onPromoteAttempt: () => undefined });
    const promoteV2 = Array.from(container!.querySelectorAll('button')).find(button => button.textContent === 'Set current');

    promoteV2?.focus();
    act(() => promoteV2?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape and restores focus to the opener', () => {
    const opener = document.createElement('button');
    opener.textContent = 'Open history';
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn(() => {
      act(() => root?.unmount());
    });
    renderModal({ onClose });

    expect(document.activeElement).toBe(button('Close'));
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('keeps Tab focus inside the dialog', () => {
    renderModal({ actions: actionProps([]), onPromoteAttempt: () => undefined });
    const buttons = Array.from(container!.querySelectorAll<HTMLButtonElement>('button'));
    const first = buttons[0];
    const last = buttons[buttons.length - 1];

    last.focus();
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Tab' })));
    expect(document.activeElement).toBe(first);

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Tab', shiftKey: true })));
    expect(document.activeElement).toBe(last);
  });

  it('restores background scroll lock on unmount', () => {
    document.body.style.overflow = 'auto';
    renderModal();

    act(() => root?.unmount());

    expect(document.body.style.overflow).toBe('auto');
  });

  it('renders an isolated attempt list scroll region', () => {
    renderModal();
    const list = container!.querySelector('.lineage-attempt-list');

    expect(list?.getAttribute('role')).toBe('listbox');
    expect(list?.getAttribute('aria-label')).toBe('Attempt versions');
  });

  it('includes the normal node action controls for stacked nodes', () => {
    const events: string[] = [];
    renderModal({ actions: actionProps(events) });

    expect(button('Use for next variation')).toBeTruthy();
    expect(button('Replace selection')).toBeTruthy();
    expect(button('Clear all next variation')).toBeTruthy();
    expect(button('Previous latest')).toBeTruthy();
    expect(button('Next latest')).toBeTruthy();
    expect(button('Approve')).toBeTruthy();

    act(() => button('Use for next variation')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    act(() => button('Replace selection')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    act(() => button('Clear all next variation')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    act(() => button('Previous latest')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(events).toEqual(['select:local-node', 'replace:local-node', 'clear-all', 'open:previous-node']);
  });

  it('keeps attempt row selection separate from node action controls', () => {
    const events: string[] = [];
    renderModal({ actions: actionProps(events) });

    act(() => row('v2')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(previewImage()).toContain('reroll-v2.png');
    expect(events).toEqual([]);
  });
});

function attempt(index: number, assetId: string, filePath: string, current: boolean): LineageAttempt {
  return {
    id: `demo-project:local-node:attempt:${index}`,
    project_id: 'demo-project',
    node_asset_id: 'local-node',
    asset_id: assetId,
    attempt_index: index,
    source: 'reroll',
    prompt: `Prompt v${index}`,
    generation_job_id: `job-v${index}`,
    file_path: filePath,
    checksum_sha256: `sha-v${index}`,
    created_at: '2026-07-07T00:00:00.000Z',
    promoted_at: '2026-07-07T00:00:00.000Z',
    is_current: current,
  };
}

function renderModal(props: Partial<Parameters<typeof LineageAttemptHistoryModal>[0]> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LineageAttemptHistoryModal
        attempts={attempts}
        node={node}
        onClose={() => undefined}
        project="demo-project"
        {...props}
      />
    );
  });
}

function previewImage(): string {
  return container!.querySelector('.lineage-attempt-preview img')?.getAttribute('src') || '';
}

function row(label: string): HTMLElement | undefined {
  return Array.from(container!.querySelectorAll<HTMLElement>('.lineage-attempt-item')).find(item => item.textContent?.includes(label));
}

function button(label: string): HTMLButtonElement | undefined {
  return Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent === label);
}

function actionProps(events: string[]): NonNullable<Parameters<typeof LineageAttemptHistoryModal>[0]['actions']> {
  return {
    canRemoveFromLineage: true,
    onClearAllNext: () => events.push('clear-all'),
    onClearNext: () => events.push('clear-next'),
    onOpenNode: assetId => events.push(`open:${assetId}`),
    onRemoveFromLineage: nextNode => events.push(`remove:${nextNode.asset_id}`),
    onReplaceNext: nextNode => events.push(`replace:${nextNode.asset_id}`),
    onReview: (reviewState: AssetReviewState, assetId: string) => events.push(`review:${reviewState}:${assetId}`),
    onSelectNext: nextNode => events.push(`select:${nextNode.asset_id}`),
    onToast: (type, message) => events.push(`toast:${type}:${message}`),
    selectedCount: 1,
    selectionFull: false,
    snapshot,
  };
}
