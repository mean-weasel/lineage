import { CheckCircle2, Clipboard, UploadCloud } from 'lucide-react';
import type { AssetLibrarySnapshot, AssetReviewState, GrowthAsset, ReviewableAsset } from '../../shared/types';
import { formatBytes, formatDate } from '../../shared/format';
import { assetStorageState } from '../assetUi';
import { lineageCliCommand, type LineageCliIdentity } from '../lineageRuntimeCommand';
import './LocalBackupQueue.css';

type LaneKey = 'unreviewed' | 'approved' | 'needs_revision' | 'rejected';

const lanes: Array<[LaneKey, string]> = [
  ['unreviewed', 'Needs review'],
  ['approved', 'Approved keepers'],
  ['needs_revision', 'Needs revision'],
  ['rejected', 'Rejected or ignored'],
];

export function LocalBackupQueue(props: {
  assets: GrowthAsset[];
  cli?: LineageCliIdentity | null;
  onCopy: (text: string, label: string) => Promise<void>;
  onLocalReview: (asset: ReviewableAsset, reviewState: AssetReviewState) => Promise<void>;
  onOpenBackup: () => void;
  onQueueBackup: (asset: GrowthAsset) => void;
  onSelectAsset: (asset: GrowthAsset) => void;
  page: number;
  pageSize: number;
  project: string;
  selected?: GrowthAsset;
  selectedBackupIds: string[];
  setPage: React.Dispatch<React.SetStateAction<number>>;
  setPageSize: (value: number) => void;
  snapshot: AssetLibrarySnapshot | null;
}) {
  const localAssets = props.assets.filter(asset => asset.local?.relative_path && !asset.s3?.key);
  const approved = localAssets.filter(asset => reviewState(asset) === 'approved');
  const selectedCount = props.selectedBackupIds.length;
  const queueCommand = lineageCliCommand(props.cli || null, `local queue --project '${props.project}'`);

  function selectApproved() {
    for (const asset of approved) props.onQueueBackup(asset);
  }

  return (
    <section className="local-backup-queue">
      <header className="backup-queue-head">
        <div>
          <h2>Local Backup Queue</h2>
          <p>Review local-only candidates, select approved keepers, then back them up intentionally.</p>
          <p>{props.snapshot?.catalog.default_bucket || 'No bucket loaded'} · refreshed {formatDate(props.snapshot?.fetchedAt)}</p>
        </div>
        <div className="backup-queue-actions">
          <button disabled={approved.length === 0} onClick={selectApproved} type="button">
            <CheckCircle2 size={15} /> Select approved
          </button>
          <button disabled={selectedCount === 0} onClick={props.onOpenBackup} type="button">
            <UploadCloud size={15} /> Back up selected
          </button>
        </div>
      </header>
      <div className="backup-queue-stats" aria-label="Local backup queue summary">
        <Stat label="Local only" value={localAssets.length} />
        <Stat label="Needs review" value={localAssets.filter(asset => reviewState(asset) === 'unreviewed').length} />
        <Stat label="Approved" value={approved.length} />
        <Stat label="Selected" value={selectedCount} />
      </div>
      <div className="handoff-strip">
        <code>{queueCommand}</code>
        <button onClick={() => void props.onCopy(queueCommand, 'local backup queue command')} type="button">
          <Clipboard size={14} /> Copy
        </button>
      </div>
      {localAssets.length === 0 ? (
        <div className="backup-empty">No local-only assets are waiting for review or backup.</div>
      ) : (
        <div className="backup-queue-grid">
          {lanes.map(([key, label]) => (
            <section className="backup-queue-lane" key={key}>
              <h3>{label}</h3>
              {localAssets.filter(asset => laneFor(asset) === key).map(asset => (
                <BackupQueueCard
                  asset={asset}
                  key={asset.asset_id}
                  onLocalReview={props.onLocalReview}
                  onQueueBackup={props.onQueueBackup}
                  onSelectAsset={props.onSelectAsset}
                  selected={props.selected?.asset_id === asset.asset_id}
                  selectedForBackup={props.selectedBackupIds.includes(asset.asset_id)}
                />
              ))}
            </section>
          ))}
        </div>
      )}
      <footer className="pagination-bar">
        <button disabled={!props.snapshot || props.snapshot.pagination.page <= 1} onClick={() => props.setPage(value => Math.max(value - 1, 1))} type="button">
          Previous
        </button>
        <span>{props.snapshot?.pagination.page || props.page} of {props.snapshot?.pagination.totalPages || 1}</span>
        <button disabled={!props.snapshot || props.snapshot.pagination.page >= props.snapshot.pagination.totalPages} onClick={() => props.setPage(value => value + 1)} type="button">
          Next
        </button>
        <label>
          Per page
          <select onChange={event => props.setPageSize(Number(event.target.value))} value={props.pageSize}>
            {[10, 25, 50, 100].map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </footer>
    </section>
  );
}

function BackupQueueCard(props: {
  asset: GrowthAsset;
  onLocalReview: (asset: ReviewableAsset, reviewState: AssetReviewState) => Promise<void>;
  onQueueBackup: (asset: GrowthAsset) => void;
  onSelectAsset: (asset: GrowthAsset) => void;
  selected: boolean;
  selectedForBackup: boolean;
}) {
  const state = reviewState(props.asset);
  const storage = assetStorageState(props.asset);
  const approved = state === 'approved';
  return (
    <article className={`backup-queue-card ${props.selected ? 'selected' : ''}`}>
      <strong>{props.asset.title}</strong>
      <code>{props.asset.asset_id}</code>
      <small>{props.asset.local?.relative_path}</small>
      <div className="backup-card-meta">
        <span>{storage.label}</span>
        <span>{reviewLabel(state)}</span>
        <span>{formatBytes(props.asset.local?.size_bytes)}</span>
      </div>
      <div className="backup-card-actions">
        <button onClick={() => props.onSelectAsset(props.asset)} type="button">Open</button>
        <button aria-pressed={state === 'approved'} onClick={() => void props.onLocalReview(props.asset as ReviewableAsset, 'approved')} type="button">Approve</button>
        <button aria-pressed={state === 'needs_revision'} onClick={() => void props.onLocalReview(props.asset as ReviewableAsset, 'needs_revision')} type="button">Revise</button>
        <button aria-pressed={state === 'rejected'} onClick={() => void props.onLocalReview(props.asset as ReviewableAsset, 'rejected')} type="button">Reject</button>
        <button disabled={!approved} onClick={() => props.onQueueBackup(props.asset)} type="button">
          {props.selectedForBackup ? 'Selected' : approved ? 'Select backup' : 'Approve first'}
        </button>
      </div>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function reviewState(asset: GrowthAsset): AssetReviewState {
  return (asset as ReviewableAsset).review?.review_state || 'unreviewed';
}

function laneFor(asset: GrowthAsset): LaneKey {
  const state = reviewState(asset);
  if (state === 'ignored') return 'rejected';
  return state;
}

function reviewLabel(state: AssetReviewState): string {
  if (state === 'needs_revision') return 'needs revision';
  return state;
}
