import { applyEdgeChanges, type Edge, type EdgeChange } from '@xyflow/react';

export function reconcileAuthoritativeEdgeChanges(changes: EdgeChange[], currentEdges: Edge[], authoritativeEdges: Edge[]): Edge[] {
  void authoritativeEdges;
  const safeChanges = changes.filter(change => change.type !== 'remove');
  return applyEdgeChanges(safeChanges, currentEdges);
}
