import { ChevronLeft, ChevronRight, Link2 } from 'lucide-react';
import type { AssetLibrarySnapshot, ContentPost } from '../../shared/types';
import { assetStorageLabel } from './contentAssetLabels';

export function ContentAssetCandidates({
  loading,
  onAttach,
  onOpenAsset,
  onPage,
  page,
  post,
  snapshot,
}: {
  loading: boolean;
  onAttach: (assetId: string) => Promise<void>;
  onOpenAsset: (assetId: string) => void;
  onPage: (page: number) => void;
  page: number;
  post: ContentPost;
  snapshot: AssetLibrarySnapshot | null;
}) {
  const attached = new Set(post.assets.map(asset => asset.asset_id));
  const assets = snapshot?.assets || [];
  const pagination = snapshot?.pagination;
  return (
    <aside className="asset-candidates" aria-label="Candidate assets">
      <header>
        <div>
          <strong>Candidate assets</strong>
          <p>{post.channel} · not posted · page {pagination?.page || page} of {pagination?.totalPages || 1}</p>
        </div>
        {loading && <span>Loading</span>}
      </header>
      <div className="candidate-list">
        {assets.map(asset => (
          <article key={asset.asset_id}>
            <button className="candidate-title" onClick={() => onOpenAsset(asset.asset_id)} type="button">
              <strong>{asset.title}</strong>
              <code>{asset.asset_id}</code>
            </button>
            <span>{asset.content_type} · {assetStorageLabel(asset)}</span>
            <button disabled={attached.has(asset.asset_id)} onClick={() => void onAttach(asset.asset_id)} type="button">
              <Link2 size={15} />{attached.has(asset.asset_id) ? 'Attached' : 'Attach'}
            </button>
          </article>
        ))}
        {!loading && assets.length === 0 && <p>No candidate assets for this channel yet.</p>}
      </div>
      <div className="candidate-pager">
        <button disabled={!pagination || pagination.page <= 1} onClick={() => onPage(page - 1)} type="button"><ChevronLeft size={15} />Prev</button>
        <button disabled={!pagination || pagination.page >= pagination.totalPages} onClick={() => onPage(page + 1)} type="button">Next<ChevronRight size={15} /></button>
      </div>
    </aside>
  );
}
