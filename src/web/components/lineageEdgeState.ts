import { applyEdgeChanges, type Edge, type EdgeChange } from '@xyflow/react';

export function reconcileAuthoritativeEdgeChanges(changes: EdgeChange[], currentEdges: Edge[], authoritativeEdges: Edge[]): Edge[] {
  void currentEdges;
  const authoritativeIds = new Set(authoritativeEdges.map(edge => edge.id));
  const interactionChanges = changes.filter(change =>
    change.type === 'select' && authoritativeIds.has(change.id));
  return applyEdgeChanges(interactionChanges, authoritativeEdges);
}
