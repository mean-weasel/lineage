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

  it('drops non-authoritative edges because snapshot sync owns edge membership', () => {
    const authoritativeEdges = [edge('root->child')];
    const currentEdges = [...authoritativeEdges, edge('stale->edge')];
    const changes: EdgeChange[] = [{ id: 'stale->edge', type: 'remove' }];

    const reconciled = reconcileAuthoritativeEdgeChanges(changes, currentEdges, authoritativeEdges);

    expect(reconciled.map(item => item.id)).toEqual(['root->child']);
  });

  it('applies interaction state without reviving stale transition presentation', () => {
    const authoritativeEdges = [edge('root->child')];
    const currentEdges = [{ ...edge('root->child'), className: 'lineage-edge-branch-exiting' }];
    const changes: EdgeChange[] = [{ id: 'root->child', type: 'select', selected: true }];

    const reconciled = reconcileAuthoritativeEdgeChanges(changes, currentEdges, authoritativeEdges);

    expect(reconciled).toEqual([{ ...edge('root->child'), selected: true }]);
  });
});
