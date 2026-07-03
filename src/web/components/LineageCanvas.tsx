import { Background, Controls, MiniMap, ReactFlow, type Edge, type EdgeChange, type NodeChange, type ReactFlowInstance } from '@xyflow/react';
import type { LineageNode } from '../../shared/types';
import { AssetNode, type AssetFlowNode } from './LineageAssetNode';
import './LineageCanvas.css';

const nodeTypes = { assetNode: AssetNode };

export function LineageCanvas({
  activeNode,
  flowEdges,
  flowNodes,
  graphKey,
  inspectingId,
  loading,
  onSeedDemo,
  onEdgesChange,
  onIndexNow,
  onNewLineage,
  onClearFocus,
  onNodeActionMenu,
  onNodeInspect,
  onNodeOpenDetail,
  onNodePosition,
  onNodesChange,
  onReady,
  onSelectedAsset,
  onViewportInteraction,
  showCanvasStatus,
  workspaceRootAssetId,
}: {
  activeNode?: LineageNode;
  flowEdges: Edge[];
  flowNodes: AssetFlowNode[];
  graphKey: string;
  inspectingId: string;
  loading: boolean;
  onSeedDemo: () => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onIndexNow: () => void;
  onNewLineage: () => void;
  onClearFocus: () => void;
  onNodeActionMenu: (assetId: string, x: number, y: number) => void;
  onNodeInspect: (assetId: string | null) => void;
  onNodeOpenDetail: (assetId: string) => void;
  onNodePosition: (node: AssetFlowNode) => void;
  onNodesChange: (changes: NodeChange<AssetFlowNode>[]) => void;
  onReady: (instance: ReactFlowInstance<AssetFlowNode, Edge>) => void;
  onSelectedAsset: (assetId: string) => void;
  onViewportInteraction: () => void;
  showCanvasStatus: boolean;
  workspaceRootAssetId: string;
}) {
  if (!flowNodes.length) {
    return (
      <div className="lineage-empty-state">
        <strong>{workspaceRootAssetId ? 'No lineage index yet' : 'Start a lineage'}</strong>
        <p>{workspaceRootAssetId ? 'Index local/catalog assets to inspect this tree.' : 'Search local and catalog assets, choose a root, and name the iteration tree.'}</p>
        {workspaceRootAssetId ? (
          <button className="primary-button" disabled={loading} onClick={onIndexNow}>Index now</button>
        ) : (
          <div className="lineage-empty-actions">
            <button className="primary-button" onClick={onNewLineage}>New lineage</button>
            <button className="secondary-button" disabled={loading} onClick={onSeedDemo}>Load demo lineage</button>
          </div>
        )}
      </div>
    );
  }
  const interactiveNodes = flowNodes.map(node => ({ ...node, data: { ...node.data, onOpenDetail: onNodeOpenDetail } }));

  return (
    <>
      {showCanvasStatus && activeNode && (
        <div className="lineage-canvas-status" data-testid="lineage-canvas-status">
          <div className="lineage-canvas-status-head">
            <span>Inspecting</span>
            <button aria-label="Dismiss inspecting card" onClick={() => onNodeInspect(null)} type="button">×</button>
          </div>
          <strong data-testid="lineage-inspecting-title">{activeNode.title}</strong><code data-testid="lineage-inspecting-asset-id">{inspectingId}</code>
          <button data-testid="lineage-open-detail" onClick={() => onNodeOpenDetail(activeNode.asset_id)}>Open detail</button>
          <button data-testid="lineage-show-all" onClick={onClearFocus}>Show all</button>
          <button data-testid="lineage-node-actions" onClick={event => onNodeActionMenu(activeNode.asset_id, event.clientX, event.clientY)}>Actions</button>
        </div>
      )}
      <ReactFlow<AssetFlowNode, Edge>
        defaultViewport={{ x: 80, y: 120, zoom: 0.82 }} edges={flowEdges} nodes={interactiveNodes} nodeTypes={nodeTypes}
        deleteKeyCode={null}
        key={graphKey}
        minZoom={0.3}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_event, node) => { onNodeActionMenu('', 0, 0); onNodeInspect(node.id); onSelectedAsset(node.id); }}
        onNodeContextMenu={(event, node) => { event.preventDefault(); onNodeInspect(node.id); onNodeActionMenu(node.id, event.clientX, event.clientY); onSelectedAsset(node.id); }}
        onNodeDoubleClick={(_event, node) => { onNodeInspect(node.id); onNodeOpenDetail(node.id); onSelectedAsset(node.id); }}
        onNodeDragStop={(_event, node) => onNodePosition(node)}
        onNodesChange={onNodesChange}
        onInit={onReady}
        onMoveStart={onViewportInteraction}
        onPaneClick={onClearFocus}
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </>
  );
}
