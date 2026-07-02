import { UploadCloud, X } from 'lucide-react';
import type { GrowthAsset } from '../../shared/types';
import './LocalBackup.css';

export function LocalSelectionToolbar({
  assets,
  onClear,
  onOpen,
}: {
  assets: GrowthAsset[];
  onClear: () => void;
  onOpen: () => void;
}) {
  if (assets.length === 0) return null;
  return (
    <div className="local-selection-toolbar">
      <div>
        <strong>{assets.length} local keeper{assets.length === 1 ? '' : 's'} selected</strong>
        <span>Ready for S3 backup preflight</span>
      </div>
      <button onClick={onOpen}><UploadCloud size={16} />Back up selected</button>
      <button aria-label="Clear local backup selection" className="icon-lite" onClick={onClear}><X size={16} /></button>
    </div>
  );
}
