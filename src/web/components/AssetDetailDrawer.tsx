import { X } from 'lucide-react';
import type { GrowthAsset } from '../../shared/types';
import { Inspector } from './Inspector';
import './AssetDetailDrawer.css';

export function AssetDetailDrawer({
  asset,
  onArchive,
  onClose,
  onCopy,
  onCopyPreview,
  onDelete,
  onPlacement,
  onPresign,
  onPromote,
  onPull,
  onToggleBackup,
  previewError,
  previewUrl,
  selectedForBackup,
}: {
  asset?: GrowthAsset;
  onArchive: (asset: GrowthAsset) => void;
  onClose: () => void;
  onCopy: (text: string, label: string) => void;
  onCopyPreview: (asset: GrowthAsset) => void;
  onDelete: (asset: GrowthAsset, confirmation: string) => void;
  onPlacement: (asset: GrowthAsset, status: 'scheduled' | 'posted', values: { scheduledAt?: string; postedAt?: string; url?: string }) => void;
  onPresign: (asset: GrowthAsset) => void;
  onPromote: (asset: GrowthAsset) => void;
  onPull: (asset: GrowthAsset) => void;
  onToggleBackup: (asset: GrowthAsset) => void;
  previewError?: string | null;
  previewUrl: string | null;
  selectedForBackup: boolean;
}) {
  return (
    <div className="drawer-backdrop asset-detail-backdrop" onClick={onClose}>
      <section aria-label="Asset details" className="asset-detail-drawer" onClick={event => event.stopPropagation()}>
        <header>
          <div>
            <h2>Asset details</h2>
            <p>{asset?.title || 'No asset selected'}</p>
          </div>
          <button aria-label="Close asset details" className="icon-button" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>
        <Inspector
          asset={asset}
          onArchive={onArchive}
          onCopy={onCopy}
          onCopyPreview={onCopyPreview}
          onDelete={onDelete}
          onPlacement={onPlacement}
          onPresign={onPresign}
          onPromote={onPromote}
          onPull={onPull}
          onToggleBackup={onToggleBackup}
          previewError={previewError}
          previewUrl={previewUrl}
          selectedForBackup={selectedForBackup}
        />
      </section>
    </div>
  );
}
