import { describe, expect, it } from 'vitest';
import type { Edge, EdgeChange } from '@xyflow/react';
import { reconcileAuthoritativeEdgeChanges } from './lineageEdgeState';

function edge(id: string): Edge {
  const [source, target] = id.split('->');
  return { id, source, target };
}

describe('lineage edge state', () => {
  it('keeps persisted snapshot edges when React Flow reports transient removals', () => {
    const authoritativeEdges = [edge('root->child'), edge('child->leaf')];
    const changes: EdgeChange[] = [
      { id: 'root->child', type: 'remove' },
      { id: 'child->leaf', type: 'remove' },
    ];

    const reconciled = reconcileAuthoritativeEdgeChanges(changes, authoritativeEdges, authoritativeEdges);

    expect(reconciled.map(item => item.id)).toEqual(['root->child', 'child->leaf']);
  });

  it('keeps non-snapshot edge removals out of the interaction path because snapshot sync owns deletion', () => {
    const authoritativeEdges = [edge('root->child')];
    const currentEdges = [...authoritativeEdges, edge('stale->edge')];
    const changes: EdgeChange[] = [{ id: 'stale->edge', type: 'remove' }];

    const reconciled = reconcileAuthoritativeEdgeChanges(changes, currentEdges, authoritativeEdges);

    expect(reconciled.map(item => item.id)).toEqual(['root->child', 'stale->edge']);
  });
});
