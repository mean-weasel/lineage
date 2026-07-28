import { type CSSProperties, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type Edge, type EdgeChange, type ReactFlowInstance, useEdgesState, useNodesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './LineageView.css';
import './LineageFocus.css';
import type { AgentClaimsResponse, AgentClaimSummary, AssetReviewState, GrowthAsset, LineageAttempt, LineageAttemptPromotionResponse, LineageAttemptsResponse, LineageBriefResponse, LineageEdgeSummaryMutationResponse, LineageIndexSummary, LineageNode, LineageSnapshot } from '../../shared/types';
import type { GenerationJob, GenerationJobListResponse } from '../../shared/generationTypes';
import { api, ApiError } from '../api';
import {
  readHoverPreviewsEnabled,
  readLineageCanvasPresentation,
  readLineageEdgeLabelsVisible,
  readLineageEdgeWeight,
  readLineageGraphDirection,
  resetLineageAppearancePreferences,
  writeHoverPreviewsEnabled,
  writeLineageCanvasPresentation,
  writeLineageEdgeLabelsVisible,
  writeLineageEdgeWeight,
  writeLineageGraphDirection,
  type LineageEdgeWeight,
} from '../lineagePreferences';
import type { AssetFlowNode, LineageCanvasPresentation } from './LineageAssetNode';
import { LineageCanvas, type LineageWorkspaceProgress } from './LineageCanvas';
import { LineageCanvasAppearanceControls } from './LineageCanvasAppearanceControls';
import { LineageContextMenu } from './LineageContextMenu';
import { activeNodeIdAfterRefresh } from './lineageRefreshState';
import { LineageAttemptHistoryModal } from './LineageAttemptHistoryModal';
import { LineageDetailModal } from './LineageDetailModal';
import { LineageEdgeSummaryDialog, type EdgeSummaryEditAction } from './LineageEdgeSummaryDialog';
import { LineageNewWorkspaceModal } from './LineageNewWorkspaceModal';
import { LineageReplayControls } from './LineageReplayControls';
import { LineageSidePanel } from './LineageSidePanel';
import { LineageToolbar } from './LineageToolbar';
import { LineageGenerationSheet } from './LineageGenerationSheet';
import { decorateSnapshotWithGenerationTargets } from './LineageGenerationTargets';
import { NodeNextOutputTargetsEditor } from './NodeNextOutputTargets';
import { loadNodeNextOutputTargets, type NodeNextOutputTargetsResponse } from './NodeNextOutputTargetsModel';
import { OutputTargetPreferencesDialog } from './OutputTargetPreferencesDialog';
import { saveLineagePositions } from './lineageLayoutApi';
import { reconcileAuthoritativeEdgeChanges } from './lineageEdgeState';
import { lineageReviewConflict } from './lineageReviewConflict';
import { layoutLineageTree, lineageGraphKey, toGraph, type LineageGraphDirection } from './lineageGraph';
import { buildLineageReplayTimeline, isLineageReplayable, projectLineageReplay, type LineageReplayPhase } from './lineageReplay';
import { useEscapeClear } from './useEscapeClear';
import { useLineageWorkspaces } from './useLineageWorkspaces';
import { useLineageViewportFit } from './useLineageViewportFit';

// eslint-disable-next-line react-refresh/only-export-components -- pure URL contract shared with regression tests
export function lineageCanvasPresentationFromSearch(
  search: string,
  fallback: LineageCanvasPresentation = 'compact',
): LineageCanvasPresentation {
  const requested = new URLSearchParams(search).get('lineageCanvas');
  return requested === 'portrait' || requested === 'compact' ? requested : fallback;
}

export function LineageView({ asset, onAssetsChanged, project, onSelectedAsset, onToast }: {
  asset?: GrowthAsset; onAssetsChanged?: () => Promise<void> | void; project: string; onSelectedAsset: (assetId: string) => void; onToast: (type: 'ok' | 'error', message: string) => void;
}) {
  const [canvasPresentation, setCanvasPresentation] = useState<LineageCanvasPresentation>(() =>
    lineageCanvasPresentationFromSearch(
      typeof window === 'undefined' ? '' : window.location.search,
      readLineageCanvasPresentation(),
    ));
  const [snapshot, setSnapshot] = useState<LineageSnapshot | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [childAssetId, setChildAssetId] = useState('');
  const [detailNodeId, setDetailNodeId] = useState<string | null>(null);
  const [targetNodeId, setTargetNodeId] = useState<string | null>(null);
  const [historyNodeId, setHistoryNodeId] = useState<string | null>(null);
  const [historyAttempts, setHistoryAttempts] = useState<LineageAttempt[]>([]);
  const [hoverPreviewsEnabled, setHoverPreviewsEnabled] = useState(readHoverPreviewsEnabled);
  const [brief, setBrief] = useState<LineageBriefResponse | null>(null);
  const [claims, setClaims] = useState<AgentClaimSummary[]>([]);
  const [edgeSummariesVisible, setEdgeSummariesVisible] = useState(readLineageEdgeLabelsVisible);
  const [edgeWeight, setEdgeWeight] = useState<LineageEdgeWeight>(readLineageEdgeWeight);
  const [edgeEditor, setEdgeEditor] = useState<{ edgeId: string; returnFocus: HTMLElement | SVGElement | null } | null>(null);
  const [compactGraphDirection, setCompactGraphDirection] = useState<LineageGraphDirection>(() => readLineageGraphDirection('compact'));
  const [portraitGraphDirection, setPortraitGraphDirection] = useState<LineageGraphDirection>(() => readLineageGraphDirection('portrait'));
  const [selectionNote, setSelectionNote] = useState('');
  const [nodeMenu, setNodeMenu] = useState<{ assetId: string; x: number; y: number } | null>(null);
  const [newLineageOpen, setNewLineageOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<'settings' | 'selection' | 'asset' | null>(null);
  const [canvasToolsHost, setCanvasToolsHost] = useState<HTMLElement | null>(null);
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<AssetFlowNode>([]);
  const [flowEdges, setFlowEdges] = useEdgesState<Edge>([]);
  const [flowApi, setFlowApi] = useState<ReactFlowInstance<AssetFlowNode, Edge> | null>(null);
  const [loading, setLoading] = useState(false);
  const [generationJobs, setGenerationJobs] = useState<GenerationJob[]>([]);
  const [nodeTargetStates, setNodeTargetStates] = useState<Record<string, NodeNextOutputTargetsResponse>>({});
  const [generationOpen, setGenerationOpen] = useState(false);
  const [outputDefaultsOpen, setOutputDefaultsOpen] = useState(false);
  const [workspaceProgress, setWorkspaceProgress] = useState<LineageWorkspaceProgress>(null);
  const indexingRefreshStarted = useRef(false);
  const [menuCloseSignal, setMenuCloseSignal] = useState(0);
  const [replaySnapshot, setReplaySnapshot] = useState<LineageSnapshot | null>(null);
  const [replayStageIndex, setReplayStageIndex] = useState(-1);
  const [replayPhase, setReplayPhase] = useState<LineageReplayPhase>('settled');
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [reduceReplayMotion, setReduceReplayMotion] = useState(false);
  const replayTimeline = useMemo(
    () => replaySnapshot ? buildLineageReplayTimeline(replaySnapshot) : { stages: [] },
    [replaySnapshot],
  );
  const replayLastStage = replayTimeline.stages.length - 1;
  const replayAtEnd = Boolean(replaySnapshot && replayStageIndex === replayLastStage && replayPhase === 'settled');
  const decoratedSnapshot = useMemo(
    () => snapshot ? decorateSnapshotWithGenerationTargets(snapshot, generationJobs, nodeTargetStates) : null,
    [generationJobs, nodeTargetStates, snapshot],
  );
  const graphSnapshot = replaySnapshot && !replayAtEnd ? replaySnapshot : decoratedSnapshot;
  const activeNode = snapshot?.nodes.find(node => node.asset_id === activeNodeId) || snapshot?.nodes[0];
  const editingEdge = snapshot?.edges.find(edge => edge.id === edgeEditor?.edgeId);
  const latestNodes = snapshot?.nodes.filter(node => snapshot.latest.includes(node.asset_id)) || [];
  const selectedNodes = useMemo(
    () => snapshot?.selected.map(assetId => snapshot.nodes.find(node => node.asset_id === assetId)).filter((node): node is LineageNode => Boolean(node)) || [],
    [snapshot],
  );
  const selectedNode = selectedNodes[0];
  const nextVariationLimit = 3;
  const selectionFull = selectedNodes.length >= nextVariationLimit;
  const detailNode = snapshot?.nodes.find(node => node.asset_id === detailNodeId) || null, historyNode = snapshot?.nodes.find(node => node.asset_id === historyNodeId) || null, menuNode = snapshot?.nodes.find(node => node.asset_id === nodeMenu?.assetId), targetNode = snapshot?.nodes.find(node => node.asset_id === targetNodeId) || null;
  const canvasHoverPreviewsEnabled = hoverPreviewsEnabled && !detailNode && !historyNode && !editingEdge && (!replaySnapshot || replayAtEnd);
  const noteDirty = Boolean(activeNode && selectionNote !== (activeNode.selection_note || ''));
  const graphDirection = canvasPresentation === 'portrait' ? portraitGraphDirection : compactGraphDirection;
  const authoritativeEdges = useRef<Edge[]>([]);
  const renderedGraphKey = useRef('');
  const workspaceRootRef = useRef('');
  const panelReturnFocusRef = useRef<HTMLElement | null>(null);
  const { fitGraph, markViewportInteraction } = useLineageViewportFit(
    flowApi,
    snapshot?.root_asset_id,
    false,
    `${canvasPresentation}:${graphDirection}`,
  );
  const closeTransientMenus = useCallback(() => {
    setMenuCloseSignal(value => value + 1);
    setNodeMenu(null);
  }, []);
  const currentProjectRef = useRef(project);
  useEffect(() => { currentProjectRef.current = project; }, [project]);
  const clearFocus = useCallback(() => { setActiveNodeId(null); closeTransientMenus(); }, [closeTransientMenus]);
  const resetLineage = useCallback(() => {
    setSnapshot(null);
    setActiveNodeId(null);
    setBrief(null);
    setGenerationJobs([]);
    setNodeTargetStates({});
    setTargetNodeId(null);
    setReplaySnapshot(null);
    setReplayPlaying(false);
    setReplayPhase('settled');
    setReplayStageIndex(-1);
  }, []);
  const refreshNodeTargets = useCallback(async (targetSnapshot: LineageSnapshot | null = snapshot) => {
    if (!targetSnapshot) return;
    const results = await Promise.allSettled(targetSnapshot.nodes.map(node =>
      loadNodeNextOutputTargets(project, targetSnapshot.root_asset_id, node.asset_id)));
    const next: Record<string, NodeNextOutputTargetsResponse> = {};
    results.forEach(result => {
      if (result.status === 'fulfilled') next[result.value.node_asset_id] = result.value;
    });
    setNodeTargetStates(next);
  }, [project, snapshot]);
  const snapshotTargetKey = useMemo(
    () => snapshot ? `${snapshot.root_asset_id}\0${snapshot.nodes.map(node => node.asset_id).sort().join('\0')}` : '',
    [snapshot],
  );
  useEffect(() => {
    if (!snapshot) return;
    void refreshNodeTargets(snapshot);
  }, [refreshNodeTargets, snapshotTargetKey]);
  const {
    activateWorkspace,
    activeWorkspace,
    archiveWorkspace,
    demoSeedStatus,
    downloadSwissifierDemoMedia,
    handleWorkspaceCreated,
    refreshDemoSeedStatus,
    refreshWorkspaces,
    restoreDemoSeedMedia,
    restoreSwissifierDemoMedia,
    seedDemoWorkspace,
    seedSwissifierDemoWorkspace,
    swissifierDemoStatus,
    visibleWorkspaces,
    workspaceLoading,
    workspaceRootAssetId,
  } = useLineageWorkspaces({ asset, onResetLineage: resetLineage, onSelectedAsset, onToast, project });
  workspaceRootRef.current = workspaceRootAssetId;
  useEffect(() => { void refreshDemoSeedStatus(); }, [refreshDemoSeedStatus]);
  const refresh = useCallback(async (options: { quiet?: boolean; rootAssetId?: string } = {}) => {
    const requestedRoot = options.rootAssetId || workspaceRootAssetId;
    if (!requestedRoot) return false;
    if (!options.quiet) setLoading(true);
    try {
      const params = new URLSearchParams({ project });
      const [next, nextClaims] = await Promise.all([
        api<LineageSnapshot>(`/api/lineage/${requestedRoot}?${params.toString()}`),
        api<AgentClaimsResponse>(`/api/agent-claims?${params.toString()}`),
      ]);
      if (!options.rootAssetId && workspaceRootRef.current !== requestedRoot) return false;
      setSnapshot(next);
      void api<GenerationJobListResponse>(`/api/generation/jobs?${new URLSearchParams({ project, rootAssetId: requestedRoot, limit: '50' }).toString()}`)
        .then(result => {
          if (workspaceRootRef.current === requestedRoot) setGenerationJobs(result.jobs);
        })
        .catch(() => undefined);
      setClaims(nextClaims.claims);
      if (!options.quiet) setBrief(null);
      setActiveNodeId(current => activeNodeIdAfterRefresh(current, next.nodes, next.active_asset_id, Boolean(options.quiet)));
      return true;
    } catch (error) {
      if (!options.rootAssetId && workspaceRootRef.current !== requestedRoot) return false;
      if (!options.quiet && currentProjectRef.current === project) {
        setSnapshot(null);
        onToast('error', error instanceof Error ? error.message : String(error));
      }
      return false;
    } finally {
      if (!options.quiet && currentProjectRef.current === project) setLoading(false);
    }
  }, [onToast, project, workspaceRootAssetId]);
  const startReplay = useCallback(() => {
    if (!snapshot || !isLineageReplayable(snapshot)) return;
    closeTransientMenus();
    setActiveNodeId(null);
    setDetailNodeId(null);
    setHistoryNodeId(null);
    setHistoryAttempts([]);
    setEdgeEditor(null);
    setPanelMode(null);
    setReplaySnapshot(snapshot);
    setReplayStageIndex(-1);
    setReplayPhase('node');
    setReplayPlaying(true);
  }, [closeTransientMenus, snapshot]);
  const returnToLive = useCallback(() => {
    setReplaySnapshot(null);
    setReplayStageIndex(-1);
    setReplayPhase('settled');
    setReplayPlaying(false);
    void refresh({ quiet: true });
  }, [refresh]);
  const restartReplay = useCallback(() => {
    if (replayAtEnd && snapshot) setReplaySnapshot(snapshot);
    setReplayStageIndex(-1);
    setReplayPhase('node');
    setReplayPlaying(true);
  }, [replayAtEnd, snapshot]);
  const toggleReplay = useCallback(() => {
    if (replayAtEnd) {
      restartReplay();
      return;
    }
    setReplayPlaying(value => !value);
  }, [replayAtEnd, restartReplay]);
  const scrubReplay = useCallback((stageIndex: number) => {
    setReplayPlaying(false);
    setReplayPhase('settled');
    setReplayStageIndex(Math.max(0, Math.min(stageIndex, replayLastStage)));
  }, [replayLastStage]);
  async function indexAndRefresh() {
    setWorkspaceProgress(null);
    setLoading(true);
    try {
      const result = await api<{ summary: LineageIndexSummary }>('/api/index/local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project }),
      });
      onToast('ok', `Indexed ${result.summary.total} assets`);
      await refreshWorkspaces();
      await refresh();
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }
  async function seedDemoAndRefreshAssets() {
    closeTransientMenus();
    setWorkspaceProgress(null);
    const seeded = await seedDemoWorkspace();
    if (!seeded) return;
    try {
      await onAssetsChanged?.();
      await refresh({ rootAssetId: seeded.workspace?.root_asset_id || seeded.root_asset_id });
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    }
  }
  async function seedSwissifierAndRefreshAssets() {
    closeTransientMenus();
    indexingRefreshStarted.current = false;
    setWorkspaceProgress('seeding');
    const seeded = await seedSwissifierDemoWorkspace();
    if (!seeded) {
      setWorkspaceProgress('error');
      return;
    }
    try {
      setWorkspaceProgress('indexing');
      await nextBrowserPaint();
      await onAssetsChanged?.();
      indexingRefreshStarted.current = true;
      const ready = await refresh({ rootAssetId: seeded.workspace?.root_asset_id || seeded.root_asset_id });
      if (!ready) {
        indexingRefreshStarted.current = false;
        setWorkspaceProgress('error');
      }
    } catch (error) {
      indexingRefreshStarted.current = false;
      setWorkspaceProgress('error');
      onToast('error', error instanceof Error ? error.message : String(error));
    }
  }
  async function downloadSwissifierAndTrack() {
    setWorkspaceProgress('downloading');
    const downloaded = await downloadSwissifierDemoMedia();
    setWorkspaceProgress(downloaded ? 'downloaded' : 'error');
  }
  async function mutateLineage(path: string, body: Record<string, unknown>, message: string) {
    try {
      await api(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, ...body }),
      });
      onToast('ok', message);
      await refresh();
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    }
  }
  function setSelected() { if (activeNode) void selectNextBase(activeNode, selectionNote); }
  function saveRationale() { if (activeNode?.user_selected) void selectNextBase(activeNode, selectionNote); }
  async function selectNextBase(node: LineageNode, notes = node.selection_note || '') {
    if (!node.user_selected && selectionFull) {
      onToast('error', `Choose at most ${nextVariationLimit} assets for next variation`);
      return;
    }
    await mutateLineage('/api/selection', {
      assetId: node.asset_id,
      rootAssetId: snapshot?.root_asset_id,
      mode: node.user_selected ? 'remove' : 'add',
      notes,
      confirmWrite: true,
    }, node.user_selected ? `Removed ${node.asset_id} from next variation` : `Using ${node.asset_id} for next variation`);
  }
  async function replaceNextVariation(node: LineageNode, notes = node.selection_note || '') {
    await mutateLineage('/api/selection', {
      assetId: node.asset_id,
      rootAssetId: snapshot?.root_asset_id,
      mode: 'replace',
      notes,
      confirmWrite: true,
    }, `Using only ${node.asset_id} for next variation`);
  }
  async function clearNextVariation(assetId?: string) {
    if (!snapshot) return;
    if (assetId) {
      await mutateLineage('/api/selection', { assetId, rootAssetId: snapshot.root_asset_id, mode: 'remove', confirmWrite: true }, `Removed ${assetId} from next variation`);
      return;
    }
    if (selectedNodes.length > 0) await mutateLineage('/api/selection', { rootAssetId: snapshot.root_asset_id, clear: true, confirmWrite: true }, 'Removed all assets from next variation');
  }
  const closePanel = useCallback(() => {
    setPanelMode(null);
    panelReturnFocusRef.current?.focus();
    panelReturnFocusRef.current = null;
  }, []);
  function togglePanel(mode: 'settings' | 'selection' | 'asset') {
    const invokingControl = document.activeElement;
    if (invokingControl instanceof HTMLElement) panelReturnFocusRef.current = invokingControl;
    setPanelMode(current => {
      if (current !== mode) return mode;
      panelReturnFocusRef.current?.focus();
      panelReturnFocusRef.current = null;
      return null;
    });
  }
  function openAssetPanel(assetId: string) {
    const invokingControl = document.activeElement;
    if (invokingControl instanceof HTMLElement) panelReturnFocusRef.current = invokingControl;
    setActiveNodeId(assetId);
    setPanelMode('asset');
  }
  async function markReview(reviewState: AssetReviewState, assetId = activeNode?.asset_id) {
    if (!assetId) return;
    const targetNode = snapshot?.nodes.find(node => node.asset_id === assetId);
    const conflict = lineageReviewConflict(targetNode, reviewState);
    if (conflict && !window.confirm(conflict.confirmation)) return;
    if (conflict) await clearNextVariation(assetId);
    void mutateLineage(`/api/reviews/${assetId}`, { reviewState, confirmWrite: true }, `Marked ${assetId} ${reviewState}`);
  }
  async function markReroll(node: LineageNode) {
    if (!snapshot) return;
    await mutateLineage(`/api/lineage/${snapshot.root_asset_id}/rerolls/${node.asset_id}`, {
      confirmWrite: true,
      requestedBy: 'human',
    }, `Marked ${node.asset_id} for re-roll`);
  }
  async function clearReroll(node: LineageNode) {
    if (!snapshot) return;
    await mutateLineage(`/api/lineage/${snapshot.root_asset_id}/rerolls/${node.asset_id}/cancel`, {
      confirmWrite: true,
    }, `Cleared re-roll request for ${node.asset_id}`);
  }
  async function toggleSocial(node: LineageNode) {
    if (!snapshot) return;
    const active = node.social_mark?.active === true;
    const suffix = active ? '/unmark' : '';
    await mutateLineage(`/api/lineage/${snapshot.root_asset_id}/social-marks/${node.asset_id}${suffix}`, {
      actor: 'human:canvas',
      confirmWrite: true,
    }, active ? `Unmarked ${node.asset_id} from Social` : `Marked ${node.asset_id} for Social`);
  }
  async function openAttemptHistory(assetId: string) {
    if (!snapshot) return;
    try {
      const params = new URLSearchParams({ project });
      const result = await api<LineageAttemptsResponse>(`/api/lineage/${snapshot.root_asset_id}/attempts/${assetId}?${params.toString()}`);
      setHistoryAttempts(result.attempts);
      setHistoryNodeId(assetId);
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    }
  }
  function closeAttemptHistory() {
    setHistoryNodeId(null);
    setHistoryAttempts([]);
  }
  function openDetailFromHistory(assetId: string) {
    closeAttemptHistory();
    setDetailNodeId(assetId);
  }
  async function promoteAttempt(attempt: LineageAttempt) {
    if (!snapshot || !historyNodeId) return;
    try {
      const result = await api<LineageAttemptPromotionResponse>(`/api/lineage/${snapshot.root_asset_id}/attempts/${historyNodeId}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, attemptId: attempt.id, confirmWrite: true }),
      });
      setHistoryAttempts(result.attempts);
      onToast('ok', `Set v${attempt.attempt_index} as current`);
      await refresh({ quiet: true });
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    }
  }
  async function linkChild() {
    if (!activeNode || !childAssetId.trim()) return;
    await mutateLineage('/api/lineage/link', {
      childAssetId: childAssetId.trim(),
      confirmWrite: true,
      parentAssetId: activeNode.asset_id,
    }, `Linked ${childAssetId.trim()} from ${activeNode.asset_id}`);
    setChildAssetId('');
  }
  async function updateEdgeSummary(action: EdgeSummaryEditAction, summary?: string) {
    if (!editingEdge) return;
    try {
      const result = await api<LineageEdgeSummaryMutationResponse>(`/api/lineage/edges/${encodeURIComponent(editingEdge.id)}/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          confirmWrite: true,
          expectedSummaryUpdatedAt: editingEdge.summary_updated_at || null,
          project,
          ...(action === 'set' ? { summary } : {}),
        }),
      });
      await refresh({ quiet: true });
      onToast('ok', result.message);
      setEdgeEditor(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.message.includes('Edge summary changed since it was opened')) {
        await refresh({ quiet: true });
        throw new Error('This edge changed elsewhere. The current label has been reloaded; review it and retry.', { cause: error });
      }
      throw error;
    }
  }
  async function removeNodeFromLineage(node: LineageNode) {
    if (!snapshot) return;
    if (node.asset_id === snapshot.root_asset_id) {
      onToast('error', 'Root lineage node cannot be removed. Archive this workspace or start a new lineage instead.');
      return;
    }
    const childCount = snapshot.edges.filter(edge => edge.parent_asset_id === node.asset_id).length;
    const parentCount = snapshot.edges.filter(edge => edge.child_asset_id === node.asset_id).length;
    const reparentCopy = childCount > 0 && parentCount > 0
      ? ` Its ${childCount} child${childCount === 1 ? '' : 'ren'} will be reconnected to its parent${parentCount === 1 ? '' : 's'}.`
      : '';
    if (!window.confirm(`Remove "${node.title}" from this lineage? This keeps the asset file and S3 object intact.${reparentCopy}`)) return;
    await mutateLineage('/api/lineage/remove-node', {
      assetId: node.asset_id,
      rootAssetId: snapshot.root_asset_id,
      confirmWrite: true,
    }, `Removed ${node.asset_id} from lineage`);
    setNodeMenu(null);
    setDetailNodeId(current => current === node.asset_id ? null : current);
    setActiveNodeId(current => current === node.asset_id ? snapshot.root_asset_id : current);
  }
  async function saveNodePosition(node: AssetFlowNode) {
    if (!snapshot) return;
    try {
      await saveLineagePositions(project, snapshot.root_asset_id, [{ assetId: node.id, x: node.position.x, y: node.position.y }]);
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    }
  }
  async function tidyGraph() {
    if (!snapshot) return;
    const positions = [...layoutLineageTree(snapshot, graphDirection, canvasPresentation)].map(([assetId, position]) => ({ assetId, ...position }));
    setFlowNodes(current => current.map(node => ({
      ...node,
      position: positions.find(position => position.assetId === node.id) || node.position,
    })));
    if (canvasPresentation === 'portrait') {
      onToast('ok', `Tidied ${positions.length} portrait cards without changing compact positions`);
      fitGraph(80);
      return;
    }
    applySnapshotPositions(positions);
    try {
      await saveLineagePositions(project, snapshot.root_asset_id, positions);
      onToast('ok', `Tidied ${positions.length} lineage nodes`);
      fitGraph(80);
      await refresh({ quiet: true });
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    }
  }
  async function orientGraph(direction: LineageGraphDirection) {
    if (!snapshot) return;
    const positions = [...layoutLineageTree(snapshot, direction, canvasPresentation)].map(([assetId, position]) => ({ assetId, ...position }));
    setFlowApi(null);
    if (canvasPresentation === 'portrait') setPortraitGraphDirection(direction);
    else setCompactGraphDirection(direction);
    if (!writeLineageGraphDirection(canvasPresentation, direction)) {
      onToast('error', 'Direction changed for this session, but browser storage is unavailable so it could not be saved');
    }
    setFlowNodes(current => current.map(node => ({
      ...node,
      position: positions.find(position => position.assetId === node.id) || node.position,
    })));
    if (canvasPresentation === 'portrait') {
      onToast('ok', `Rotated portrait cards ${graphDirectionLabel(direction).toLowerCase()} without changing compact positions`);
      return;
    }
    applySnapshotPositions(positions);
    try {
      await saveLineagePositions(project, snapshot.root_asset_id, positions);
      onToast('ok', `Rotated lineage graph ${graphDirectionLabel(direction).toLowerCase()}`);
      await refresh({ quiet: true });
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    }
  }
  function applySnapshotPositions(positions: Array<{ assetId: string; x: number; y: number }>) {
    const positionMap = new Map(positions.map(position => [position.assetId, { x: position.x, y: position.y }]));
    setSnapshot(current => current ? {
      ...current,
      nodes: current.nodes.map(node => ({
        ...node,
        position: positionMap.get(node.asset_id) || node.position,
      })),
    } : current);
  }
  function selectCanvasPresentation(presentation: LineageCanvasPresentation) {
    setFlowApi(null);
    setCanvasPresentation(presentation);
    if (!writeLineageCanvasPresentation(presentation)) {
      onToast('error', 'Card style changed for this session, but browser storage is unavailable so it could not be saved');
    }
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (presentation === 'portrait') url.searchParams.set('lineageCanvas', 'portrait');
      else url.searchParams.delete('lineageCanvas');
      window.history.replaceState(window.history.state, '', url);
    }
  }
  function selectEdgeWeight(weight: LineageEdgeWeight) {
    setEdgeWeight(weight);
    if (!writeLineageEdgeWeight(weight)) {
      onToast('error', 'Edge weight changed for this session, but browser storage is unavailable so it could not be saved');
    }
  }
  function selectHoverPreviews(enabled: boolean) {
    setHoverPreviewsEnabled(enabled);
    if (!writeHoverPreviewsEnabled(enabled)) {
      onToast('error', 'Hover previews changed for this session, but browser storage is unavailable so the preference could not be saved');
    }
  }
  function selectEdgeSummariesVisible(visible: boolean) {
    setEdgeSummariesVisible(visible);
    if (!writeLineageEdgeLabelsVisible(visible)) {
      onToast('error', 'Edge labels changed for this session, but browser storage is unavailable so the preference could not be saved');
    }
  }
  function resetAppearance() {
    setCanvasPresentation('compact');
    setCompactGraphDirection('LR');
    setPortraitGraphDirection('LR');
    setEdgeWeight('standard');
    setEdgeSummariesVisible(true);
    setHoverPreviewsEnabled(true);
    setFlowApi(null);
    if (!resetLineageAppearancePreferences()) {
      onToast('error', 'Appearance reset for this session, but browser storage is unavailable so the defaults could not be saved');
    } else {
      onToast('ok', 'Canvas appearance reset');
    }
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('lineageCanvas');
      window.history.replaceState(window.history.state, '', url);
    }
  }
  async function refreshBrief() {
    if (!snapshot) return;
    try {
      const params = new URLSearchParams({ project });
      setBrief(await api<LineageBriefResponse>(`/api/lineage/${snapshot.root_asset_id}/brief?${params.toString()}`));
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    }
  }
  async function controlClaim(action: 'release-stale' | 'revoke' | 'transfer', claim: AgentClaimSummary, body: { confirmWrite: true; reason?: string; toAgentName?: string }) {
    try {
      await api(`/api/agent-claims/${claim.id}/${action}`, {
        body: JSON.stringify({ project, ...body }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      onToast('ok', `Updated claim ${claim.id}`);
      await refresh({ quiet: true });
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    }
  }
  useEffect(() => {
    void refreshWorkspaces();
  }, [refreshWorkspaces]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!workspaceRootAssetId) resetLineage();
  }, [resetLineage, workspaceRootAssetId]);

  useEffect(() => {
    if (!snapshot) return undefined;
    const timer = window.setInterval(() => void refresh({ quiet: true }), 8000);
    return () => window.clearInterval(timer);
  }, [refresh, snapshot?.root_asset_id]);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return undefined;
    const update = () => setReduceReplayMotion(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    if (!replaySnapshot || !replayPlaying || replayLastStage < 0) return undefined;
    const nextStageIndex = Math.min(replayStageIndex + 1, replayLastStage);
    if (replayPhase === 'settled' && replayStageIndex >= replayLastStage) {
      setReplayPlaying(false);
      return undefined;
    }

    const nextStage = replayTimeline.stages[nextStageIndex];
    const reducedDelay = reduceReplayMotion ? 40 : undefined;
    let delay = reducedDelay ?? 120 / replaySpeed;
    let advance = () => {
      const nextPhase = nextStage.enteringEdgeIds.length > 0 ? 'edge' : 'node';
      setReplayPhase(nextPhase);
    };

    if (replayPhase === 'edge') {
      delay = reducedDelay ?? 320 / replaySpeed;
      advance = () => {
        if (nextStage.enteringNodeIds.length > 0) setReplayPhase('node');
        else {
          setReplayStageIndex(nextStageIndex);
          setReplayPhase('settled');
        }
      };
    } else if (replayPhase === 'node') {
      delay = reducedDelay ?? 200 / replaySpeed;
      advance = () => {
        setReplayStageIndex(nextStageIndex);
        setReplayPhase('settled');
      };
    }

    const timer = window.setTimeout(advance, delay);
    return () => window.clearTimeout(timer);
  }, [reduceReplayMotion, replayLastStage, replayPhase, replayPlaying, replaySnapshot, replaySpeed, replayStageIndex, replayTimeline.stages]);

  const baseGraph = useMemo(
    () => toGraph(graphSnapshot, activeNodeId, graphDirection, edgeSummariesVisible, canvasPresentation),
    [activeNodeId, canvasPresentation, edgeSummariesVisible, graphDirection, graphSnapshot],
  );
  const graph = useMemo(() => replaySnapshot && !replayAtEnd
    ? projectLineageReplay(baseGraph.nodes, baseGraph.edges, replayTimeline, replayStageIndex, replayPhase)
    : baseGraph,
  [baseGraph, replayAtEnd, replayPhase, replaySnapshot, replayStageIndex, replayTimeline]);
  const graphKey = useMemo(
    () => lineageGraphKey(graphSnapshot, graphDirection, canvasPresentation),
    [canvasPresentation, graphDirection, graphSnapshot],
  );
  authoritativeEdges.current = graph.edges;

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    setFlowEdges(current => reconcileAuthoritativeEdgeChanges(changes, current, authoritativeEdges.current));
  }, [setFlowEdges]);
  const closeOnEscape = useCallback((event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    closeTransientMenus();
    if (panelMode) closePanel();
  }, [closePanel, closeTransientMenus, panelMode]);

  useEffect(() => {
    setSelectionNote(activeNode?.selection_note || '');
  }, [activeNode?.asset_id, activeNode?.selection_note]);

  useEffect(() => {
    const resetPositions = renderedGraphKey.current !== graphKey;
    renderedGraphKey.current = graphKey;
    setFlowNodes(current => graph.nodes.map(node => ({
      ...node,
      position: resetPositions ? node.position : current.find(existing => existing.id === node.id)?.position || node.position,
    })));
    setFlowEdges(graph.edges);
  }, [graph.edges, graph.nodes, graphKey, setFlowEdges, setFlowNodes]);

  useEffect(() => {
    if (workspaceProgress !== 'indexing' || !indexingRefreshStarted.current || !snapshot?.nodes.length) return;
    if (renderedGraphKey.current !== graphKey || flowNodes.length !== snapshot.nodes.length) return;
    indexingRefreshStarted.current = false;
    setWorkspaceProgress('ready');
  }, [flowNodes.length, graphKey, snapshot, workspaceProgress]);

  useEscapeClear(Boolean(activeNodeId), clearFocus);

  useEffect(() => {
    resetLineage();
    setWorkspaceProgress(null);
  }, [project, resetLineage]);

  useEffect(() => {
    setCanvasToolsHost(document.getElementById('canvas-context-tools'));
  }, []);

  return (
    <section className="lineage-view" onKeyDownCapture={closeOnEscape}>
      {canvasToolsHost && createPortal(
        <LineageToolbar
          activeWorkspace={activeWorkspace}
          closeSignal={menuCloseSignal}
          loading={loading}
          demoSeedStatus={demoSeedStatus}
          onArchiveWorkspace={() => { setWorkspaceProgress(null); void archiveWorkspace(); }}
          onIndexLocal={() => void indexAndRefresh()}
          onNewLineage={() => { setWorkspaceProgress(null); setNewLineageOpen(true); }}
          onOpenGeneration={() => setGenerationOpen(true)}
          onOpenOutputDefaults={() => setOutputDefaultsOpen(true)}
          onRefreshLineage={() => void refresh()}
          onRefreshWorkspaces={() => void refreshWorkspaces()}
          onReplayGrowth={startReplay}
          onRestoreDemoMedia={() => void restoreDemoSeedMedia()}
          onRestoreSwissifierMedia={() => void restoreSwissifierDemoMedia()}
          onDownloadSwissifierMedia={() => void downloadSwissifierAndTrack()}
          onSeedDemo={() => void seedDemoAndRefreshAssets()}
          onSeedSwissifierDemo={() => void seedSwissifierAndRefreshAssets()}
          onSelectWorkspace={workspaceId => { setWorkspaceProgress(null); void activateWorkspace(workspaceId); }}
          onToggleNextPanel={() => togglePanel('selection')}
          replayActive={Boolean(replaySnapshot)}
          sideOpen={panelMode === 'selection'}
          snapshot={snapshot}
          swissifierDemoStatus={swissifierDemoStatus}
          workspaceLoading={workspaceLoading}
          workspaceProgress={workspaceProgress}
          workspaceRootAssetId={workspaceRootAssetId}
          workspaces={visibleWorkspaces}
        />,
        canvasToolsHost,
      )}
      <div className="lineage-workbench" data-testid="lineage-workbench">
        <div
          className={`lineage-canvas lineage-canvas-${canvasPresentation} lineage-edges-${edgeWeight} ${activeNodeId ? 'focus-active' : ''} ${replaySnapshot ? 'lineage-replay-active' : ''} ${replayAtEnd ? 'lineage-replay-interactive' : ''} ${replaySnapshot && !replayPlaying ? 'lineage-replay-paused' : ''}`}
          data-lineage-canvas-presentation={canvasPresentation}
          data-lineage-edge-weight={edgeWeight}
          style={replaySnapshot ? {
            '--lineage-replay-edge-duration': `${reduceReplayMotion ? 1 : 320 / replaySpeed}ms`,
            '--lineage-replay-node-duration': `${reduceReplayMotion ? 1 : 200 / replaySpeed}ms`,
          } as CSSProperties : undefined}
        >
          {replaySnapshot && replayTimeline.stages.length > 0 && (
            <LineageReplayControls
              atEnd={replayAtEnd}
              onClose={returnToLive}
              onPlayPause={toggleReplay}
              onRestart={restartReplay}
              onScrub={scrubReplay}
              onSpeed={setReplaySpeed}
              playing={replayPlaying}
              speed={replaySpeed}
              stageIndex={replayStageIndex}
              totalStages={replayTimeline.stages.length}
            />
          )}
          <LineageCanvas
            canvasPresentation={canvasPresentation}
            flowEdges={graphSnapshot ? flowEdges : []}
            flowNodes={graphSnapshot ? flowNodes : []}
            graphKey={graphKey}
            hoverPreviewsEnabled={canvasHoverPreviewsEnabled}
            loading={loading}
            onEdgesChange={handleEdgesChange}
            onEdgeEdit={(edgeId, returnFocus) => setEdgeEditor({ edgeId, returnFocus })}
            onClearFocus={clearFocus}
            onIndexNow={() => void indexAndRefresh()}
            onNewLineage={() => { setWorkspaceProgress(null); setNewLineageOpen(true); }}
            onSeedDemo={() => void seedDemoAndRefreshAssets()}
            onNodeActionMenu={(assetId, x, y) => setNodeMenu(assetId ? { assetId, x, y } : null)}
            onNodeInspect={assetId => { closeTransientMenus(); setActiveNodeId(assetId); }}
            onNodeOpenDetail={openAssetPanel}
            onNodeOpenHistory={assetId => void openAttemptHistory(assetId)}
            onNodePosition={node => {
              if (canvasPresentation === 'compact') void saveNodePosition(node);
            }}
            onNodesChange={onNodesChange}
            onReady={setFlowApi}
            onSelectedAsset={onSelectedAsset}
            onToggleBranch={node => node.user_selected ? clearNextVariation(node.asset_id) : selectNextBase(node)}
            onToggleReroll={node => node.reroll_request?.status === 'pending' ? clearReroll(node) : markReroll(node)}
            onToggleSocial={toggleSocial}
            onViewportInteraction={markViewportInteraction}
            replayInteractive={!replaySnapshot || replayAtEnd}
            selectionFull={selectionFull}
            workspaceProgress={workspaceProgress}
            workspaceRootAssetId={workspaceRootAssetId}
          />
          <button
            aria-controls="lineage-canvas-panel"
            aria-expanded={panelMode === 'settings'}
            aria-label="Open Canvas settings"
            className="lineage-canvas-settings-trigger"
            onClick={() => togglePanel('settings')}
            title="Canvas settings"
            type="button"
          >
            <span aria-hidden="true">⚙</span>
          </button>
        </div>
        {panelMode && (
          <button
            aria-label="Close Canvas panel"
            className="lineage-panel-backdrop"
            onClick={closePanel}
            type="button"
          />
        )}
        {panelMode === 'settings' && (
          <aside aria-label="Canvas settings" className="lineage-side lineage-canvas-settings-panel" id="lineage-canvas-panel">
            <div className="lineage-side-head">
              <div>
                <h3>Canvas settings</h3>
                <p className="muted-copy">Appearance preferences are saved in this browser.</p>
              </div>
              <button autoFocus aria-label="Close Canvas settings" className="icon-button" onClick={closePanel} type="button">×</button>
            </div>
            <LineageCanvasAppearanceControls
              canvasPresentation={canvasPresentation}
              edgeSummariesVisible={edgeSummariesVisible}
              edgeWeight={edgeWeight}
              graphDirection={graphDirection}
              hoverPreviewsEnabled={hoverPreviewsEnabled}
              loading={loading}
              onCanvasPresentation={selectCanvasPresentation}
              onEdgeSummariesVisible={selectEdgeSummariesVisible}
              onEdgeWeight={selectEdgeWeight}
              onFitGraph={() => fitGraph()}
              onGraphDirection={direction => void orientGraph(direction)}
              onHoverPreviewsEnabled={selectHoverPreviews}
              onResetAppearance={resetAppearance}
              onTidyGraph={() => void tidyGraph()}
              snapshotAvailable={Boolean(snapshot)}
            />
          </aside>
        )}
        {(panelMode === 'selection' || panelMode === 'asset') && snapshot && (
          <LineageSidePanel
            activeNode={activeNode}
            brief={brief}
            childAssetId={childAssetId}
            clearNextVariation={clearNextVariation}
            closePanel={closePanel}
            latestNodes={latestNodes}
            linkChild={linkChild}
            markReview={markReview}
            nextVariationLimit={nextVariationLimit}
            noteDirty={noteDirty}
            onSelectedAsset={onSelectedAsset}
            onToast={onToast}
            project={project}
            refreshBrief={refreshBrief}
            refreshLineage={async () => { await refresh({ quiet: true }); }}
            saveRationale={saveRationale}
            replaceNextVariation={replaceNextVariation}
            selectNextBase={selectNextBase}
            selectedNode={selectedNode}
            selectedNodes={selectedNodes}
            selectionFull={selectionFull}
            selectionNote={selectionNote}
            setActiveNodeId={setActiveNodeId}
            setChildAssetId={setChildAssetId}
            setDetailNodeId={assetId => {
              setPanelMode(null);
              setDetailNodeId(assetId);
            }}
            setSelected={setSelected}
            setSelectionNote={setSelectionNote}
            mode={panelMode}
            sideOpen
            snapshot={snapshot}
          />
        )}
        {nodeMenu && menuNode && snapshot && <LineageContextMenu canRemoveFromLineage={menuNode.asset_id !== snapshot.root_asset_id} claims={lineageWorkspaceClaims(claims, project, snapshot.root_asset_id)} node={menuNode} onClaimControl={(action, claim, body) => { void controlClaim(action, claim, body); }} onClearAllNext={() => void clearNextVariation()} onClearNext={() => void clearNextVariation(menuNode.asset_id)} onClearReroll={() => void clearReroll(menuNode)} onClose={() => setNodeMenu(null)} onEditOutputTargets={() => setTargetNodeId(menuNode.asset_id)} onMarkReroll={() => void markReroll(menuNode)} onOpenDetail={() => openAssetPanel(menuNode.asset_id)} onRemoveFromLineage={() => void removeNodeFromLineage(menuNode)} onReplaceNext={() => replaceNextVariation(menuNode)} onReview={reviewState => void markReview(reviewState, menuNode.asset_id)} onSelectNext={() => selectNextBase(menuNode)} onToggleSocial={() => void toggleSocial(menuNode)} position={nodeMenu} selectedCount={selectedNodes.length} selectionFull={selectionFull} />}
      </div>
      {historyNode && snapshot && (
        <LineageAttemptHistoryModal
          actions={{
            canRemoveFromLineage: historyNode.asset_id !== snapshot.root_asset_id,
            onClearAllNext: () => void clearNextVariation(),
            onClearNext: () => void clearNextVariation(historyNode.asset_id),
            onOpenNode: openDetailFromHistory,
            onRemoveFromLineage: node => void removeNodeFromLineage(node),
            onReplaceNext: replaceNextVariation,
            onReview: markReview,
            onSelectNext: selectNextBase,
            onToast,
            selectedCount: selectedNodes.length,
            selectionFull,
            snapshot,
          }}
          attempts={historyAttempts}
          node={historyNode}
          onClose={closeAttemptHistory}
          onPromoteAttempt={promoteAttempt}
          project={project}
        />
      )}
      {detailNode && snapshot && <LineageDetailModal canRemoveFromLineage={detailNode.asset_id !== snapshot.root_asset_id} node={detailNode} onClearAllNext={() => void clearNextVariation()} onClearNext={() => void clearNextVariation(detailNode.asset_id)} onClose={() => setDetailNodeId(null)} onEditOutputTargets={() => setTargetNodeId(detailNode.asset_id)} onOpenNode={setDetailNodeId} onRemoveFromLineage={node => void removeNodeFromLineage(node)} onReplaceNext={replaceNextVariation} onReview={markReview} onSelectNext={selectNextBase} onToast={onToast} selectedCount={selectedNodes.length} selectionFull={selectionFull} snapshot={snapshot} />}
      {targetNode && snapshot && (
        <NodeNextOutputTargetsEditor
          nodeAssetId={targetNode.asset_id}
          nodeTitle={targetNode.title}
          onClose={() => setTargetNodeId(null)}
          onSaved={() => { void refreshNodeTargets(snapshot); }}
          project={project}
          rootAssetId={snapshot.root_asset_id}
        />
      )}
      {generationOpen && snapshot && (
        <LineageGenerationSheet
          onClose={() => setGenerationOpen(false)}
          onPlanned={job => { setGenerationJobs(current => [job, ...current.filter(item => item.id !== job.id)]); onToast('ok', `Planned ${job.expected_output_count} exact outputs`); }}
          project={project}
          rootAssetId={snapshot.root_asset_id}
          sources={selectedNodes}
        />
      )}
      {outputDefaultsOpen && snapshot && <OutputTargetPreferencesDialog onClose={() => setOutputDefaultsOpen(false)} onSaved={() => { void refreshNodeTargets(snapshot); }} project={project} rootAssetId={snapshot.root_asset_id} />}
      {editingEdge && edgeEditor && snapshot && (
        <LineageEdgeSummaryDialog
          childTitle={snapshot.nodes.find(node => node.asset_id === editingEdge.child_asset_id)?.title || editingEdge.child_asset_id}
          edge={editingEdge}
          onClose={() => setEdgeEditor(null)}
          onSubmit={updateEdgeSummary}
          parentTitle={snapshot.nodes.find(node => node.asset_id === editingEdge.parent_asset_id)?.title || editingEdge.parent_asset_id}
          returnFocus={edgeEditor.returnFocus}
        />
      )}
      <LineageNewWorkspaceModal onClose={() => setNewLineageOpen(false)} onCreated={handleWorkspaceCreated} onToast={onToast} open={newLineageOpen} project={project} />
    </section>
  );
}

function nextBrowserPaint(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function lineageWorkspaceClaims(claims: AgentClaimSummary[], project: string, rootAssetId: string): AgentClaimSummary[] {
  const targetId = `${project}:lineage-workspace:${rootAssetId}`;
  return claims.filter(claim => {
    if (claim.project !== project || claim.status !== 'active' || claim.derived_state === 'expired') return false;
    if (claim.scope_type === 'lineage_workspace') return claim.target_id === targetId;
    return claim.scope_type === 'project_channel';
  });
}

function graphDirectionLabel(direction: LineageGraphDirection): string {
  return {
    BT: 'bottom to top',
    LR: 'left to right',
    RL: 'right to left',
    TB: 'top to bottom',
  }[direction];
}
