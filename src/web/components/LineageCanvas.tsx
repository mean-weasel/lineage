import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Background, Controls, MiniMap, ReactFlow, type Edge, type EdgeChange, type NodeChange, type ReactFlowInstance } from '@xyflow/react';
import type { LineageNode } from '../../shared/types';
import { AssetNode, type AssetFlowNode, type LineagePreviewSource } from './LineageAssetNode';
import type { HoverPreviewPosition } from './lineageHoverPreview';
import './LineageCanvas.css';

const nodeTypes = { assetNode: AssetNode };

type PreviewTarget = { assetId: string; position: HoverPreviewPosition };
type PreviewState = {
  activeSource: LineagePreviewSource | null;
  focus: PreviewTarget | null;
  hover: PreviewTarget | null;
};

const emptyPreviewState: PreviewState = { activeSource: null, focus: null, hover: null };

export function LineageCanvas({
  activeNode,
  flowEdges,
  flowNodes,
  graphKey,
  hoverPreviewsEnabled,
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
  onNodeOpenHistory,
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
  hoverPreviewsEnabled: boolean;
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
  onNodeOpenHistory: (assetId: string) => void;
  onNodePosition: (node: AssetFlowNode) => void;
  onNodesChange: (changes: NodeChange<AssetFlowNode>[]) => void;
  onReady: (instance: ReactFlowInstance<AssetFlowNode, Edge>) => void;
  onSelectedAsset: (assetId: string) => void;
  onViewportInteraction: () => void;
  showCanvasStatus: boolean;
  workspaceRootAssetId: string;
}) {
  const [previews, setPreviews] = useState<PreviewState>(emptyPreviewState);
  const dismissPreview = useCallback(() => setPreviews(emptyPreviewState), []);
  const changePreview = useCallback((source: LineagePreviewSource, assetId: string, position: HoverPreviewPosition | null) => {
    setPreviews(current => {
      if (position) return { ...current, activeSource: source, [source]: { assetId, position } };
      if (current[source]?.assetId !== assetId) return current;
      const next = { ...current, [source]: null };
      const otherSource = source === 'hover' ? 'focus' : 'hover';
      return {
        ...next,
        activeSource: current.activeSource === source ? (next[otherSource] ? otherSource : null) : current.activeSource,
      };
    });
  }, []);
  useEffect(() => dismissPreview(), [dismissPreview, graphKey]);
  const openDetail = useCallback((assetId: string) => {
    dismissPreview();
    onNodeOpenDetail(assetId);
  }, [dismissPreview, onNodeOpenDetail]);
  const openHistory = useCallback((assetId: string) => {
    dismissPreview();
    onNodeOpenHistory(assetId);
  }, [dismissPreview, onNodeOpenHistory]);
  const openNodeActionMenu = useCallback((assetId: string, x: number, y: number) => {
    dismissPreview();
    onNodeActionMenu(assetId, x, y);
  }, [dismissPreview, onNodeActionMenu]);
  const interactiveNodes = useMemo(() => flowNodes.map(node => ({
    ...node,
    data: {
      ...node.data,
      hoverPreviewsEnabled,
      onOpenDetail: openDetail,
      onOpenHistory: openHistory,
      onPreviewChange: hoverPreviewsEnabled ? changePreview : undefined,
      onPreviewDismiss: dismissPreview,
    },
  })), [changePreview, dismissPreview, flowNodes, hoverPreviewsEnabled, openDetail, openHistory]);

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
  const activePreview = hoverPreviewsEnabled && previews.activeSource ? previews[previews.activeSource] : null;
  const previewNode = activePreview ? flowNodes.find(node => node.id === activePreview.assetId)?.data : undefined;

  return (
    <>
      {showCanvasStatus && activeNode && (
        <div className="lineage-canvas-status" data-testid="lineage-canvas-status">
          <div className="lineage-canvas-status-head">
            <span>Inspecting</span>
            <button aria-label="Dismiss inspecting card" onClick={() => onNodeInspect(null)} type="button">×</button>
          </div>
          <div className="lineage-canvas-status-preview">
            {activeNode.preview_url && (activeNode.media_type === 'image' || activeNode.media_type === 'gif') ? (
              <img alt="" src={activeNode.preview_url} />
            ) : activeNode.preview_url && activeNode.media_type === 'video' ? (
              <video muted src={activeNode.preview_url} />
            ) : (
              <span>{activeNode.media_type}</span>
            )}
          </div>
          <strong data-testid="lineage-inspecting-title">{activeNode.title}</strong><code data-testid="lineage-inspecting-asset-id">{inspectingId}</code>
          <button data-testid="lineage-open-detail" onClick={() => onNodeOpenDetail(activeNode.asset_id)}>Open detail</button>
          <button data-testid="lineage-show-all" onClick={onClearFocus}>Show all</button>
          <button data-testid="lineage-node-actions" onClick={event => openNodeActionMenu(activeNode.asset_id, event.clientX, event.clientY)}>Actions</button>
        </div>
      )}
      {activePreview && previewNode && createPortal(
        <div
          aria-hidden="true"
          className="lineage-hover-preview"
          data-testid="lineage-hover-preview"
          style={{ left: activePreview.position.left, top: activePreview.position.top }}
        >
          <div className="lineage-hover-preview-media">
            {previewNode.preview_url && (previewNode.media_type === 'image' || previewNode.media_type === 'gif') ? (
              <img alt="" src={previewNode.preview_url} />
            ) : previewNode.preview_url && previewNode.media_type === 'video' ? (
              <video autoPlay loop muted playsInline preload="metadata" src={previewNode.preview_url} />
            ) : (
              <span>{previewNode.media_type} preview unavailable</span>
            )}
          </div>
          <strong>{previewNode.title}</strong>
          <span>{(previewNode.attempt_count || 1) > 1 ? 'Double-click for attempt history' : 'Double-click for full details'}</span>
        </div>,
        document.body,
      )}
      <ReactFlow<AssetFlowNode, Edge>
        defaultViewport={{ x: 80, y: 120, zoom: 0.82 }} edges={flowEdges} nodes={interactiveNodes} nodeTypes={nodeTypes}
        deleteKeyCode={null}
        key={graphKey}
        minZoom={0.3}
        nodesFocusable={false}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_event, node) => { onNodeActionMenu('', 0, 0); onNodeInspect(node.id); onSelectedAsset(node.id); }}
        onNodeContextMenu={(event, node) => { event.preventDefault(); onNodeInspect(node.id); openNodeActionMenu(node.id, event.clientX, event.clientY); onSelectedAsset(node.id); }}
        onNodeDoubleClick={(_event, node) => {
          dismissPreview();
          onNodeInspect(node.id);
          if ((node.data.attempt_count || 1) > 1) onNodeOpenHistory(node.id);
          else onNodeOpenDetail(node.id);
          onSelectedAsset(node.id);
        }}
        onNodeDragStart={dismissPreview}
        onNodeDragStop={(_event, node) => onNodePosition(node)}
        onNodesChange={onNodesChange}
        onInit={onReady}
        onMoveStart={() => { dismissPreview(); onViewportInteraction(); }}
        onPaneClick={onClearFocus}
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </>
  );
}
