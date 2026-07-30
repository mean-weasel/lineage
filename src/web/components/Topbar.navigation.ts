import type { StudioView } from '../assetUi';

export const navigationViews: Array<{ label: string; view: StudioView }> = [
  { label: 'Workspaces', view: 'lineage' },
  { label: 'Assets', view: 'assets' },
  { label: 'Content batches', view: 'content' },
  { label: 'Review', view: 'review' },
  { label: 'Backup queue', view: 'backup' },
  { label: 'Agents', view: 'agents' },
  { label: 'Ledger', view: 'ledger' },
  { label: 'Settings', view: 'settings' },
];
