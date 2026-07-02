import type { SelectionFields } from '../shared/types';
import type { DatabaseSync } from './assetLineageDb';

export const LINEAGE_NEXT_VARIATION_LIMIT = 3;

export interface LineageSelectionRow {
  asset_id: string;
  notes?: string;
  position: number;
  selected_at: string;
}

export function selectionId(project: string, root: string, assetId: string): string {
  return `${project}:${root}:selected:${assetId}`;
}

export function selectedRows(database: DatabaseSync, project: string, root: string): LineageSelectionRow[] {
  return database.prepare(`
    select asset_id, notes, position, selected_at
    from asset_selections
    where project_id = ? and root_asset_id = ?
    order by position, selected_at, asset_id
  `).all(project, root) as unknown as LineageSelectionRow[];
}

export function normalizeSelectionInput(fields: SelectionFields): string[] {
  return [...new Set([...(fields.assetIds || []), fields.assetId || ''].map(assetId => assetId.trim()).filter(Boolean))];
}
