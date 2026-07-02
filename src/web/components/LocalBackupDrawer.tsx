import { useState } from 'react';
import { Loader2, UploadCloud } from 'lucide-react';
import type { AssetReviewState, GrowthAsset, MutationResponse, ReviewableAsset } from '../../shared/types';
import { slug } from '../../shared/format';
import { api } from '../api';
import './LocalBackup.css';

export function LocalBackupDrawer({
  assets,
  onClose,
  onDone,
  onError,
  project,
}: {
  assets: GrowthAsset[];
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
  onError: (message: string) => void;
  project: string;
}) {
  const first = assets[0];
  const [confirmWrite, setConfirmWrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string[]>([]);
  const [form, setForm] = useState({
    audience: first?.audience || 'local-review',
    campaign: first?.campaign || 'local-review',
    channel: first?.channel === 'local' ? 'meta' : first?.channel || 'meta',
    cta: first?.cta || 'Review before upload',
    status: 'working' as 'working' | 'published',
  });
  const lockedAssets = assets.filter(asset => !isApprovedLocal(asset));
  const isLocked = lockedAssets.length > 0 || assets.length === 0;

  function update(key: keyof typeof form, value: string) {
    setForm(current => ({ ...current, [key]: value }));
  }

  function payload(asset: GrowthAsset, dryRun: boolean) {
    const assetId = slug(asset.title) || asset.asset_id;
    return {
      ...form,
      assetId,
      confirmWrite,
      dryRun,
      hook: asset.hook,
      notes: asset.notes,
      path: asset.local?.relative_path,
      project,
      title: asset.title,
      type: asset.content_type,
      utmContent: asset.utm_content || assetId.replaceAll('-', '_'),
    };
  }

  async function submit(dryRun: boolean) {
    if (isLocked) {
      onError('Local backup is locked until every selected local asset is approved.');
      return;
    }
    setBusy(true);
    try {
      const results = [];
      for (const asset of assets) {
        if (!asset.local?.relative_path) throw new Error(`${asset.asset_id} has no local path`);
        const result = await api<MutationResponse>('/api/assets/local-backup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload(asset, dryRun)),
        });
        results.push(result.message);
      }
      if (dryRun) setPreview(results);
      else await onDone(`Backed up ${assets.length} local asset${assets.length === 1 ? '' : 's'}`);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="drawer-backdrop">
      <section className="local-backup-drawer">
        <header><div><h2>Back up local assets</h2><p>{project}</p></div><button onClick={onClose}>Close</button></header>
        <div className="local-backup-list">
          {assets.map(asset => (
            <div key={asset.asset_id}>
              <strong>{slug(asset.title) || asset.asset_id}</strong>
              <span>{asset.local?.relative_path}</span>
              <span>Review: {reviewLabel(reviewState(asset))}</span>
            </div>
          ))}
        </div>
        {isLocked && (
          <div className="local-backup-warning" role="alert">
            <strong>Backup is locked until local review is approved.</strong>
            {assets.length === 0 ? <span>No local assets are selected.</span> : null}
            {lockedAssets.map(asset => (
              <span key={asset.asset_id}>{slug(asset.title) || asset.asset_id}: {reviewLabel(reviewState(asset))}</span>
            ))}
          </div>
        )}
        <div className="form-grid">
          <label>Campaign<input value={form.campaign} onChange={event => update('campaign', event.target.value)} /></label>
          <label>Channel<input value={form.channel} onChange={event => update('channel', event.target.value)} /></label>
          <label>Audience<input value={form.audience} onChange={event => update('audience', event.target.value)} /></label>
          <label>Status<select value={form.status} onChange={event => update('status', event.target.value)}><option>working</option><option>published</option></select></label>
          <label className="wide">CTA<input value={form.cta} onChange={event => update('cta', event.target.value)} /></label>
        </div>
        {preview.length > 0 && <div className="local-backup-preview">{preview.map(item => <span key={item}>{item}</span>)}</div>}
        <label className="confirm-line"><input checked={confirmWrite} type="checkbox" onChange={event => setConfirmWrite(event.target.checked)} /><span>Confirm write to the production asset bucket</span></label>
        <footer>
          <button disabled={busy || isLocked} onClick={() => void submit(true)}>Dry run</button>
          <button className="primary-button" disabled={busy || isLocked || !confirmWrite} onClick={() => void submit(false)}>{busy ? <Loader2 className="spin" size={16} /> : <UploadCloud size={16} />}Back up</button>
        </footer>
      </section>
    </div>
  );
}

function reviewState(asset: GrowthAsset): AssetReviewState {
  return (asset as ReviewableAsset).review?.review_state || 'unreviewed';
}

// eslint-disable-next-line react-refresh/only-export-components
export function isApprovedLocal(asset: GrowthAsset): boolean {
  return Boolean(asset.local?.relative_path) && reviewState(asset) === 'approved';
}

function reviewLabel(state: AssetReviewState): string {
  if (state === 'needs_revision') return 'needs revision';
  return state;
}
