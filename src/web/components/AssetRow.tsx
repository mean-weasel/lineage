import { CheckSquare, Square } from 'lucide-react';
import type { GrowthAsset } from '../../shared/types';
import { formatBytes, formatDate } from '../../shared/format';
import { assetSize, assetStorageState, assetUpdatedAt, contentIcon, placementSummary } from '../assetUi';

export function AssetRow({
  asset,
  ledgerSelected,
  previewUrl,
  selected,
  onSelect,
  onToggleLedgerSelected,
  selectionPending,
}: {
  asset: GrowthAsset;
  ledgerSelected: boolean;
  previewUrl: string | null;
  selected: boolean;
  onSelect: () => void;
  onToggleLedgerSelected: () => void;
  selectionPending: boolean;
}) {
  const Icon = contentIcon(asset.content_type);
  const storage = assetStorageState(asset);
  const LedgerIcon = ledgerSelected ? CheckSquare : Square;
  return (
    <div className={`asset-row ${selected ? 'selected' : ''} ${ledgerSelected ? 'ledger-selected' : ''}`} data-asset-id={asset.asset_id} onClick={onSelect} onKeyDown={event => {
      if (event.key === 'Enter' || event.key === ' ') onSelect();
    }} role="button" tabIndex={0}>
      <button
        aria-label={`${ledgerSelected ? 'Remove from' : 'Add to'} current selections`}
        className={`ledger-select-button ${ledgerSelected ? 'selected' : ''}`}
        data-testid={`ledger-select-${asset.asset_id}`}
        disabled={selectionPending}
        onClick={event => {
          event.stopPropagation();
          onToggleLedgerSelected();
        }}
        type="button"
      >
        <LedgerIcon size={17} />
      </button>
      <div className="thumb">
        {previewUrl && (asset.content_type === 'image' || asset.content_type === 'gif') ? (
          <img src={previewUrl} alt="" loading="lazy" />
        ) : previewUrl && asset.content_type === 'video' ? (
          <video src={previewUrl} muted preload="metadata" />
        ) : (
          <Icon size={20} />
        )}
      </div>
      <div className="asset-main">
        <div className="asset-title-line">
          <strong className="asset-title-text" title={asset.title}>{asset.title}</strong>
          <span className={`status-chip ${asset.status}`}>{asset.status}</span>
          <span className={`storage-chip ${storage.kind}`} title={storage.description}>{storage.label}</span>
        </div>
        <span className="asset-id">{asset.asset_id}</span>
      </div>
      <div className="asset-meta">
        <span>{asset.channel}</span>
        <span>{asset.audience}</span>
        <span className="placement-chip">{placementSummary(asset)}</span>
      </div>
      <div className="asset-meta narrow">
        <span>{asset.content_type}</span>
        <span>{formatBytes(assetSize(asset))}</span>
      </div>
      <div className="asset-version">
        <span>{formatDate(assetUpdatedAt(asset))}</span>
        <code>{asset.s3?.version_id ? asset.s3.version_id.slice(0, 10) : 'needs backup'}</code>
      </div>
    </div>
  );
}
