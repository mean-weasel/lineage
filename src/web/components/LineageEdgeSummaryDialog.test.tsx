// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LineageEdge } from '../../shared/types';
import { LineageEdgeSummaryDialog } from './LineageEdgeSummaryDialog';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.style.overflow = '';
  vi.restoreAllMocks();
});

describe('LineageEdgeSummaryDialog', () => {
  it('adds a normalized one- or two-word label while rejecting blank and over-limit input', async () => {
    const submissions: Array<[string, string | undefined]> = [];
    renderDialog(edge(), async (action, summary) => { submissions.push([action, summary]); });
    const input = field();
    const save = button('Save label');

    expect(save.disabled).toBe(true);
    expect(container?.textContent).toContain('Enter one or two words.');

    change(input, 'one two three');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(container?.textContent).toContain('Edge summary must contain at most 2 words');
    expect(save.disabled).toBe(true);

    change(input, '  Cleaner\n type  ');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    await click(save);
    expect(submissions).toEqual([['set', 'Cleaner type']]);
  });

  it('keeps clear explicit and separate from blank save', async () => {
    const submissions: Array<[string, string | undefined]> = [];
    renderDialog(edge({ summary: 'Agent draft', summary_created_by: 'agent', summary_updated_by: 'agent', summary_updated_at: 'v1' }), async (action, summary) => { submissions.push([action, summary]); });

    change(field(), '   ');
    expect(button('Save label').disabled).toBe(true);
    expect(container?.textContent).toContain('Blank input is not a clear action. Use Clear label.');
    await click(button('Clear label'));

    expect(submissions).toEqual([['clear', undefined]]);
  });

  it('shows provenance, retains server errors, and reloads an authoritative conflicting value', async () => {
    const original = edge({ summary: 'Agent draft', summary_created_by: 'agent', summary_updated_by: 'agent', summary_updated_at: 'v1' });
    renderDialog(original, async () => { throw new Error('This edge changed elsewhere. The current label has been reloaded; review it and retry.'); });

    expect(container?.textContent).toContain('Agent-generated');
    change(field(), 'Human edit');
    await click(button('Save label'));
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain('changed elsewhere');

    renderDialog({ ...original, summary: 'Newest value', summary_updated_by: 'human', summary_updated_at: 'v2' }, async () => undefined);
    expect(field().value).toBe('Newest value');
    expect(container?.textContent).toContain('Agent-generated · Human-edited');
  });

  it('focuses the field, closes on Escape, and restores focus to the invoking edge', () => {
    const opener = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    opener.setAttribute('tabindex', '0');
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn(() => { act(() => root?.unmount()); });
    renderDialog(edge(), async () => undefined, { onClose, returnFocus: opener });

    expect(document.activeElement).toBe(field());
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })));

    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

function edge(overrides: Partial<LineageEdge> = {}): LineageEdge {
  return {
    child_asset_id: 'child',
    created_at: '2026-07-20T00:00:00.000Z',
    id: 'demo:root:derived_from:child',
    parent_asset_id: 'root',
    relation_type: 'derived_from',
    ...overrides,
  };
}

function renderDialog(
  target: LineageEdge,
  onSubmit: Parameters<typeof LineageEdgeSummaryDialog>[0]['onSubmit'],
  overrides: Partial<Parameters<typeof LineageEdgeSummaryDialog>[0]> = {},
) {
  if (!container) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
  act(() => {
    root?.render(
      <LineageEdgeSummaryDialog
        childTitle="Child card"
        edge={target}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        parentTitle="Parent card"
        returnFocus={null}
        {...overrides}
      />
    );
  });
}

function field() {
  return container!.querySelector<HTMLInputElement>('#lineage-edge-summary-input')!;
}

function button(name: string) {
  return [...container!.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === name)!;
}

function change(input: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(target: HTMLButtonElement) {
  await act(async () => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
}
