// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetLibrarySnapshot } from '../../shared/types';
import { Sidebar } from './Sidebar';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

describe('Sidebar', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  it('keeps project and essential asset filters in the default sidebar', () => {
    renderSidebar();

    expect(select('Project').value).toBe('demo-project');
    expect(select('Source').value).toBe('local');
    expect(select('Status').value).toBe('all');
    expect(select('Channel').value).toBe('all');
    expect(select('Placement').value).toBe('all');
  });

  it('removes quick sets and bucket stats from the default sidebar', () => {
    renderSidebar();

    expect(text()).not.toContain('Quick Sets');
    expect(text()).not.toContain('Review queue');
    expect(text()).not.toContain('Ledger workflow');
    expect(text()).not.toContain('Bucket');
    expect(text()).not.toContain('Catalog');
    expect(text()).not.toContain('Live');
    expect(text()).not.toContain('Loose');
    expect(text()).not.toContain('Size');
  });

  it('labels the mobile disclosure as filters only', () => {
    renderSidebar();

    const toggle = button('Filters');

    expect(toggle).not.toBeNull();
    expect(toggle?.textContent).not.toContain('quick sets');
  });
});

function renderSidebar() {
  act(() => {
    root!.render(
      <Sidebar
        channel="all"
        channels={['all', 'tiktok']}
        liveSync={false}
        placementStatus="all"
        project="demo-project"
        projects={[{
          project: 'demo-project',
          product: 'demo-project',
          catalogPath: 'catalog.json',
          default_bucket: 'lineage-demo-assets',
          default_region: 'us-east-1',
          asset_count: 29,
        }]}
        setChannel={vi.fn()}
        setPlacementStatus={vi.fn()}
        setProject={vi.fn()}
        setSource={vi.fn()}
        setStatus={vi.fn()}
        setView={vi.fn()}
        showBackupQueue={vi.fn()}
        snapshot={snapshot}
        source="local"
        status="all"
        totals={{ assets: 29, live: 0, orphan: 0, size: 21_000_000 }}
      />
    );
  });
}

function select(label: string): HTMLSelectElement {
  const match = Array.from(container!.querySelectorAll<HTMLSelectElement>('select'))
    .find(item => item.getAttribute('aria-label') === label);
  expect(match).toBeTruthy();
  return match!;
}

function button(label: string): HTMLButtonElement | null {
  return Array.from(container!.querySelectorAll<HTMLButtonElement>('button'))
    .find(item => item.textContent?.trim().includes(label)) || null;
}

function text(): string {
  return container?.textContent || '';
}

const snapshot = {
  identity: { account: 'not checked' },
} as AssetLibrarySnapshot;
