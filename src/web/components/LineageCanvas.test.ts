import { describe, expect, it } from 'vitest';
import type { LineageNode, LineageTask, LineageTaskStatus, LineageTaskType } from '../../shared/types';
import { lineageCanvasEmptyState } from './LineageCanvas';
import { quickActionState } from './lineageQuickActions';

describe('lineage inspector quick-action safety', () => {
  it('enforces branch capacity without trapping an already selected node', () => {
    expect(quickActionState(node(), false)).toMatchObject({
      branchDisabled: false,
      branchLocked: false,
      branchTitle: 'Use as a base for the next branch (B)',
    });
    expect(quickActionState(node(), true)).toMatchObject({
      branchDisabled: true,
      branchLocked: false,
      branchTitle: 'The branch selection is full.',
    });
    expect(quickActionState(node({ user_selected: true }), true)).toMatchObject({
      branchDisabled: false,
      branchLocked: false,
      branchTitle: 'Remove from the next branch (B)',
    });
  });

  it.each(['claimed', 'in_progress'] satisfies LineageTaskStatus[])('locks active %s work against inspector toggles', status => {
    const state = quickActionState(node({
      lineage_tasks: {
        iterate: task('iterate', status),
        reroll: task('reroll', status),
      },
    }), false);

    expect(state).toMatchObject({
      branchDisabled: true,
      branchLocked: true,
      rerollDisabled: true,
      rerollLocked: true,
    });
    expect(state.branchTitle).toContain('task queue');
    expect(state.rerollTitle).toContain('task queue');
  });

  it.each(['pending', 'resolved', 'cancelled'] satisfies LineageTaskStatus[])('leaves %s task records toggleable', status => {
    const state = quickActionState(node({
      lineage_tasks: {
        iterate: task('iterate', status),
        reroll: task('reroll', status),
      },
      reroll_request: rerollRequest('pending'),
    }), false);

    expect(state).toMatchObject({
      branchDisabled: false,
      branchLocked: false,
      rerollDisabled: false,
      rerollLocked: false,
      rerollSelected: true,
      rerollTitle: 'Remove from the re-roll queue (R)',
    });
  });
});

describe('lineage canvas empty-state truthfulness', () => {
  it('never offers a second index while automatic rich-demo indexing is active', () => {
    const state = lineageCanvasEmptyState('rich-root', 'indexing');

    expect(state).toEqual({
      action: 'none',
      description: 'Loading the automatic 14-node index. No manual action is needed.',
      title: 'Indexing rich demo images',
    });
    expect(state.title).not.toContain('No lineage index yet');
  });

  it('separates genuine empty and failed automatic index recovery', () => {
    expect(lineageCanvasEmptyState('real-empty-root', null)).toMatchObject({ action: 'index', title: 'No lineage index yet' });
    expect(lineageCanvasEmptyState('rich-root', 'error')).toMatchObject({ action: 'retry-index', title: 'Rich demo setup failed' });
    expect(lineageCanvasEmptyState('', 'error')).toMatchObject({ action: 'seed', title: 'Rich demo setup failed' });
  });
});

function node(overrides: Partial<LineageNode> = {}): LineageNode {
  return {
    asset_id: 'local-node',
    is_latest: true,
    media_type: 'image',
    project: 'demo-project',
    review_state: 'unreviewed',
    source: 'local',
    status: 'working',
    title: 'Node',
    user_selected: false,
    ...overrides,
  };
}

function task(taskType: LineageTaskType, status: LineageTaskStatus): LineageTask {
  return {
    created_at: '2026-07-20T00:00:00.000Z',
    created_by: 'human',
    id: `${taskType}-${status}`,
    project_id: 'demo-project',
    root_asset_id: 'root',
    status,
    target_asset_id: 'local-node',
    task_type: taskType,
    updated_at: '2026-07-20T00:00:00.000Z',
  };
}

function rerollRequest(status: 'cancelled' | 'pending' | 'resolved') {
  return {
    created_at: '2026-07-20T00:00:00.000Z',
    id: `reroll-${status}`,
    node_asset_id: 'local-node',
    project_id: 'demo-project',
    requested_by: 'human' as const,
    root_asset_id: 'root',
    status,
  };
}
