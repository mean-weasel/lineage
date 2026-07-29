import { describe, expect, it } from 'vitest';
import { Position } from '@xyflow/react';
import type { LineageSnapshot } from '../../shared/types';
import { layoutLineageTree, lineageFocus, projectLineageBranches, toGraph, type LineageGraphDirection } from './lineageGraph';

const nodeSize = { height: 164, width: 212 };

function snapshot(ids: string[], edges: Array<[string, string, string?]>, positions: Record<string, { x: number; y: number }> = {}): LineageSnapshot {
  return {
    active_asset_id: ids[0],
    edges: edges.map(([parent, child, summary]) => ({
      child_asset_id: child,
      created_at: '2026-06-28T00:00:00.000Z',
      id: `${parent}-${child}`,
      parent_asset_id: parent,
      relation_type: 'derived_from',
      ...(summary ? {
        summary,
        summary_created_by: 'agent' as const,
        summary_updated_at: '2026-06-28T00:00:00.000Z',
        summary_updated_by: 'agent' as const,
      } : {}),
    })),
    fetchedAt: '2026-06-28T00:00:00.000Z',
    latest: [ids.at(-1) || ids[0]],
    nodes: ids.map(assetId => ({
      asset_id: assetId,
      is_latest: false,
      media_type: 'image',
      position: positions[assetId],
      project: 'demo-project',
      review_state: 'unreviewed',
      source: 'local',
      status: 'planned',
      title: assetId,
      user_selected: false,
    })),
    project: 'demo-project',
    root_asset_id: ids[0],
    selected: [],
    selection: null,
    selections: [],
  };
}

function overlaps(first: { x: number; y: number }, second: { x: number; y: number }) {
  return Math.abs(first.x - second.x) < nodeSize.width && Math.abs(first.y - second.y) < nodeSize.height;
}

describe('lineage graph layout', () => {
  it('uses a tidy left-to-right layout when no saved positions exist', () => {
    const graph = toGraph(snapshot(['root', 'child'], [['root', 'child']]), null);
    const root = graph.nodes.find(node => node.id === 'root')?.position;
    const child = graph.nodes.find(node => node.id === 'child')?.position;

    expect(root).toBeDefined();
    expect(child).toBeDefined();
    expect(child?.x).toBeGreaterThan(root?.x || 0);
    expect(graph.nodes[0].targetPosition).toBe(Position.Left);
    expect(graph.nodes[0].sourcePosition).toBe(Position.Right);
    expect(graph.nodes[0].data.targetPosition).toBe(Position.Left);
    expect(graph.nodes[0].data.sourcePosition).toBe(Position.Right);
  });

  it.each([
    ['LR', 'x', 'greater', Position.Left, Position.Right],
    ['RL', 'x', 'less', Position.Right, Position.Left],
    ['TB', 'y', 'greater', Position.Top, Position.Bottom],
    ['BT', 'y', 'less', Position.Bottom, Position.Top],
  ] satisfies Array<[LineageGraphDirection, 'x' | 'y', 'greater' | 'less', Position, Position]>)(
    'orients %s graph layout and node handles together',
    (direction, axis, ordering, targetPosition, sourcePosition) => {
      const graph = toGraph(snapshot(['root', 'child'], [['root', 'child', 'Cleaner type']]), null, direction);
      const root = graph.nodes.find(node => node.id === 'root')?.position;
      const child = graph.nodes.find(node => node.id === 'child')?.position;

      expect(root).toBeDefined();
      expect(child).toBeDefined();
      if (ordering === 'greater') expect(child?.[axis]).toBeGreaterThan(root?.[axis] || 0);
      else expect(child?.[axis]).toBeLessThan(root?.[axis] || 0);
      expect(graph.nodes[0].targetPosition).toBe(targetPosition);
      expect(graph.nodes[0].sourcePosition).toBe(sourcePosition);
      expect(graph.nodes[0].data.targetPosition).toBe(targetPosition);
      expect(graph.nodes[0].data.sourcePosition).toBe(sourcePosition);
      expect(graph.edges[0]).toMatchObject({
        ariaLabel: 'root to child: Cleaner type',
        label: 'Cleaner type',
        labelShowBg: true,
        type: 'smoothstep',
      });
    }
  );

  it('keeps saved positions ahead of generated tidy positions', () => {
    const graph = toGraph(snapshot(['root', 'child'], [['root', 'child']], { child: { x: 777, y: 333 } }), null);
    const child = graph.nodes.find(node => node.id === 'child')?.position;

    expect(child).toEqual({ x: 777, y: 333 });
  });

  it('keeps saved compact positions while other branches remain collapsed', () => {
    const source = snapshot(
      ['root', 'a', 'a1', 'b', 'b1'],
      [['root', 'a'], ['a', 'a1'], ['root', 'b'], ['b', 'b1']],
      {
        root: { x: 10, y: 20 },
        a: { x: 300, y: 40 },
        a1: { x: 600, y: 60 },
        b: { x: 300, y: 400 },
        b1: { x: 600, y: 420 },
      },
    );

    const partiallyExpanded = toGraph(source, null, 'LR', true, 'compact', new Set(['b']));

    expect(partiallyExpanded.nodes.map(node => [node.id, node.position])).toEqual([
      ['root', { x: 10, y: 20 }],
      ['a', { x: 300, y: 40 }],
      ['a1', { x: 600, y: 60 }],
      ['b', { x: 300, y: 400 }],
    ]);
  });

  it('uses portrait dimensions and fresh layout positions in portrait lab mode', () => {
    const graph = toGraph(
      snapshot(['root', 'child'], [['root', 'child']], { child: { x: 777, y: 333 } }),
      null,
      'LR',
      true,
      'portrait',
    );
    const root = graph.nodes.find(node => node.id === 'root')!;
    const child = graph.nodes.find(node => node.id === 'child')!;

    expect(root).toMatchObject({ height: 400, width: 224 });
    expect(root.data.canvasPresentation).toBe('portrait');
    expect(child.position).not.toEqual({ x: 777, y: 333 });
    expect(child.position.x).toBeGreaterThan(root.position.x);
  });

  it('spaces branching nodes so sibling cards do not overlap', () => {
    const positions = layoutLineageTree(snapshot(
      ['root', 'a', 'b', 'c', 'a1', 'a2', 'b1'],
      [['root', 'a'], ['root', 'b'], ['root', 'c'], ['a', 'a1'], ['a', 'a2'], ['b', 'b1']]
    ));
    const siblings = ['a', 'b', 'c'].map(id => positions.get(id)).filter((position): position is { x: number; y: number } => Boolean(position));

    expect(siblings).toHaveLength(3);
    expect(siblings.some((position, index) => siblings.slice(index + 1).some(other => overlaps(position, other)))).toBe(false);
  });

  it('marks the active node, immediate parents, immediate children, and adjacent edges for focus styling', () => {
    const graph = snapshot(
      ['root', 'a', 'b', 'a1', 'a2'],
      [['root', 'a'], ['root', 'b'], ['a', 'a1'], ['a', 'a2']]
    );
    const focus = lineageFocus(graph, 'a');

    expect(focus.roles.get('a')).toBe('active');
    expect(focus.roles.get('root')).toBe('parent');
    expect(focus.roles.get('a1')).toBe('child');
    expect(focus.roles.get('a2')).toBe('child');
    expect(focus.roles.has('b')).toBe(false);
    expect(focus.edgeClasses.get('root-a')).toContain('lineage-edge-focus-parent');
    expect(focus.edgeClasses.get('a-a1')).toContain('lineage-edge-focus-child');
    expect(focus.edgeClasses.has('root-b')).toBe(false);
  });

  it('maps each persisted summary to its own stock label and accessible edge name while leaving legacy edges unlabeled', () => {
    const graph = toGraph(snapshot(
      ['root', 'a', 'b', 'legacy'],
      [
        ['root', 'a', 'Cleaner type'],
        ['root', 'b', 'Warmer light'],
        ['root', 'legacy'],
      ],
    ), null);

    expect(graph.edges.map(edge => ({
      ariaLabel: edge.ariaLabel,
      ariaRole: edge.ariaRole,
      className: edge.className,
      keyshortcuts: edge.domAttributes?.['aria-keyshortcuts'],
      focusable: edge.focusable,
      id: edge.id,
      label: edge.label,
    }))).toEqual([
      { ariaLabel: 'root to a: Cleaner type', ariaRole: 'button', className: 'lineage-edge-summary', focusable: true, id: 'root-a', keyshortcuts: 'Enter Space', label: 'Cleaner type' },
      { ariaLabel: 'root to b: Warmer light', ariaRole: 'button', className: 'lineage-edge-summary', focusable: true, id: 'root-b', keyshortcuts: 'Enter Space', label: 'Warmer light' },
      { ariaLabel: 'root to legacy', ariaRole: 'button', className: undefined, focusable: true, id: 'root-legacy', keyshortcuts: 'Enter Space', label: undefined },
    ]);
    expect(graph.edges[0]).toMatchObject({ labelBgBorderRadius: 4, labelBgPadding: [5, 3], labelShowBg: true });
  });

  it('hides all visual labels without discarding summary-aware accessible edge names', () => {
    const graph = toGraph(snapshot(
      ['root', 'a', 'legacy'],
      [['root', 'a', 'Cleaner type'], ['root', 'legacy']],
    ), null, 'LR', false);

    expect(graph.edges[0]).toMatchObject({ ariaLabel: 'root to a: Cleaner type', className: 'lineage-edge-summary' });
    expect(graph.edges[0].label).toBeUndefined();
    expect(graph.edges[1]).toMatchObject({ ariaLabel: 'root to legacy' });
    expect(graph.edges[1].label).toBeUndefined();
  });

  it('projects a collapsed branch without mutating the lineage snapshot', () => {
    const source = snapshot(
      ['root', 'a', 'b', 'a1', 'a2', 'a1x'],
      [['root', 'a'], ['root', 'b'], ['a', 'a1'], ['a', 'a2'], ['a1', 'a1x']],
    );
    const projection = projectLineageBranches(source, new Set(['a']));
    const graph = toGraph(source, null, 'LR', true, 'compact', new Set(['a']));

    expect(projection.snapshot.nodes.map(node => node.asset_id)).toEqual(['root', 'a', 'b']);
    expect(projection.snapshot.edges.map(edge => edge.id)).toEqual(['root-a', 'root-b']);
    expect(projection.branchCounts.get('a')).toBe(3);
    expect(graph.nodes.map(node => node.id)).toEqual(['root', 'a', 'b']);
    expect(graph.nodes.find(node => node.id === 'a')?.data).toMatchObject({
      branchCollapsed: true,
      branchDescendantCount: 3,
    });
    expect(source.nodes).toHaveLength(6);
    expect(source.edges).toHaveLength(5);
  });

  it('keeps a shared descendant visible through another expanded branch', () => {
    const source = snapshot(
      ['root', 'a', 'b', 'unique', 'shared', 'leaf'],
      [['root', 'a'], ['root', 'b'], ['a', 'unique'], ['a', 'shared'], ['b', 'shared'], ['shared', 'leaf']],
    );
    const projection = projectLineageBranches(source, new Set(['a']));

    expect(projection.snapshot.nodes.map(node => node.asset_id)).toEqual(['root', 'a', 'b', 'shared', 'leaf']);
    expect(projection.snapshot.edges.map(edge => edge.id)).toEqual(['root-a', 'root-b', 'b-shared', 'shared-leaf']);
    expect(projection.branchCounts.get('a')).toBe(1);
  });

  it('preserves a disconnected cyclic component while collapsing the rooted tree', () => {
    const source = snapshot(
      ['root', 'child', 'orphan-a', 'orphan-b'],
      [['root', 'child'], ['orphan-a', 'orphan-b'], ['orphan-b', 'orphan-a']],
    );
    const projection = projectLineageBranches(source, new Set(['root']));

    expect(projection.snapshot.nodes.map(node => node.asset_id)).toEqual(['root', 'orphan-a', 'orphan-b']);
    expect(projection.snapshot.edges.map(edge => edge.id)).toEqual(['orphan-a-orphan-b', 'orphan-b-orphan-a']);
  });

  it('preserves nested collapse state when an ancestor is closed and reopened', () => {
    const source = snapshot(
      ['root', 'a', 'a1', 'a1x', 'a2'],
      [['root', 'a'], ['a', 'a1'], ['a1', 'a1x'], ['a', 'a2']],
    );
    const nestedCollapsed = new Set(['a', 'a1']);
    const ancestorClosed = projectLineageBranches(source, nestedCollapsed);
    const ancestorReopened = projectLineageBranches(source, new Set(['a1']));

    expect(ancestorClosed.snapshot.nodes.map(node => node.asset_id)).toEqual(['root', 'a']);
    expect(ancestorReopened.snapshot.nodes.map(node => node.asset_id)).toEqual(['root', 'a', 'a1', 'a2']);
    expect(ancestorReopened.branchCounts.get('a1')).toBe(1);
  });

});
