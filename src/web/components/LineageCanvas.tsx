import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Background, Controls, MiniMap, ReactFlow, type Edge, type EdgeChange, type NodeChange, type ReactFlowInstance } from '@xyflow/react';
import type { LineageNode, LineageTask } from '../../shared/types';
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
  flowEdges,
  flowNodes,
  graphKey,
  hoverPreviewsEnabled,
  loading,
  onSeedDemo,
  onEdgesChange,
  onEdgeEdit,
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
  onToggleBranch,
  onToggleReroll,
  onViewportInteraction,
  selectionFull,
  workspaceRootAssetId,
}: {
  flowEdges: Edge[];
  flowNodes: AssetFlowNode[];
  graphKey: string;
  hoverPreviewsEnabled: boolean;
  loading: boolean;
  onSeedDemo: () => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onEdgeEdit: (edgeId: string, trigger: HTMLElement | SVGElement | null) => void;
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
  onToggleBranch: (node: LineageNode) => Promise<void> | void;
  onToggleReroll: (node: LineageNode) => Promise<void> | void;
  onViewportInteraction: () => void;
  selectionFull: boolean;
  workspaceRootAssetId: string;
}) {
  const [previews, setPreviews] = useState<PreviewState>(emptyPreviewState);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const pendingActionRef = useRef(false);
  const previewCloseTimer = useRef<number | null>(null);
  const cancelPreviewClose = useCallback(() => {
    if (previewCloseTimer.current === null) return;
    window.clearTimeout(previewCloseTimer.current);
    previewCloseTimer.current = null;
  }, []);
  const dismissPreview = useCallback(() => {
    cancelPreviewClose();
    setPreviews(emptyPreviewState);
  }, [cancelPreviewClose]);
  const schedulePreviewClose = useCallback((action: () => void) => {
    cancelPreviewClose();
    previewCloseTimer.current = window.setTimeout(() => {
      previewCloseTimer.current = null;
      action();
    }, 180);
  }, [cancelPreviewClose]);
  const changePreview = useCallback((source: LineagePreviewSource, assetId: string, position: HoverPreviewPosition | null) => {
    const update = () => setPreviews(current => {
      if (position) return { ...current, activeSource: source, [source]: { assetId, position } };
      if (current[source]?.assetId !== assetId) return current;
      const next = { ...current, [source]: null };
      const otherSource = source === 'hover' ? 'focus' : 'hover';
      return {
        ...next,
        activeSource: current.activeSource === source ? (next[otherSource] ? otherSource : null) : current.activeSource,
      };
    });
    if (position) {
      cancelPreviewClose();
      update();
      return;
    }
    schedulePreviewClose(update);
  }, [cancelPreviewClose, schedulePreviewClose]);
  useEffect(() => dismissPreview(), [dismissPreview, graphKey]);
  useEffect(() => () => cancelPreviewClose(), [cancelPreviewClose]);
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
  const runQuickAction = useCallback(async (action: 'branch' | 'reroll', node: LineageNode) => {
    const actionId = `${action}:${node.asset_id}`;
    if (pendingActionRef.current) return;
    pendingActionRef.current = true;
    setPendingAction(actionId);
    try {
      if (action === 'branch') await onToggleBranch(node);
      else await onToggleReroll(node);
    } finally {
      pendingActionRef.current = false;
      setPendingAction(null);
    }
  }, [onToggleBranch, onToggleReroll]);
  const interactiveNodes = useMemo(() => flowNodes.map(node => ({
    ...node,
    data: {
      ...node.data,
      hoverPreviewsEnabled,
      onOpenDetail: openDetail,
      onOpenHistory: openHistory,
      onPreviewChange: hoverPreviewsEnabled ? changePreview : undefined,
      onPreviewDismiss: dismissPreview,
      onToggleBranch: (target: LineageNode) => {
        if (quickActionState(target, selectionFull).branchDisabled) return;
        void runQuickAction('branch', target);
      },
      onToggleReroll: (target: LineageNode) => {
        if (quickActionState(target, selectionFull).rerollDisabled) return;
        void runQuickAction('reroll', target);
      },
    },
  })), [changePreview, dismissPreview, flowNodes, hoverPreviewsEnabled, openDetail, openHistory, runQuickAction, selectionFull]);

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
  const actionState = previewNode ? quickActionState(previewNode, selectionFull) : null;
  const editFocusedEdge = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target instanceof Element ? event.target.closest<SVGElement>('.react-flow__edge') : null;
    const edgeId = target?.dataset.id;
    if (!edgeId || !flowEdges.some(edge => edge.id === edgeId)) return;
    event.preventDefault();
    event.stopPropagation();
    dismissPreview();
    onEdgeEdit(edgeId, target);
  };

  return (
    <>
      {activePreview && previewNode && actionState && createPortal(
        <section
          aria-label={`Quick actions for ${previewNode.title}`}
          className="lineage-hover-preview"
          data-testid="lineage-hover-preview"
          onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) schedulePreviewClose(dismissPreview);
          }}
          onKeyDown={event => {
            const key = event.key.toLowerCase();
            if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            if (key === 'b' && !actionState.branchDisabled) {
              event.preventDefault();
              void runQuickAction('branch', previewNode);
            }
            if (key === 'r' && !actionState.rerollDisabled) {
              event.preventDefault();
              void runQuickAction('reroll', previewNode);
            }
            if (key === 'd') {
              event.preventDefault();
              openDetail(previewNode.asset_id);
            }
          }}
          onMouseEnter={cancelPreviewClose}
          onMouseLeave={event => {
            if (previews.activeSource === 'hover' && !event.currentTarget.contains(document.activeElement)) {
              changePreview('hover', previewNode.asset_id, null);
            }
          }}
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
          <div className="lineage-hover-preview-copy">
            <strong>{previewNode.title}</strong>
            <code>{previewNode.asset_id}</code>
          </div>
          <div className="lineage-hover-preview-actions">
            <button
              aria-keyshortcuts="B"
              aria-pressed={previewNode.user_selected}
              className={previewNode.user_selected ? 'selected' : ''}
              disabled={actionState.branchDisabled || Boolean(pendingAction)}
              onClick={() => void runQuickAction('branch', previewNode)}
              title={actionState.branchTitle}
              type="button"
            >
              <kbd>B</kbd><span>{previewNode.user_selected ? 'Branch queued' : 'Branch'}</span>
            </button>
            <button
              aria-keyshortcuts="R"
              aria-pressed={actionState.rerollSelected}
              className={`reroll ${actionState.rerollSelected ? 'selected' : ''}`}
              disabled={actionState.rerollDisabled || Boolean(pendingAction)}
              onClick={() => void runQuickAction('reroll', previewNode)}
              title={actionState.rerollTitle}
              type="button"
            >
              <kbd>R</kbd><span>{actionState.rerollSelected ? 'Re-roll queued' : 'Re-roll'}</span>
            </button>
            <button aria-keyshortcuts="D" onClick={() => openDetail(previewNode.asset_id)} type="button"><kbd>D</kbd><span>Details</span></button>
          </div>
          {(actionState.branchLocked || actionState.rerollLocked) && <p className="lineage-hover-preview-lock">Active work is managed in the task queue.</p>}
        </section>,
        document.body,
      )}
      <ReactFlow<AssetFlowNode, Edge>
        defaultViewport={{ x: 80, y: 120, zoom: 0.82 }} edges={flowEdges} nodes={interactiveNodes} nodeTypes={nodeTypes}
        deleteKeyCode={null}
        key={graphKey}
        minZoom={0.3}
        nodesFocusable={false}
        onEdgeDoubleClick={(event, edge) => {
          event.preventDefault();
          dismissPreview();
          onEdgeEdit(edge.id, event.currentTarget as SVGElement);
        }}
        onEdgesChange={onEdgesChange}
        onKeyDownCapture={editFocusedEdge}
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

function quickActionState(node: LineageNode, selectionFull: boolean) {
  const branchLocked = taskIsLocked(node.lineage_tasks?.iterate);
  const rerollLocked = taskIsLocked(node.lineage_tasks?.reroll);
  const rerollSelected = node.reroll_request?.status === 'pending';
  return {
    branchDisabled: branchLocked || (!node.user_selected && selectionFull),
    branchLocked,
    branchTitle: branchLocked
      ? 'An agent is working on this branch task. Manage it in the task queue.'
      : !node.user_selected && selectionFull
        ? 'The branch selection is full.'
        : node.user_selected ? 'Remove from the next branch (B)' : 'Use as a base for the next branch (B)',
    rerollDisabled: rerollLocked,
    rerollLocked,
    rerollSelected,
    rerollTitle: rerollLocked
      ? 'An agent is working on this re-roll. Manage it in the task queue.'
      : rerollSelected ? 'Remove from the re-roll queue (R)' : 'Add to the re-roll queue (R)',
  };
}

function taskIsLocked(task?: LineageTask): boolean {
  return task?.status === 'claimed' || task?.status === 'in_progress';
}
