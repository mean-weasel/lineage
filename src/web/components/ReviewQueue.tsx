import { useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { AssetReviewState, GrowthAsset, ReviewQueueSnapshot, ReviewableAsset } from '../../shared/types';
import { formatDate } from '../../shared/format';
import { api } from '../api';
import { assetStorageState, placementSummary } from '../assetUi';
import { defaultOpenReviewLane } from './reviewQueueModel';
import './ReviewQueue.css';

const columns = [
  ['needsQa', 'Needs QA'],
  ['approvedLocal', 'Approved'],
  ['needsRevision', 'Revise'],
  ['rejectedLocal', 'Rejected'],
  ['readyToPost', 'S3 ready'],
  ['scheduled', 'Scheduled'],
  ['posted', 'Posted'],
] as const;

export function ReviewQueue(props: {
  channel: string;
  onCopy: (text: string, label: string) => Promise<void>;
  onLocalReview: (asset: ReviewableAsset, reviewState: AssetReviewState) => Promise<void>;
  onOpenBackup: (asset: GrowthAsset) => void;
  onSelectAsset: (asset: GrowthAsset) => void;
  project: string;
  selected?: GrowthAsset;
}) {
  const [queue, setQueue] = useState<ReviewQueueSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingReview, setPendingReview] = useState<string | null>(null);
  const [selectedReviewIds, setSelectedReviewIds] = useState<string[]>([]);
  const [batchNotes, setBatchNotes] = useState('');

  async function refresh() {
    try {
      const params = new URLSearchParams({ project: props.project, limit: '4' });
      if (props.channel !== 'all') params.set('channel', props.channel);
      setQueue(await api<ReviewQueueSnapshot>(`/api/review/queue?${params.toString()}`));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refresh();
  }, [props.project, props.channel]);

  if (error) return <section className="review-queue"><div className="toast error">{error}</div></section>;
  if (!queue) return <section className="review-queue"><div className="asset-board"><div className="board-head"><h2>Loading review queue</h2></div></div></section>;

  const localReviewTotal = queue.totals.needsQa + queue.totals.approvedLocal + queue.totals.needsRevision + queue.totals.rejectedLocal;
  const visibleReviewIds = new Set(queue.lanes.flatMap(lane => [
    ...lane.needsQa,
    ...lane.approvedLocal,
    ...lane.needsRevision,
    ...lane.rejectedLocal,
  ]).map(asset => asset.asset_id));
  const activeReviewIds = selectedReviewIds.filter(assetId => visibleReviewIds.has(assetId));
  const firstOpenLane = defaultOpenReviewLane(queue.lanes);

  function toggleReviewSelection(assetId: string) {
    setSelectedReviewIds(current => current.includes(assetId) ? current.filter(id => id !== assetId) : [...current, assetId]);
  }

  async function markBatch(reviewState: AssetReviewState) {
    if (activeReviewIds.length === 0) return;
    setPendingReview('batch');
    try {
      await api('/api/local-review/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetIds: activeReviewIds,
          confirmWrite: true,
          notes: batchNotes,
          project: props.project,
          reviewState,
        }),
      });
      setSelectedReviewIds(current => current.filter(assetId => !visibleReviewIds.has(assetId)));
      setBatchNotes('');
      await refresh();
    } finally {
      setPendingReview(null);
    }
  }

  return (
    <section className="review-queue">
      <div className="review-summary">
        <div>
          <h2>{queue.project} review queue</h2>
          <p>Local-first queue for bleep assets, channel posting state, and agent handoff.</p>
          <p>{queue.totals.channels} channels · refreshed {formatDate(queue.fetchedAt)}</p>
        </div>
        <QueueStat label="Local review" value={localReviewTotal} />
        <QueueStat label="S3 ready" value={queue.totals.readyToPost} />
        <QueueStat label="Scheduled" value={queue.totals.scheduled} />
        <QueueStat label="Posted" value={queue.totals.posted} />
      </div>
      {activeReviewIds.length > 0 ? <div className="batch-review-strip" aria-label="Batch local review actions">
        <strong>{activeReviewIds.length} selected</strong>
        <textarea
          aria-label="Shared batch review notes"
          onChange={event => setBatchNotes(event.target.value)}
          placeholder="Shared review notes"
          rows={2}
          value={batchNotes}
        />
        <button disabled={activeReviewIds.length === 0 || pendingReview === 'batch'} onClick={() => void markBatch('approved')} type="button">Approve</button>
        <button disabled={activeReviewIds.length === 0 || pendingReview === 'batch'} onClick={() => void markBatch('needs_revision')} type="button">Needs revision</button>
        <button disabled={activeReviewIds.length === 0 || pendingReview === 'batch'} onClick={() => void markBatch('rejected')} type="button">Reject</button>
      </div> : null}
      <div className="queue-lanes">
        {queue.lanes.map(lane => (
          <details className="queue-lane" key={lane.channel} open={props.channel !== 'all' || lane.channel === firstOpenLane}>
            <summary>
              <h3>{lane.channel}</h3>
              <div className="lane-counts">
                <span>{lane.totals.needsQa} qa</span>
                <span>{lane.totals.approvedLocal} approved</span>
                <span>{lane.totals.needsRevision} revise</span>
                <span>{lane.totals.readyToPost} ready</span>
                <span>{lane.totals.scheduled} scheduled</span>
                <span>{lane.totals.posted} posted</span>
              </div>
            </summary>
            <div className="queue-columns">
              {columns.filter(([key]) => lane[key].length > 0).map(([key, label]) => (
                <QueueColumn
                  assets={lane[key]}
                  key={key}
                  label={label}
                  onCopy={props.onCopy}
                  onLocalReview={async (asset, reviewState) => {
                    setPendingReview(asset.asset_id);
                    try {
                      await props.onLocalReview(asset, reviewState);
                      await refresh();
                    } finally {
                      setPendingReview(null);
                    }
                  }}
                  onOpenBackup={props.onOpenBackup}
                  onSelectAsset={props.onSelectAsset}
                  pendingReview={pendingReview}
                  selected={props.selected}
                  selectedReviewIds={activeReviewIds}
                  onToggleReviewSelection={toggleReviewSelection}
                />
              ))}
              {columns.every(([key]) => lane[key].length === 0) && <p className="review-empty">No items in this channel.</p>}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function QueueStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="queue-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function QueueColumn(props: {
  assets: GrowthAsset[];
  label: string;
  onCopy: (text: string, label: string) => Promise<void>;
  onLocalReview: (asset: ReviewableAsset, reviewState: AssetReviewState) => Promise<void>;
  onOpenBackup: (asset: GrowthAsset) => void;
  onSelectAsset: (asset: GrowthAsset) => void;
  pendingReview: string | null;
  selected?: GrowthAsset;
  selectedReviewIds: string[];
  onToggleReviewSelection: (assetId: string) => void;
}) {
  return (
    <div className="queue-column">
      <h4>{props.label}</h4>
      {props.assets.map(asset => (
        <QueueCard
          asset={asset}
          key={asset.asset_id}
          onCopy={props.onCopy}
          onLocalReview={props.onLocalReview}
          onOpenBackup={props.onOpenBackup}
          onSelectAsset={props.onSelectAsset}
          onToggleReviewSelection={props.onToggleReviewSelection}
          pendingReview={props.pendingReview === asset.asset_id}
          selected={props.selected?.asset_id === asset.asset_id}
          selectedForReview={props.selectedReviewIds.includes(asset.asset_id)}
        />
      ))}
    </div>
  );
}

function QueueCard(props: {
  asset: GrowthAsset;
  onCopy: (text: string, label: string) => Promise<void>;
  onLocalReview: (asset: ReviewableAsset, reviewState: AssetReviewState) => Promise<void>;
  onOpenBackup: (asset: GrowthAsset) => void;
  onSelectAsset: (asset: GrowthAsset) => void;
  onToggleReviewSelection: (assetId: string) => void;
  pendingReview: boolean;
  selected: boolean;
  selectedForReview: boolean;
}) {
  const storage = assetStorageState(props.asset);
  const localReviewState = props.asset.local ? reviewState(props.asset) : null;
  const isApprovedLocal = localReviewState === 'approved';
  const inspectCommand = props.asset.source === 'local'
    ? `npm run studio:cli -- local inspect --asset-id ${props.asset.asset_id} --json`
    : `npm run studio:cli -- inspect --asset-id ${props.asset.asset_id} --json`;
  return (
    <article
      className={`queue-card ${props.selected ? 'selected' : ''}`}
      onClick={() => props.onSelectAsset(props.asset)}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') props.onSelectAsset(props.asset);
      }}
      role="button"
      tabIndex={0}
    >
      {localReviewState ? (
        <label className="confirm-line" onClick={event => event.stopPropagation()} onKeyDown={stopActionKeyDown}>
          <input
            checked={props.selectedForReview}
            onChange={() => props.onToggleReviewSelection(props.asset.asset_id)}
            type="checkbox"
          />
          <span>Select for batch review</span>
        </label>
      ) : null}
      <strong>{props.asset.title}</strong>
      <small>{props.asset.asset_id}</small>
      <div className="lane-counts">
        <span className={`storage-chip ${storage.kind}`}>{storage.label}</span>
        <span className="queue-tag">{placementSummary(props.asset)}</span>
        {localReviewState ? <span className={`review-chip ${localReviewState}`}>{reviewLabel(localReviewState)}</span> : null}
      </div>
      {localReviewState ? (
        <div className="review-actions" aria-label={`Local review actions for ${props.asset.title}`} onKeyDown={stopActionKeyDown}>
          <button
            aria-pressed={localReviewState === 'approved'}
            disabled={props.pendingReview}
            type="button"
            onClick={event => markLocalReview(event, props.onLocalReview, props.asset, 'approved')}
          >
            Approve
          </button>
          <button
            aria-pressed={localReviewState === 'needs_revision'}
            disabled={props.pendingReview}
            type="button"
            onClick={event => markLocalReview(event, props.onLocalReview, props.asset, 'needs_revision')}
          >
            Needs revision
          </button>
          <button
            aria-pressed={localReviewState === 'rejected'}
            disabled={props.pendingReview}
            type="button"
            onClick={event => markLocalReview(event, props.onLocalReview, props.asset, 'rejected')}
          >
            Reject
          </button>
        </div>
      ) : null}
      <div className="queue-actions" onKeyDown={stopActionKeyDown}>
        <button type="button" onClick={event => copyCommand(event, props.onCopy, inspectCommand)}>Copy inspect</button>
        {props.asset.local ? (
          isApprovedLocal ? (
            <button type="button" onClick={event => openBackup(event, props.onOpenBackup, props.asset)}>Back up</button>
          ) : (
            <span className="backup-locked" title="Approve this local asset before backup">Backup locked until approved.</span>
          )
        ) : null}
      </div>
    </article>
  );
}

function reviewState(asset: GrowthAsset): AssetReviewState {
  return (asset as ReviewableAsset).review?.review_state || 'unreviewed';
}

function reviewLabel(state: AssetReviewState): string {
  if (state === 'needs_revision') return 'needs revision';
  return state;
}

function copyCommand(event: MouseEvent, onCopy: (text: string, label: string) => Promise<void>, command: string) {
  event.stopPropagation();
  void onCopy(command, 'inspect command');
}

function markLocalReview(
  event: MouseEvent,
  onLocalReview: (asset: ReviewableAsset, reviewState: AssetReviewState) => Promise<void>,
  asset: GrowthAsset,
  reviewState: AssetReviewState
) {
  event.stopPropagation();
  void onLocalReview(asset as ReviewableAsset, reviewState);
}

function openBackup(event: MouseEvent, onOpenBackup: (asset: GrowthAsset) => void, asset: GrowthAsset) {
  event.stopPropagation();
  onOpenBackup(asset);
}

function stopActionKeyDown(event: KeyboardEvent<HTMLElement>) {
  if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
}
