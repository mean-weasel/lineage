import { useCallback, useEffect, useRef } from 'react';
import type { Edge, ReactFlowInstance } from '@xyflow/react';
import type { AssetFlowNode } from './LineageAssetNode';

export function useLineageViewportFit(
  flowApi: ReactFlowInstance<AssetFlowNode, Edge> | null,
  rootAssetId: string | undefined,
  sideOpen: boolean,
  layoutKey: string,
) {
  const autoFittingViewport = useRef(false);
  const autoFitTimer = useRef<number | null>(null);
  const autoFitReleaseTimer = useRef<number | null>(null);
  const fittedViewportKey = useRef('');
  const userAdjustedViewport = useRef(false);
  const viewportGraph = useRef('');
  const fitInstance = useCallback((instance: ReactFlowInstance<AssetFlowNode, Edge>) => {
    autoFittingViewport.current = true;
    instance.fitView({ maxZoom: 0.9, padding: 0.32 });
    if (autoFitReleaseTimer.current !== null) window.clearTimeout(autoFitReleaseTimer.current);
    autoFitReleaseTimer.current = window.setTimeout(() => {
      autoFitReleaseTimer.current = null;
      autoFittingViewport.current = false;
    }, 450);
  }, []);
  const fitGraph = useCallback((delay = 0) => {
    if (autoFitTimer.current !== null) window.clearTimeout(autoFitTimer.current);
    autoFitTimer.current = window.setTimeout(() => {
      autoFitTimer.current = null;
      if (flowApi) fitInstance(flowApi);
    }, delay);
  }, [fitInstance, flowApi]);
  const markViewportInteraction = useCallback(() => {
    if (!autoFittingViewport.current) userAdjustedViewport.current = true;
  }, []);

  useEffect(() => {
    if (!rootAssetId || !flowApi) return;
    const graphIdentity = `${rootAssetId}:${layoutKey}`;
    const graphChanged = viewportGraph.current !== graphIdentity;
    if (graphChanged) {
      viewportGraph.current = graphIdentity;
      userAdjustedViewport.current = false;
      fittedViewportKey.current = '';
    }
    const viewportKey = `${graphIdentity}:${sideOpen ? 'side-open' : 'side-closed'}`;
    if (fittedViewportKey.current !== viewportKey) {
      fittedViewportKey.current = viewportKey;
      if (!userAdjustedViewport.current) {
        if (graphChanged) fitInstance(flowApi);
        else fitGraph(280);
      }
    }
  }, [fitGraph, fitInstance, flowApi, layoutKey, rootAssetId, sideOpen]);

  useEffect(() => () => {
    if (autoFitTimer.current !== null) window.clearTimeout(autoFitTimer.current);
    if (autoFitReleaseTimer.current !== null) window.clearTimeout(autoFitReleaseTimer.current);
  }, [flowApi]);

  return { fitGraph, markViewportInteraction };
}
