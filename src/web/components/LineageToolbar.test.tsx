// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LineageSnapshot, LineageWorkspace } from '../../shared/types';
import { LineageToolbar } from './LineageToolbar';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

describe('LineageToolbar', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, claims: [], fetchedAt: '2026-07-09T00:00:00.000Z' }),
    }));
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = null;
    root = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses the workspace picker as the canvas toolbar anchor without repeating the Lineage title', () => {
    renderToolbar();

    expect(container!.querySelector('.lineage-title')).toBeNull();
    expect(container!.querySelector('h2')?.textContent).not.toBe('Lineage');
    expect(container!.querySelector('.lineage-workspace-picker')).not.toBeNull();
    expect(container!.querySelector('.lineage-workspace-trigger strong')?.textContent).toBe(workspace.title);
    expect(container!.querySelector('.lineage-toolbar-context')?.textContent).toContain('7 nodes');
    expect(container!.querySelector('.lineage-toolbar-context')?.textContent).toContain('6 links');
  });

  it('keeps workspace, layout, selection, and output commands visible without an Actions menu', () => {
    renderToolbar();

    expect(container!.querySelector('.lineage-primary-controls')?.textContent).toContain('Replay growth');
    expect(container!.querySelector('.lineage-primary-controls')?.textContent).toContain('New lineage');
    expect(container!.querySelector('.lineage-primary-controls')?.textContent).toContain('Plan outputs');
    expect(container!.querySelector('.lineage-primary-controls')?.textContent).toContain('Manage selection');
    expect(container!.querySelector('.lineage-primary-controls')?.textContent).toContain('Output target defaults');
    expect([...container!.querySelectorAll('summary')].some(summary => summary.textContent === 'Actions')).toBe(false);
    expect(container!.textContent).not.toContain('Fit graph');
    expect(container!.textContent).not.toContain('Tidy tree');
    expect([...container!.querySelectorAll('button')].filter(button => button.textContent === 'New lineage')).toHaveLength(1);
  });

  it('keeps New lineage direct and does not duplicate it inside the workspace picker', () => {
    renderToolbar();

    act(() => container!.querySelector<HTMLButtonElement>('.lineage-workspace-trigger')!.click());
    const workspaceMenu = container!.querySelector('.lineage-workspace-menu')!;

    expect(workspaceMenu.textContent).not.toContain('New lineage');
    expect([...container!.querySelectorAll('button')].filter(button => button.textContent === 'New lineage')).toHaveLength(1);
  });

  it('opens target planning from the selected branch and keeps defaults in human settings', () => {
    const onOpenGeneration = vi.fn();
    const onOpenOutputDefaults = vi.fn();
    renderToolbar({
      onOpenGeneration,
      onOpenOutputDefaults,
      snapshot: { ...snapshot, selected: ['child-1'] },
    });

    const plan = [...container!.querySelectorAll('button')].find(button => button.textContent === 'Plan outputs')!;
    act(() => plan.click());
    expect(onOpenGeneration).toHaveBeenCalledOnce();
    const defaults = [...container!.querySelectorAll('button')].find(button => button.textContent === 'Output target defaults')!;
    act(() => defaults.click());
    expect(onOpenOutputDefaults).toHaveBeenCalledOnce();
  });

  it('starts replay from its visible control and disables duplicate entry while active', () => {
    const onReplayGrowth = vi.fn();
    renderToolbar({ onReplayGrowth });

    const replay = [...container!.querySelectorAll('button')].find(button => button.textContent === 'Replay growth')!;
    expect(replay.disabled).toBe(false);
    act(() => replay.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onReplayGrowth).toHaveBeenCalledOnce();

    renderToolbar({ replayActive: true });
    const activeReplay = [...container!.querySelectorAll('button')].find(button => button.textContent === 'Replay growth')!;
    expect(activeReplay.disabled).toBe(true);
    expect(activeReplay.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps maintenance and Demo/QA tools reachable in default-collapsed sections', () => {
    renderToolbar({ activeWorkspace: null });

    const sections = [...container!.querySelectorAll<HTMLDetailsElement>('.lineage-tool-section')];
    const maintenance = sections.find(section => section.querySelector('summary')?.textContent === 'Maintenance')!;
    const demo = sections.find(section => section.querySelector('summary')?.textContent === 'Demo/QA')!;

    expect(maintenance.open).toBe(false);
    expect(demo.open).toBe(false);
    expect(maintenance.textContent).toContain('Index local');
    expect(maintenance.textContent).toContain('Refresh graph');
    expect(maintenance.textContent).toContain('Refresh workspaces');
    expect(demo.textContent).toContain('QA seed media');
    expect(demo.textContent).toContain('Load demo lineage');
    expect(demo.textContent).toContain('Restore basic media');
    expect(demo.textContent).toContain('Load SVG placeholder demo');
    expect(demo.textContent).toContain('Download rich images');
    expect(demo.textContent).toContain('Restore rich media');
    expect(demo.textContent).toContain('Load rich image demo');
  });

  it('keeps archive in destructive workspace overflow and preserves its callback', () => {
    const onArchiveWorkspace = vi.fn();
    renderToolbar({ onArchiveWorkspace });

    const workspaceTrigger = container!.querySelector<HTMLButtonElement>('.lineage-workspace-trigger')!;
    act(() => workspaceTrigger.click());
    const archive = [...container!.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent === 'Archive current lineage')!;

    expect(archive).toBeTruthy();
    expect(archive.classList.contains('lineage-archive-workspace')).toBe(true);
    expect(archive.disabled).toBe(false);
    act(() => archive.click());
    expect(onArchiveWorkspace).toHaveBeenCalledOnce();
  });

  it('keeps workspace options and destructive overflow inside the contextual panel width', () => {
    const css = readFileSync(join(process.cwd(), 'src/web/components/LineageWorkspacePicker.css'), 'utf8');
    const menuRuleStart = css.indexOf('.lineage-workspace-menu {');
    const menuRule = css.slice(menuRuleStart, css.indexOf('}', menuRuleStart) + 1);

    expect(menuRule).toContain('width: 100%;');
    expect(menuRule).toContain('max-width: 100%;');
    expect(menuRule).not.toContain('420px');
  });

  it('preserves maintenance and Demo/QA command callbacks', () => {
    const onRefreshLineage = vi.fn();
    const onRefreshWorkspaces = vi.fn();
    const onRestoreSwissifierMedia = vi.fn();
    const onIndexLocal = vi.fn();
    const onRestoreDemoMedia = vi.fn();
    const onDownloadSwissifierMedia = vi.fn();
    const onSeedDemo = vi.fn();
    const onSeedSwissifierDemo = vi.fn();
    renderToolbar({
      demoSeedStatus: demoMediaStatus({ present: 9, total: 10 }),
      onDownloadSwissifierMedia,
      onIndexLocal,
      onRefreshLineage,
      onRefreshWorkspaces,
      onRestoreDemoMedia,
      onRestoreSwissifierMedia,
      onSeedDemo,
      onSeedSwissifierDemo,
    });

    for (const [label, callback] of [
      ['Refresh graph', onRefreshLineage],
      ['Refresh workspaces', onRefreshWorkspaces],
      ['Index local', onIndexLocal],
      ['Restore basic media', onRestoreDemoMedia],
      ['Load SVG placeholder demo', onSeedDemo],
      ['Download rich images', onDownloadSwissifierMedia],
      ['Restore rich media', onRestoreSwissifierMedia],
      ['Load rich image demo', onSeedSwissifierDemo],
    ] as const) {
      const button = [...container!.querySelectorAll<HTMLButtonElement>('button')]
        .find(candidate => candidate.textContent === label)!;
      act(() => button.click());
      expect(callback).toHaveBeenCalledOnce();
    }
  });

  it('preserves direct workspace, selection, and output callbacks', () => {
    const onNewLineage = vi.fn();
    const onOpenGeneration = vi.fn();
    const onOpenOutputDefaults = vi.fn();
    const onSelectWorkspace = vi.fn();
    const onToggleNextPanel = vi.fn();
    renderToolbar({
      onNewLineage,
      onOpenGeneration,
      onOpenOutputDefaults,
      onSelectWorkspace,
      onToggleNextPanel,
      snapshot: { ...snapshot, selected: ['child-1'] },
    });

    for (const [label, callback] of [
      ['New lineage', onNewLineage],
      ['Plan outputs', onOpenGeneration],
      ['Output target defaults', onOpenOutputDefaults],
      ['Manage selection', onToggleNextPanel],
    ] as const) {
      const button = [...container!.querySelectorAll<HTMLButtonElement>('.lineage-primary-controls button')]
        .find(candidate => candidate.textContent === label)!;
      act(() => button.click());
      expect(callback).toHaveBeenCalledOnce();
    }

    act(() => container!.querySelector<HTMLButtonElement>('.lineage-workspace-trigger')!.click());
    const option = container!.querySelector<HTMLButtonElement>('.lineage-workspace-options [role="option"]')!;
    act(() => option.click());
    expect(onSelectWorkspace).toHaveBeenCalledWith(workspace.id);
  });

  it('shows automatic rich-demo indexing progress and disables duplicate index or seed actions', () => {
    renderToolbar({ workspaceProgress: 'indexing' });

    expect(container!.querySelector('.lineage-toolbar-context')?.textContent).toBe('Indexing 14 rich demo images');
    const index = [...container!.querySelectorAll('button')].find(button => button.textContent === 'Index local');
    const richSeed = [...container!.querySelectorAll('button')].find(button => button.textContent === 'Load rich image demo');
    expect(index?.disabled).toBe(true);
    expect(richSeed?.disabled).toBe(true);
    expect(container!.textContent).not.toContain('No lineage index yet');
  });

});

function renderToolbar(overrides: Partial<Parameters<typeof LineageToolbar>[0]> = {}) {
  const props: Parameters<typeof LineageToolbar>[0] = {
    activeWorkspace: workspace,
    closeSignal: 0,
    demoSeedStatus: demoMediaStatus({ present: 10, total: 10 }),
    loading: false,
    onArchiveWorkspace: vi.fn(),
    onDownloadSwissifierMedia: vi.fn(),
    onIndexLocal: vi.fn(),
    onNewLineage: vi.fn(),
    onOpenGeneration: vi.fn(),
    onOpenOutputDefaults: vi.fn(),
    onRefreshLineage: vi.fn(),
    onRefreshWorkspaces: vi.fn(),
    onReplayGrowth: vi.fn(),
    onRestoreDemoMedia: vi.fn(),
    onRestoreSwissifierMedia: vi.fn(),
    onSeedDemo: vi.fn(),
    onSeedSwissifierDemo: vi.fn(),
    onSelectWorkspace: vi.fn(),
    onToggleNextPanel: vi.fn(),
    replayActive: false,
    sideOpen: false,
    snapshot,
    swissifierDemoStatus: demoMediaStatus({ download_available: true, present: 7, total: 14 }),
    workspaceLoading: false,
    workspaceProgress: null,
    workspaceRootAssetId: workspace.root_asset_id,
    workspaces: [workspace],
    ...overrides,
  };

  act(() => {
    root!.render(<LineageToolbar {...props} />);
  });
}

const workspace: LineageWorkspace = {
  active_at: '2026-07-09T00:00:00.000Z',
  created_at: '2026-07-09T00:00:00.000Z',
  created_by: 'human',
  id: 'demo-project:lineage-workspace:local-root',
  project: 'demo-project',
  root_asset_id: 'local-root',
  status: 'active',
  title: 'Bleep Meta Vertical Save This',
  updated_at: '2026-07-09T00:00:00.000Z',
};

const snapshot = {
  active_asset_id: 'local-root',
  edges: Array.from({ length: 6 }, (_, index) => ({
    child_asset_id: `child-${index}`,
    created_at: '2026-07-09T00:00:00.000Z',
    id: `edge-${index}`,
    parent_asset_id: index === 0 ? 'local-root' : `child-${index - 1}`,
    relation_type: 'derived_from',
  })),
  fetchedAt: '2026-07-09T00:00:00.000Z',
  latest: ['child-6'],
  nodes: Array.from({ length: 7 }, (_, index) => ({
    asset_id: index === 0 ? 'local-root' : `child-${index}`,
    is_latest: index === 6,
    media_type: 'image',
    project: 'demo-project',
    review_state: 'unreviewed',
    source: 'local',
    status: 'working',
    title: index === 0 ? 'root' : `child ${index}`,
    user_selected: false,
  })),
  project: 'demo-project',
  root_asset_id: 'local-root',
  selected: [],
  selection: null,
  selections: [],
} satisfies LineageSnapshot;

function demoMediaStatus(overrides: { download_available?: boolean; present: number; total: number }) {
  return {
    fixture_present: overrides.present,
    fixture_total: overrides.total,
    media_root: '/tmp/lineage-demo-media',
    missing: [],
    ok: overrides.present === overrides.total,
    ...overrides,
  };
}
