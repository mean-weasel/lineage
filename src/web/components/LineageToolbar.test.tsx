// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('keeps replay, New lineage, and Actions as permanent toolbar commands', () => {
    renderToolbar();

    expect(container!.querySelector('.lineage-demo-menu')).toBeNull();
    expect(container!.querySelector('.lineage-next-summary')).toBeNull();
    expect(container!.querySelector('.lineage-direction-control')).toBeNull();
    expect(container!.querySelector('.lineage-primary-controls')?.textContent).toContain('Replay growth');
    expect(container!.querySelector('.lineage-primary-controls')?.textContent).toContain('New lineage');
    expect(container!.querySelector('.lineage-overflow summary')?.textContent).toBe('Actions');
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

  it('keeps moved graph, demo, refresh, and archive controls reachable in Actions', () => {
    renderToolbar({ activeWorkspace: null });

    const actions = container!.querySelector('.lineage-overflow')!;

    expect(actions.textContent).toContain('QA seed media');
    expect(actions.textContent).toContain('Load SVG placeholder demo');
    expect(actions.textContent).toContain('Load rich image demo');
    expect(actions.textContent).toContain('Direction');
    expect(actions.textContent).toContain('Hide edge labels');
    expect(actions.textContent).toContain('Left to right');
    expect(actions.textContent).toContain('Fit graph');
    expect(actions.textContent).toContain('Tidy tree');
    expect(actions.textContent).toContain('Manage selection');
    expect(actions.textContent).toContain('Archive current lineage');
    expect(actions.textContent).toContain('Index local');
    expect(actions.textContent).toContain('Refresh graph');
    expect(actions.textContent).toContain('Refresh workspaces');
    expect(container!.textContent).not.toContain('Next variation');
  });

  it('exposes a visible-by-default canvas-wide edge-label toggle without persisting it', () => {
    const onEdgeSummariesVisible = vi.fn();
    renderToolbar({ onEdgeSummariesVisible });

    const hideButton = [...container!.querySelectorAll('button')].find(button => button.textContent === 'Hide edge labels');
    expect(hideButton?.getAttribute('aria-pressed')).toBe('true');
    act(() => hideButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onEdgeSummariesVisible).toHaveBeenCalledOnce();

    renderToolbar({ edgeSummariesVisible: false });
    const showButton = [...container!.querySelectorAll('button')].find(button => button.textContent === 'Show edge labels');
    expect(showButton?.getAttribute('aria-pressed')).toBe('false');
  });
});

function renderToolbar(overrides: Partial<Parameters<typeof LineageToolbar>[0]> = {}) {
  const props: Parameters<typeof LineageToolbar>[0] = {
    activeWorkspace: workspace,
    closeSignal: 0,
    demoSeedStatus: demoMediaStatus({ present: 10, total: 10 }),
    edgeSummariesVisible: true,
    graphDirection: 'LR',
    loading: false,
    onArchiveWorkspace: vi.fn(),
    onDownloadSwissifierMedia: vi.fn(),
    onEdgeSummariesVisible: vi.fn(),
    onFitGraph: vi.fn(),
    onGraphDirection: vi.fn(),
    onIndexLocal: vi.fn(),
    onNewLineage: vi.fn(),
    onRefreshLineage: vi.fn(),
    onRefreshWorkspaces: vi.fn(),
    onReplayGrowth: vi.fn(),
    onRestoreDemoMedia: vi.fn(),
    onRestoreSwissifierMedia: vi.fn(),
    onSeedDemo: vi.fn(),
    onSeedSwissifierDemo: vi.fn(),
    onSelectWorkspace: vi.fn(),
    onTidyGraph: vi.fn(),
    onToggleNextPanel: vi.fn(),
    replayActive: false,
    sideOpen: false,
    snapshot,
    swissifierDemoStatus: demoMediaStatus({ download_available: true, present: 7, total: 14 }),
    workspaceLoading: false,
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
