import { useState } from 'react';
import { Archive, CalendarClock, CheckCircle2, Copy, Download, ExternalLink, Send, Trash2 } from 'lucide-react';
import type { GrowthAsset } from '../../shared/types';
import { formatBytes, formatDate } from '../../shared/format';
import { assetSize, assetStorageState, assetUpdatedAt, canPreview, contentIcon } from '../assetUi';

export function Inspector({
  asset,
  previewUrl,
  previewError,
  onPresign,
  onPromote,
  onArchive,
  onCopy,
  onCopyPreview,
  onDelete,
  onPlacement,
  onPull,
  onToggleBackup,
  selectedForBackup,
}: {
  asset?: GrowthAsset;
  previewUrl: string | null;
  previewError?: string | null;
  onPresign: (asset: GrowthAsset) => void;
  onPromote: (asset: GrowthAsset) => void;
  onArchive: (asset: GrowthAsset) => void;
  onCopy: (text: string, label: string) => void;
  onCopyPreview: (asset: GrowthAsset) => void;
  onDelete: (asset: GrowthAsset, confirmation: string) => void;
  onPlacement: (asset: GrowthAsset, status: 'scheduled' | 'posted', values: { scheduledAt?: string; postedAt?: string; url?: string }) => void;
  onPull: (asset: GrowthAsset) => void;
  onToggleBackup: (asset: GrowthAsset) => void;
  selectedForBackup: boolean;
}) {
  if (!asset) return <aside className="inspector empty">No asset selected</aside>;
  const Icon = contentIcon(asset.content_type);
  const canEmbedPreview = previewUrl && canPreview(asset);
  const isLocal = asset.source === 'local';
  const storage = assetStorageState(asset);
  return (
    <aside className="inspector">
      <div className="preview-pane">
        {canEmbedPreview && asset.content_type === 'video' ? (
          <video src={previewUrl} controls />
        ) : canEmbedPreview ? (
          <img src={previewUrl} alt={asset.title} />
        ) : (
          <div className="preview-placeholder">
            <Icon size={36} />
            <span>{asset.content_type}</span>
            <small>{previewError ? 'Preview unavailable' : storage.description}</small>
            {previewError && (
              <details className="preview-error">
                <summary>Details</summary>
                <code>{previewError}</code>
              </details>
            )}
          </div>
        )}
      </div>
      <div className="inspector-title">
        <span className={`status-chip ${asset.status}`}>{asset.status}</span>
        <span className={`storage-chip ${storage.kind}`} title={storage.description}>{storage.label}</span>
        <h2>{asset.title}</h2>
        <p>{asset.hook}</p>
      </div>
      <div className="action-grid">
        <button onClick={() => onPresign(asset)}><ExternalLink size={16} />Preview</button>
        <button onClick={() => onCopyPreview(asset)} disabled={!canPreview(asset)}><Copy size={16} />Copy link</button>
        <button onClick={() => onPull(asset)} disabled={!asset.s3?.key}><Download size={16} />Pull</button>
        <button onClick={() => onPromote(asset)} disabled={isLocal || asset.status === 'published'}><CheckCircle2 size={16} />Promote</button>
        <button onClick={() => onArchive(asset)} disabled={isLocal || asset.status === 'archived'}><Archive size={16} />Archive</button>
        <button onClick={() => onToggleBackup(asset)} disabled={!isLocal}>{selectedForBackup ? 'Selected' : 'Select backup'}</button>
        <button onClick={() => onCopy(asset.asset_id, 'asset ID')}><Copy size={16} />Copy ID</button>
        <button onClick={() => onCopy(asset.s3?.key || '', 'S3 key')} disabled={!asset.s3?.key}><Copy size={16} />Copy key</button>
      </div>
      <DetailSection asset={asset} />
      {!isLocal && <PlacementSection asset={asset} onPlacement={onPlacement} />}
      {!isLocal && <DangerSection key={asset.asset_id} asset={asset} onDelete={onDelete} />}
    </aside>
  );
}

function DangerSection({
  asset,
  onDelete,
}: {
  asset: GrowthAsset;
  onDelete: (asset: GrowthAsset, confirmation: string) => void;
}) {
  const [confirmation, setConfirmation] = useState('');
  const required = `delete ${asset.asset_id}`;
  return (
    <section className="danger-section">
      <label>Delete confirmation<input value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder={required} /></label>
      <button disabled={confirmation !== required} onClick={() => onDelete(asset, confirmation)}><Trash2 size={16} />Delete object</button>
    </section>
  );
}

function PlacementSection({
  asset,
  onPlacement,
}: {
  asset: GrowthAsset;
  onPlacement: (asset: GrowthAsset, status: 'scheduled' | 'posted', values: { scheduledAt?: string; postedAt?: string; url?: string }) => void;
}) {
  const [scheduledAt, setScheduledAt] = useState('');
  const [postedAt, setPostedAt] = useState('');
  const [url, setUrl] = useState('');
  return (
    <section className="detail-section placement-section">
      <h3>Placement</h3>
      {asset.placements?.length ? (
        <div className="placement-list">
          {asset.placements.map(placement => (
            <div key={`${placement.channel}-${placement.updated_at}`} className="placement-item">
              <span className={`placement-chip ${placement.status}`}>{placement.channel}: {placement.status}</span>
              <small>{placement.posted_at || placement.scheduled_at || placement.updated_at}</small>
              {placement.url && <a href={placement.url} target="_blank" rel="noreferrer">Open</a>}
            </div>
          ))}
        </div>
      ) : (
        <p className="muted-copy">No placements yet</p>
      )}
      <label>Scheduled at<input type="datetime-local" value={scheduledAt} onChange={event => setScheduledAt(event.target.value)} /></label>
      <label>Posted at<input type="datetime-local" value={postedAt} onChange={event => setPostedAt(event.target.value)} /></label>
      <label>Posted URL<input placeholder="https://..." value={url} onChange={event => setUrl(event.target.value)} /></label>
      <div className="action-grid">
        <button onClick={() => onPlacement(asset, 'scheduled', { scheduledAt })}><CalendarClock size={16} />Scheduled</button>
        <button onClick={() => onPlacement(asset, 'posted', { postedAt: postedAt || new Date().toISOString(), url })}><Send size={16} />Posted</button>
      </div>
    </section>
  );
}

function DetailSection({ asset }: { asset: GrowthAsset }) {
  return (
    <>
      <section className="detail-section">
        <h3>Metadata</h3>
        <dl>
          <div><dt>Asset ID</dt><dd>{asset.asset_id}</dd></div>
          <div><dt>Campaign</dt><dd>{asset.campaign}</dd></div>
          <div><dt>Channel</dt><dd>{asset.channel}</dd></div>
          <div><dt>Audience</dt><dd>{asset.audience}</dd></div>
          <div><dt>CTA</dt><dd>{asset.cta}</dd></div>
          <div><dt>UTM</dt><dd>{asset.utm_content}</dd></div>
          <div><dt>Storage</dt><dd>{assetStorageState(asset).label}</dd></div>
          <div><dt>Source</dt><dd>{asset.source || 'catalog'}</dd></div>
        </dl>
      </section>
      {asset.local && (
        <section className="detail-section">
          <h3>Local</h3>
          <dl>
            <div><dt>Size</dt><dd>{formatBytes(assetSize(asset))}</dd></div>
            <div><dt>Updated</dt><dd>{formatDate(assetUpdatedAt(asset))}</dd></div>
            <div><dt>Checksum</dt><dd>{asset.local.checksum_sha256.slice(0, 12)}</dd></div>
          </dl>
          <code className="object-key">{asset.local.relative_path}</code>
        </section>
      )}
      <section className="detail-section">
        <h3>S3</h3>
        <dl>
          <div><dt>Bucket</dt><dd>{asset.s3?.bucket || 'not uploaded'}</dd></div>
          <div><dt>Size</dt><dd>{formatBytes(asset.s3?.size_bytes)}</dd></div>
          <div><dt>Updated</dt><dd>{formatDate(asset.s3?.updated_at)}</dd></div>
          <div><dt>ETag</dt><dd>{asset.s3?.etag || 'none'}</dd></div>
        </dl>
        <code className="object-key">{asset.s3?.key || 'No object key yet'}</code>
      </section>
    </>
  );
}
