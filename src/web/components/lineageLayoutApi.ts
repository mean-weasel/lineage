import { api } from '../api';

export interface LineageLayoutPosition {
  assetId: string;
  x: number;
  y: number;
}

export async function saveLineagePositions(project: string, rootAssetId: string, positions: LineageLayoutPosition[]) {
  await api('/api/lineage/layout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      confirmWrite: true,
      positions,
      project,
      rootAssetId,
    }),
  });
}
