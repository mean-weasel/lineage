import { useCallback, useEffect, useRef } from 'react';
import type { Edge, ReactFlowInstance } from '@xyflow/react';
import type { AssetFlowNode } from './LineageAssetNode';

export function useLineageViewportFit(
  flowApi: ReactFlowInstance<AssetFlowNode, Edge> | null,
  rootAssetId: string | undefined,
  sideOpen: boolean
) {
  const autoFittingViewport = useRef(false);
  const fittedViewportKey = useRef('');
  const userAdjustedViewport = useRef(false);
  const viewportRoot = useRef('');
  const fitGraph = useCallback((delay = 0) => {
    window.setTimeout(() => {
      if (!flowApi) return;
      autoFittingViewport.current = true;
      flowApi.fitView({ maxZoom: 0.9, padding: 0.32 });
      window.setTimeout(() => { autoFittingViewport.current = false; }, 450);
    }, delay);
  }, [flowApi]);
  const markViewportInteraction = useCallback(() => {
    if (!autoFittingViewport.current) userAdjustedViewport.current = true;
  }, []);

  useEffect(() => {
    if (!rootAssetId || !flowApi) return;
    if (viewportRoot.current !== rootAssetId) {
      viewportRoot.current = rootAssetId;
      userAdjustedViewport.current = false;
      fittedViewportKey.current = '';
    }
    const viewportKey = `${rootAssetId}:${sideOpen ? 'side-open' : 'side-closed'}`;
    if (fittedViewportKey.current !== viewportKey) {
      fittedViewportKey.current = viewportKey;
      if (!userAdjustedViewport.current) fitGraph(280);
    }
  }, [fitGraph, flowApi, rootAssetId, sideOpen]);

  return { fitGraph, markViewportInteraction };
}
