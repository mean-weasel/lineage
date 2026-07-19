import type { LineageNode } from '../../shared/types';

export function activeNodeIdAfterRefresh(
  current: string | null,
  nodes: Pick<LineageNode, 'asset_id'>[],
  snapshotActiveId: string,
  quiet: boolean,
): string | null {
  if (current && nodes.some(node => node.asset_id === current)) return current;
  return quiet ? null : snapshotActiveId;
}
