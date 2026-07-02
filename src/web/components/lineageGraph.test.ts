import { describe, expect, it } from 'vitest';
import type { LineageSnapshot } from '../../shared/types';
import { layoutLineageTree, lineageFocus, toGraph } from './lineageGraph';

const nodeSize = { height: 164, width: 212 };

function snapshot(ids: string[], edges: Array<[string, string]>, positions: Record<string, { x: number; y: number }> = {}): LineageSnapshot {
  return {
    active_asset_id: ids[0],
    edges: edges.map(([parent, child]) => ({
      child_asset_id: child,
      created_at: '2026-06-28T00:00:00.000Z',
      id: `${parent}-${child}`,
      parent_asset_id: parent,
      relation_type: 'derived_from',
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
  });

  it('keeps saved positions ahead of generated tidy positions', () => {
    const graph = toGraph(snapshot(['root', 'child'], [['root', 'child']], { child: { x: 777, y: 333 } }), null);
    const child = graph.nodes.find(node => node.id === 'child')?.position;

    expect(child).toEqual({ x: 777, y: 333 });
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
});
