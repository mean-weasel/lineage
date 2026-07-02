import type { StudioView } from '../assetUi';

export const primaryViews: Array<{ label: string; view: StudioView }> = [
  { label: 'Lineage', view: 'lineage' },
  { label: 'Review', view: 'review' },
  { label: 'Assets', view: 'assets' },
  { label: 'Settings', view: 'settings' },
];

export const secondaryViews: Array<{ label: string; view: StudioView }> = [
  { label: 'Ledger', view: 'ledger' },
  { label: 'Content batches', view: 'content' },
  { label: 'Backup queue', view: 'backup' },
];
