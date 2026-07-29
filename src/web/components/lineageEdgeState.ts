import { applyEdgeChanges, type Edge, type EdgeChange } from '@xyflow/react';

export function reconcileAuthoritativeEdgeChanges(changes: EdgeChange[], currentEdges: Edge[], authoritativeEdges: Edge[]): Edge[] {
  const authoritativeIds = new Set(authoritativeEdges.map(edge => edge.id));
  const currentSelection = new Map(currentEdges.map(edge => [edge.id, edge.selected]));
  const rebasedEdges = authoritativeEdges.map(edge => currentSelection.has(edge.id)
    ? { ...edge, selected: currentSelection.get(edge.id) }
    : edge);
  const interactionChanges = changes.filter(change =>
    change.type === 'select' && authoritativeIds.has(change.id));
  return applyEdgeChanges(interactionChanges, rebasedEdges);
}
