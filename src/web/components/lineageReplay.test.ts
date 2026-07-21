import { describe, expect, it } from 'vitest';
import type { LineageSnapshot } from '../../shared/types';
import { toGraph } from './lineageGraph';
import { buildLineageReplayTimeline, projectLineageReplay } from './lineageReplay';

describe('lineage growth replay model', () => {
  it('orders eligible siblings by timestamp and then stable edge id', () => {
    const timeline = buildLineageReplayTimeline(snapshot(
      ['root', 'a', 'b', 'c'],
      [
        ['edge-b', 'root', 'b', '2026-07-21T00:00:02.000Z'],
        ['edge-c', 'root', 'c', '2026-07-21T00:00:02.000Z'],
        ['edge-a', 'root', 'a', '2026-07-21T00:00:01.000Z'],
      ],
    ));

    expect(timeline.stages.map(stage => stage.enteringNodeIds)).toEqual([
      ['root'],
      ['a'],
      ['b'],
      ['c'],
    ]);
  });

  it('keeps old child edges dependency-safe when their parent is not visible yet', () => {
    const timeline = buildLineageReplayTimeline(snapshot(
      ['root', 'parent', 'child'],
      [
        ['old-child', 'parent', 'child', '2026-07-20T00:00:00.000Z'],
        ['new-parent', 'root', 'parent', '2026-07-21T00:00:00.000Z'],
      ],
    ));

    expect(timeline.stages.map(stage => stage.enteringEdgeIds)).toEqual([[], ['new-parent'], ['old-child']]);
    expect(timeline.stages.at(-1)?.nodeIds).toEqual(['root', 'parent', 'child']);
  });

  it('retains later incoming edges as edge-only stages for multi-parent nodes', () => {
    const timeline = buildLineageReplayTimeline(snapshot(
      ['root', 'a', 'b'],
      [
        ['root-a', 'root', 'a', '2026-07-21T00:00:01.000Z'],
        ['root-b', 'root', 'b', '2026-07-21T00:00:02.000Z'],
        ['b-a', 'b', 'a', '2026-07-21T00:00:03.000Z'],
      ],
    ));

    expect(timeline.stages.at(-1)).toMatchObject({
      enteringEdgeIds: ['b-a'],
      enteringNodeIds: [],
    });
  });

  it('reveals disconnected residual components and cycles without dropping nodes or edges', () => {
    const timeline = buildLineageReplayTimeline(snapshot(
      ['root', 'x', 'y'],
      [
        ['x-y', 'x', 'y', '2026-07-21T00:00:01.000Z'],
        ['y-x', 'y', 'x', '2026-07-21T00:00:02.000Z'],
      ],
    ));

    expect(timeline.stages.map(stage => stage.enteringNodeIds)).toEqual([['root'], ['x'], ['y'], []]);
    expect(timeline.stages.at(-1)?.edgeIds).toEqual(['x-y', 'y-x']);
  });

  it('projects root entry, edge entry, settled scrubbing, and final interaction without removing wrappers', () => {
    const graphSnapshot = snapshot(
      ['root', 'child'],
      [['root-child', 'root', 'child', '2026-07-21T00:00:01.000Z']],
    );
    const timeline = buildLineageReplayTimeline(graphSnapshot);
    const graph = toGraph(graphSnapshot, null);

    const rootEntry = projectLineageReplay(graph.nodes, graph.edges, timeline, -1, 'node');
    expect(rootEntry.nodes).toHaveLength(2);
    expect(rootEntry.projection.nodeStates.get('root')).toBe('entering');
    expect(rootEntry.projection.nodeStates.get('child')).toBe('future');

    const edgeEntry = projectLineageReplay(graph.nodes, graph.edges, timeline, 0, 'edge');
    expect(edgeEntry.projection.edgeStates.get('root-child')).toBe('entering');
    expect(edgeEntry.projection.nodeStates.get('child')).toBe('future');
    expect(edgeEntry.edges[0]).toMatchObject({
      domAttributes: { 'aria-hidden': undefined },
      focusable: false,
    });

    const scrubbed = projectLineageReplay(graph.nodes, graph.edges, timeline, 0, 'settled');
    expect(scrubbed.projection.nodeStates.get('child')).toBe('future');
    expect(scrubbed.projection.interactive).toBe(false);
    expect(scrubbed.edges[0]).toMatchObject({
      domAttributes: { 'aria-hidden': true },
      focusable: false,
    });

    const complete = projectLineageReplay(graph.nodes, graph.edges, timeline, 1, 'settled');
    expect(complete.projection.interactive).toBe(true);
    expect(complete.nodes.every(node => node.data.replayInteractive)).toBe(true);
    expect(complete.edges[0]).toMatchObject({
      domAttributes: { 'aria-hidden': undefined },
      focusable: true,
    });
    expect(complete.edges[0].className).toContain('lineage-edge-replay-visible');
  });
});

function snapshot(
  nodeIds: string[],
  edges: Array<[id: string, parent: string, child: string, createdAt: string]>,
): LineageSnapshot {
  return {
    active_asset_id: nodeIds[0] || '',
    edges: edges.map(([id, parent, child, createdAt]) => ({
      child_asset_id: child,
      created_at: createdAt,
      id,
      parent_asset_id: parent,
      relation_type: 'derived_from',
    })),
    fetchedAt: '2026-07-21T00:00:00.000Z',
    latest: nodeIds.slice(-1),
    nodes: nodeIds.map(assetId => ({
      asset_id: assetId,
      is_latest: false,
      media_type: 'image',
      project: 'demo-project',
      review_state: 'unreviewed',
      source: 'local',
      status: 'working',
      title: assetId,
      user_selected: false,
    })),
    project: 'demo-project',
    root_asset_id: nodeIds[0] || '',
    selected: [],
    selection: null,
    selections: [],
  };
}
