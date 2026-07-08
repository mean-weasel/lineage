// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentClaimSummary, LineageNode, LineageSnapshot, LineageTask } from '../../shared/types';
import { LineageSidePanel } from './LineageSidePanel';

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

describe('LineageSidePanel task queue', () => {
  it('updates pending task instructions through the task route', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, task: pendingTask }) });
    const refreshLineage = vi.fn(async () => undefined);
    const toasts: string[] = [];
    vi.stubGlobal('fetch', fetchMock);
    renderPanel({
      onToast: (_type, message) => { toasts.push(message); },
      refreshLineage,
      snapshot: snapshotWithTasks([pendingTask]),
    });

    changeTextarea('Instructions for task pending/id', 'Keep the red border crisp.');
    await clickButton('Save instructions');

    expect(fetchMock).toHaveBeenCalledWith('/api/lineage/tasks/task%20pending%2Fid/instructions', expect.objectContaining({
      body: JSON.stringify({ project: 'demo-project', instructions: 'Keep the red border crisp.' }),
      method: 'POST',
    }));
    expect(refreshLineage).toHaveBeenCalledTimes(1);
    expect(toasts).toContain('Updated iterate task instructions');
  });

  it('comments on and unlocks locked tasks without exposing claim tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, task: lockedTask }) });
    const refreshLineage = vi.fn(async () => undefined);
    const toasts: string[] = [];
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPanel({
      onToast: (_type, message) => { toasts.push(message); },
      refreshLineage,
      snapshot: snapshotWithTasks([lockedTask]),
    });

    expect(container!.textContent).toContain('Agent Ada');
    expect(container!.textContent).not.toContain('internal-private-marker');

    changeTextarea('Comment for task-locked', 'Leaving this note while the agent keeps working.');
    await clickButton('Add comment');
    await clickButton('Unlock');

    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      '/api/lineage/tasks/task-locked/comment',
      '/api/lineage/tasks/task-locked/override',
    ]);
    expect(fetchMock.mock.calls.map(call => JSON.parse(String((call[1] as RequestInit).body)))).toEqual([
      {
        actor: 'human',
        message: 'Leaving this note while the agent keeps working.',
        project: 'demo-project',
      },
      {
        actor: 'human',
        project: 'demo-project',
        reason: 'Human unlocked task from lineage UI.',
      },
    ]);
    expect(refreshLineage).toHaveBeenCalledTimes(2);
    expect(toasts).toEqual(['Commented on reroll task', 'Unlocked reroll task']);
  });
});

function renderPanel(props: Partial<Parameters<typeof LineageSidePanel>[0]> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const snapshot = props.snapshot || snapshotWithTasks([pendingTask]);
  act(() => {
    root!.render(
      <LineageSidePanel
        activeNode={snapshot.nodes[0]}
        brief={null}
        childAssetId=""
        clearNextVariation={async () => undefined}
        closePanel={() => undefined}
        latestNodes={snapshot.nodes}
        linkChild={async () => undefined}
        markReview={async () => undefined}
        nextVariationLimit={3}
        noteDirty={false}
        onSelectedAsset={() => undefined}
        onToast={() => undefined}
        project="demo-project"
        refreshBrief={async () => undefined}
        refreshLineage={async () => undefined}
        replaceNextVariation={() => undefined}
        saveRationale={() => undefined}
        selectNextBase={() => undefined}
        selectedNode={undefined}
        selectedNodes={[]}
        selectionFull={false}
        selectionNote=""
        setActiveNodeId={() => undefined}
        setChildAssetId={() => undefined}
        setDetailNodeId={() => undefined}
        setSelected={() => undefined}
        setSelectionNote={() => undefined}
        sideOpen
        snapshot={snapshot}
        {...props}
      />
    );
  });
}

function changeTextarea(label: string, value: string) {
  const textarea = Array.from(container!.querySelectorAll<HTMLTextAreaElement>('textarea')).find(item => item.getAttribute('aria-label') === label);
  if (!textarea) throw new Error(`Missing textarea: ${label}`);
  act(() => {
    setNativeTextareaValue(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function setNativeTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(textarea, 'value')?.set;
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) prototypeValueSetter.call(textarea, value);
  else if (valueSetter) valueSetter.call(textarea, value);
  else textarea.value = value;
}

async function clickButton(label: string) {
  const button = Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise(resolve => window.setTimeout(resolve, 0));
  });
}

function snapshotWithTasks(tasks: LineageTask[]): LineageSnapshot {
  return {
    active_asset_id: 'local-node',
    edges: [],
    fetchedAt: '2026-07-07T00:00:00.000Z',
    latest: ['local-node'],
    nodes: [nodeWithTasks(tasks)],
    project: 'demo-project',
    root_asset_id: 'local-root',
    selected: tasks.filter(task => task.task_type === 'iterate').map(task => task.target_asset_id),
    selection: null,
    selections: [],
    tasks,
  };
}

function nodeWithTasks(tasks: LineageTask[]): LineageNode {
  const lineageTasks = Object.fromEntries(tasks.map(task => [task.task_type, task])) as LineageNode['lineage_tasks'];
  return {
    asset_id: 'local-node',
    is_latest: true,
    lineage_tasks: lineageTasks,
    media_type: 'image',
    project: 'demo-project',
    review_state: 'unreviewed',
    source: 'local',
    status: 'planned',
    title: 'Swissifier node',
    user_selected: tasks.some(task => task.task_type === 'iterate'),
  };
}

const pendingTask: LineageTask = {
  id: 'task pending/id',
  project_id: 'demo-project',
  root_asset_id: 'local-root',
  target_asset_id: 'local-node',
  task_type: 'iterate',
  status: 'pending',
  instructions: 'Make a clean variant.',
  created_by: 'human',
  created_at: '2026-07-07T00:00:00.000Z',
  updated_at: '2026-07-07T00:00:00.000Z',
};

const lockedClaim: AgentClaimSummary = {
  agent_kind: 'codex',
  agent_name: 'Agent Ada',
  created_at: '2026-07-07T00:00:00.000Z',
  derived_state: 'active',
  expires_at: '2026-07-07T00:20:00.000Z',
  heartbeat_age_seconds: 8,
  heartbeat_at: '2026-07-07T00:05:00.000Z',
  id: 'claim_locked',
  metadata: { private_marker: 'internal-private-marker' },
  project: 'demo-project',
  scope_type: 'lineage_task',
  status: 'active',
  target_id: 'task-locked',
};

const lockedTask: LineageTask = {
  id: 'task-locked',
  project_id: 'demo-project',
  root_asset_id: 'local-root',
  target_asset_id: 'local-node',
  task_type: 'reroll',
  status: 'in_progress',
  instructions: 'Repair the current output.',
  created_by: 'human',
  created_at: '2026-07-07T00:00:00.000Z',
  updated_at: '2026-07-07T00:00:00.000Z',
  active_claim: lockedClaim,
  claimed_by_claim_id: 'claim_locked',
};
