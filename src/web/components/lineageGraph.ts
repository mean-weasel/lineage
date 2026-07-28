import { MarkerType, Position, type Edge } from '@xyflow/react';
import { graphlib, layout } from '@dagrejs/dagre';
import type { LineageSnapshot } from '../../shared/types';
import type { AssetFlowNode, LineageCanvasPresentation, LineageFocusRole } from './LineageAssetNode';

const nodeSizes: Record<LineageCanvasPresentation, { height: number; width: number }> = {
  compact: { height: 164, width: 212 },
  portrait: { height: 400, width: 224 },
};

export type LineageGraphDirection = 'BT' | 'LR' | 'RL' | 'TB';

export function toGraph(
  snapshot: LineageSnapshot | null,
  activeNodeId: string | null,
  direction: LineageGraphDirection = 'LR',
  edgeSummariesVisible = true,
  canvasPresentation: LineageCanvasPresentation = 'compact',
): { nodes: AssetFlowNode[]; edges: Edge[] } {
  if (!snapshot) return { nodes: [], edges: [] };
  const nodeSize = nodeSizes[canvasPresentation];
  const tidyPositions = layoutLineageTree(snapshot, direction, canvasPresentation);
  const handlePositions = lineageHandlePositions(direction);
  const focus = lineageFocus(snapshot, activeNodeId);
  const nodes = snapshot.nodes.map(node => {
    return {
      id: node.asset_id,
      initialHeight: nodeSize.height,
      initialWidth: nodeSize.width,
      measured: nodeSize,
      type: 'assetNode' as const,
      height: nodeSize.height,
      position: (canvasPresentation === 'compact' ? node.position : undefined) || tidyPositions.get(node.asset_id) || { x: 0, y: 0 },
      sourcePosition: handlePositions.source,
      targetPosition: handlePositions.target,
      width: nodeSize.width,
      data: {
        ...node,
        active: node.asset_id === activeNodeId,
        canvasPresentation,
        focusRole: focus.roles.get(node.asset_id) || 'none',
        root: node.asset_id === snapshot.root_asset_id,
        sourcePosition: handlePositions.source,
        targetPosition: handlePositions.target,
      },
    };
  });
  const nodeTitles = new Map(snapshot.nodes.map(node => [node.asset_id, node.title]));
  const edges = snapshot.edges.map(edge => {
    const summaryClass = edge.summary ? 'lineage-edge-summary' : '';
    const className = [focus.edgeClasses.get(edge.id), summaryClass].filter(Boolean).join(' ') || undefined;
    const relationship = `${nodeTitles.get(edge.parent_asset_id) || edge.parent_asset_id} to ${nodeTitles.get(edge.child_asset_id) || edge.child_asset_id}`;
    return {
      ariaLabel: edge.summary ? `${relationship}: ${edge.summary}` : relationship,
      ariaRole: 'button',
      className,
      domAttributes: { 'aria-keyshortcuts': 'Enter Space' },
      focusable: true,
      id: edge.id,
      markerEnd: { type: MarkerType.ArrowClosed },
      source: edge.parent_asset_id,
      target: edge.child_asset_id,
      type: 'smoothstep',
      animated: snapshot.selected.includes(edge.child_asset_id),
      ...(edge.summary && edgeSummariesVisible ? {
        label: edge.summary,
        labelBgBorderRadius: 4,
        labelBgPadding: [5, 3] as [number, number],
        labelShowBg: true,
      } : {}),
    } satisfies Edge;
  });
  return { nodes, edges };
}

function lineageHandlePositions(direction: LineageGraphDirection): { source: Position; target: Position } {
  return {
    BT: { source: Position.Top, target: Position.Bottom },
    LR: { source: Position.Right, target: Position.Left },
    RL: { source: Position.Left, target: Position.Right },
    TB: { source: Position.Bottom, target: Position.Top },
  }[direction];
}

export function lineageGraphKey(
  snapshot: LineageSnapshot | null,
  direction: LineageGraphDirection = 'LR',
  canvasPresentation: LineageCanvasPresentation = 'compact',
): string {
  if (!snapshot) return 'lineage-empty';
  const nodeIds = snapshot.nodes.map(node => node.asset_id).sort().join(',');
  const edgeIds = snapshot.edges.map(edge => edge.id).sort().join(',');
  return `${snapshot.root_asset_id}:${direction}:${canvasPresentation}:${nodeIds}:${edgeIds}`;
}

export function lineageFocus(snapshot: LineageSnapshot, activeNodeId: string | null): { edgeClasses: Map<string, string>; roles: Map<string, LineageFocusRole> } {
  const roles = new Map<string, LineageFocusRole>();
  const edgeClasses = new Map<string, string>();
  if (!activeNodeId || !snapshot.nodes.some(node => node.asset_id === activeNodeId)) return { edgeClasses, roles };

  roles.set(activeNodeId, 'active');
  for (const edge of snapshot.edges) {
    if (edge.child_asset_id === activeNodeId) {
      if (!roles.has(edge.parent_asset_id)) roles.set(edge.parent_asset_id, 'parent');
      edgeClasses.set(edge.id, 'lineage-edge-focus lineage-edge-focus-parent');
    }
    if (edge.parent_asset_id === activeNodeId) {
      if (!roles.has(edge.child_asset_id)) roles.set(edge.child_asset_id, 'child');
      edgeClasses.set(edge.id, 'lineage-edge-focus lineage-edge-focus-child');
    }
  }
  return { edgeClasses, roles };
}

export function layoutLineageTree(
  snapshot: LineageSnapshot,
  direction: LineageGraphDirection = 'LR',
  canvasPresentation: LineageCanvasPresentation = 'compact',
): Map<string, { x: number; y: number }> {
  const nodeSize = nodeSizes[canvasPresentation];
  const graph = new graphlib.Graph();
  graph.setGraph({
    marginx: 40,
    marginy: 40,
    nodesep: 80,
    rankdir: direction,
    ranksep: 110,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of snapshot.nodes) graph.setNode(node.asset_id, { ...nodeSize });
  for (const edge of snapshot.edges) graph.setEdge(edge.parent_asset_id, edge.child_asset_id);
  layout(graph);
  return new Map(snapshot.nodes.map(node => {
    const laidOut = graph.node(node.asset_id) as { x?: number; y?: number } | undefined;
    return [node.asset_id, {
      x: Math.round((laidOut?.x || nodeSize.width / 2) - nodeSize.width / 2),
      y: Math.round((laidOut?.y || nodeSize.height / 2) - nodeSize.height / 2),
    }];
  }));
}
