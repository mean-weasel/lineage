import type { Edge } from '@xyflow/react';
import type { LineageEdge, LineageSnapshot } from '../../shared/types';
import type { AssetFlowNode } from './LineageAssetNode';

export type LineageReplayPhase = 'edge' | 'node' | 'settled';
type LineageReplayNodeState = 'entering' | 'future' | 'visible';
type LineageReplayEdgeState = 'entering' | 'future' | 'visible';

interface LineageReplayStage {
  edgeIds: string[];
  enteringEdgeIds: string[];
  enteringNodeIds: string[];
  index: number;
  nodeIds: string[];
}

export interface LineageReplayTimeline {
  stages: LineageReplayStage[];
}

export interface LineageReplayProjection {
  edgeStates: Map<string, LineageReplayEdgeState>;
  interactive: boolean;
  nodeStates: Map<string, LineageReplayNodeState>;
}

export function isLineageReplayable(snapshot: LineageSnapshot | null): boolean {
  return Boolean(snapshot && snapshot.nodes.length > 1 && snapshot.edges.length > 0);
}

export function buildLineageReplayTimeline(snapshot: LineageSnapshot): LineageReplayTimeline {
  const nodeIds = new Set(snapshot.nodes.map(node => node.asset_id));
  if (nodeIds.size === 0) return { stages: [] };

  const orderedNodeIds = [...nodeIds].sort(compareText);
  const rootId = nodeIds.has(snapshot.root_asset_id) ? snapshot.root_asset_id : orderedNodeIds[0];
  const visibleNodes = new Set([rootId]);
  const visibleEdges = new Set<string>();
  const pendingEdges = snapshot.edges
    .filter(edge => nodeIds.has(edge.parent_asset_id) && nodeIds.has(edge.child_asset_id))
    .sort(compareEdges);
  const stages: LineageReplayStage[] = [stage(0, visibleNodes, visibleEdges, [rootId], [])];

  while (visibleNodes.size < nodeIds.size || pendingEdges.length > 0) {
    const eligibleIndex = pendingEdges.findIndex(edge => visibleNodes.has(edge.parent_asset_id));
    if (eligibleIndex >= 0) {
      const [edge] = pendingEdges.splice(eligibleIndex, 1);
      visibleEdges.add(edge.id);
      const enteringNodeIds = visibleNodes.has(edge.child_asset_id) ? [] : [edge.child_asset_id];
      visibleNodes.add(edge.child_asset_id);
      stages.push(stage(stages.length, visibleNodes, visibleEdges, enteringNodeIds, [edge.id]));
      continue;
    }

    const disconnectedNode = orderedNodeIds.find(nodeId => !visibleNodes.has(nodeId));
    if (disconnectedNode) {
      visibleNodes.add(disconnectedNode);
      stages.push(stage(stages.length, visibleNodes, visibleEdges, [disconnectedNode], []));
      continue;
    }

    break;
  }

  return { stages };
}

export function projectLineageReplay(
  nodes: AssetFlowNode[],
  edges: Edge[],
  timeline: LineageReplayTimeline,
  settledStageIndex: number,
  phase: LineageReplayPhase,
): { nodes: AssetFlowNode[]; edges: Edge[]; projection: LineageReplayProjection } {
  const stages = timeline.stages;
  const lastIndex = stages.length - 1;
  const safeSettledIndex = Math.max(-1, Math.min(settledStageIndex, lastIndex));
  const settled = safeSettledIndex >= 0 ? stages[safeSettledIndex] : undefined;
  const next = safeSettledIndex < lastIndex ? stages[safeSettledIndex + 1] : undefined;
  const visibleNodeIds = new Set(settled?.nodeIds || []);
  const visibleEdgeIds = new Set(settled?.edgeIds || []);
  const enteringNodeIds = new Set<string>();
  const enteringEdgeIds = new Set<string>();

  if (next && (phase === 'edge' || phase === 'node')) {
    for (const edgeId of next.enteringEdgeIds) {
      if (phase === 'edge') enteringEdgeIds.add(edgeId);
      else visibleEdgeIds.add(edgeId);
    }
  }
  if (next && phase === 'node') {
    for (const nodeId of next.enteringNodeIds) enteringNodeIds.add(nodeId);
  }

  const interactive = safeSettledIndex === lastIndex && phase === 'settled';
  const nodeStates = new Map(nodes.map(node => [node.id, enteringNodeIds.has(node.id)
    ? 'entering'
    : visibleNodeIds.has(node.id)
      ? 'visible'
      : 'future'] as const));
  const edgeStates = new Map(edges.map(edge => [edge.id, enteringEdgeIds.has(edge.id)
    ? 'entering'
    : visibleEdgeIds.has(edge.id)
      ? 'visible'
      : 'future'] as const));

  return {
    nodes: nodes.map(node => ({
      ...node,
      data: {
        ...node.data,
        replayInteractive: interactive,
        replayState: nodeStates.get(node.id) || 'future',
      },
    })),
    edges: edges.map(edge => {
      const replayState = edgeStates.get(edge.id) || 'future';
      return {
        ...edge,
        className: [edge.className, `lineage-edge-replay-${replayState}`].filter(Boolean).join(' '),
        domAttributes: {
          ...edge.domAttributes,
          'aria-hidden': replayState === 'future' ? true : undefined,
        },
        focusable: interactive ? edge.focusable : false,
      };
    }),
    projection: { edgeStates, interactive, nodeStates },
  };
}

function stage(
  index: number,
  nodeIds: Set<string>,
  edgeIds: Set<string>,
  enteringNodeIds: string[],
  enteringEdgeIds: string[],
): LineageReplayStage {
  return {
    edgeIds: [...edgeIds],
    enteringEdgeIds,
    enteringNodeIds,
    index,
    nodeIds: [...nodeIds],
  };
}

function compareEdges(left: LineageEdge, right: LineageEdge): number {
  return compareText(left.created_at || '', right.created_at || '') || compareText(left.id, right.id);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right);
}
