import { Database, RefreshCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AssetLedgerIndexSummary, AssetLedgerRecord, AssetLedgerSnapshot } from '../../shared/types';
import { formatDate } from '../../shared/format';
import { api } from '../api';
import './LedgerView.css';

type LedgerStorageFilter = 'all' | 'local-only' | 's3-backed' | 'local-and-s3';
type LedgerReviewFilter = 'all' | 'unreviewed' | 'approved' | 'needs_revision';
type LedgerPlacementFilter = 'all' | 'scheduled' | 'posted' | 'not-posted' | 'not-scheduled';
type LedgerSelectionFilter = 'all' | 'selected' | 'not-selected';

interface LedgerPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface LedgerResponse extends AssetLedgerSnapshot {
  index_summary?: AssetLedgerIndexSummary;
  pagination: LedgerPagination;
}

const storageFilters: Array<[LedgerStorageFilter, string]> = [
  ['all', 'All storage'],
  ['local-only', 'Local only'],
  ['s3-backed', 'S3 backed'],
  ['local-and-s3', 'Local + S3'],
];

const reviewFilters: Array<[LedgerReviewFilter, string]> = [
  ['all', 'All review'],
  ['unreviewed', 'Needs review'],
  ['approved', 'Approved'],
  ['needs_revision', 'Needs revision'],
];

const placementFilters: Array<[LedgerPlacementFilter, string]> = [
  ['all', 'All placement'],
  ['scheduled', 'Scheduled'],
  ['posted', 'Posted'],
  ['not-posted', 'Not posted'],
  ['not-scheduled', 'No schedule'],
];

const selectionFilters: Array<[LedgerSelectionFilter, string]> = [
  ['all', 'All lineage'],
  ['selected', 'Next variation'],
  ['not-selected', 'Not selected'],
];

function sourceLabel(record: AssetLedgerRecord): string {
  const sourceTypes = new Set(record.sources.map(source => source.source_type));
  if (sourceTypes.has('local') && sourceTypes.has('s3')) return 'local + S3';
  if (sourceTypes.has('local')) return 'local only';
  if (sourceTypes.has('s3')) return 'S3 backed';
  return 'catalog only';
}

function placementLabel(record: AssetLedgerRecord): string {
  const latest = record.workflow.placements.at(-1);
  return latest ? `${latest.channel}: ${latest.status}` : 'not scheduled';
}

function workflowClass(record: AssetLedgerRecord): string {
  if (record.workflow.selection) return 'selected';
  if (record.workflow.placements.some(placement => placement.status === 'posted')) return 'posted';
  if (record.workflow.placements.some(placement => placement.status === 'scheduled')) return 'scheduled';
  if (record.workflow.review?.review_state === 'approved') return 'approved';
  return 'working';
}

export function LedgerView({
  project,
  query,
  onOpenAsset,
}: {
  project: string;
  query: string;
  onOpenAsset: (assetId: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<LedgerResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openRecordId, setOpenRecordId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [placement, setPlacement] = useState<LedgerPlacementFilter>('all');
  const [review, setReview] = useState<LedgerReviewFilter>('all');
  const [selection, setSelection] = useState<LedgerSelectionFilter>('all');
  const [storage, setStorage] = useState<LedgerStorageFilter>('all');

  const params = useMemo(() => {
    const search = new URLSearchParams({ project, page: String(page), pageSize: String(pageSize) });
    if (query.trim()) search.set('q', query.trim());
    if (placement !== 'all') search.set('placement', placement);
    if (review !== 'all') search.set('review', review);
    if (selection !== 'all') search.set('selection', selection);
    if (storage !== 'all') search.set('storage', storage);
    return search;
  }, [page, pageSize, placement, project, query, review, selection, storage]);

  async function refresh(refreshIndex = false) {
    setError(null);
    setLoading(true);
    setIndexing(refreshIndex);
    try {
      const search = new URLSearchParams(params);
      if (refreshIndex) search.set('refresh', 'true');
      setSnapshot(await api<LedgerResponse>(`/api/ledger?${search.toString()}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setIndexing(false);
    }
  }

  useEffect(() => {
    setPage(1);
  }, [project, query, pageSize, placement, review, selection, storage]);

  useEffect(() => {
    void refresh(false);
  }, [params]);

  useEffect(() => {
    if (!snapshot || !openRecordId) return;
    if (!snapshot.records.some(record => record.id === openRecordId)) setOpenRecordId(null);
  }, [openRecordId, snapshot]);

  const records = snapshot?.records || [];

  return (
    <section className="ledger-view">
      <header className="ledger-head">
        <div>
          <h2>Ledger</h2>
          <p>SQLite truth table for local files, S3 objects, review state, posting state, and lineage selection.</p>
        </div>
        <div className="ledger-head-actions">
          <span>{snapshot?.last_index_run?.completed_at ? `Indexed ${formatDate(snapshot.last_index_run.completed_at)}` : 'Not indexed yet'}</span>
          <button className="secondary-button" disabled={loading} onClick={() => void refresh(true)}>
            {indexing ? <RefreshCcw className="spin" size={17} /> : <Database size={17} />}
            Refresh index
          </button>
        </div>
      </header>
      {error && <div className="ledger-error">{error}</div>}
      <div className="ledger-summary" aria-label="Ledger summary">
        <span><strong>{snapshot?.totals.records ?? 0}</strong> records</span>
        <span><strong>{snapshot?.totals.local ?? 0}</strong> local sources</span>
        <span><strong>{snapshot?.totals.s3 ?? 0}</strong> S3 sources</span>
        <span><strong>{snapshot?.totals.catalog ?? 0}</strong> catalog entries</span>
      </div>
      <div className="ledger-filters" aria-label="Ledger quick filters">
        <SelectFilter current={storage} label="Storage" options={storageFilters} setValue={setStorage} />
        <SelectFilter current={review} label="Review" options={reviewFilters} setValue={setReview} />
        <SelectFilter current={placement} label="Placement" options={placementFilters} setValue={setPlacement} />
        <SelectFilter current={selection} label="Lineage" options={selectionFilters} setValue={setSelection} />
      </div>
      <div className="ledger-list" aria-label="Asset ledger records">
        {records.map(record => (
          <LedgerRecordCard
            expanded={openRecordId === record.id}
            key={record.id}
            onOpenAsset={onOpenAsset}
            onToggle={() => setOpenRecordId(current => current === record.id ? null : record.id)}
            record={record}
          />
        ))}
      </div>
      {records.length === 0 && <div className="ledger-empty">No ledger records match these filters. Refresh the index or loosen the filters.</div>}
      <footer className="pagination-bar">
        <button disabled={!snapshot || snapshot.pagination.page <= 1} onClick={() => setPage(value => Math.max(value - 1, 1))}>Previous</button>
        <span>{snapshot?.pagination.page || 1} of {snapshot?.pagination.totalPages || 1}</span>
        <button disabled={!snapshot || snapshot.pagination.page >= snapshot.pagination.totalPages} onClick={() => setPage(value => value + 1)}>Next</button>
        <label>
          Per page
          <select onChange={event => setPageSize(Number(event.target.value))} value={pageSize}>
            {[10, 25, 50, 100].map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </footer>
    </section>
  );
}

function LedgerRecordCard({
  expanded,
  onOpenAsset,
  onToggle,
  record,
}: {
  expanded: boolean;
  onOpenAsset: (assetId: string) => void;
  onToggle: () => void;
  record: AssetLedgerRecord;
}) {
  return (
    <article className={`ledger-record ${workflowClass(record)} ${expanded ? 'expanded' : ''}`}>
      <button aria-expanded={expanded} className="ledger-record-main" onClick={onToggle} type="button">
        <div className="ledger-record-title">
          <strong>{record.title}</strong>
          <code>{record.canonical_asset_id}</code>
        </div>
        <div className="ledger-record-meta">
          <span>{record.media_type}</span>
          {record.channel ? <span>{record.channel}</span> : null}
          {record.campaign ? <span>{record.campaign}</span> : null}
        </div>
        <div className="ledger-record-states">
          <StatePill label={sourceLabel(record)} />
          <StatePill label={record.workflow.review?.review_state || 'unreviewed'} />
          <StatePill label={placementLabel(record)} />
          <StatePill label={record.workflow.selection ? 'next variation' : 'not selected'} />
        </div>
      </button>
      {expanded ? (
        <div className="ledger-record-detail">
          <section>
            <h3>Sources</h3>
            <ul>
              {record.sources.map(source => (
                <li key={source.id}>
                  <strong>{source.source_type}</strong>
                  <span>{source.local_path || source.s3_key || source.asset_id || 'source recorded'}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3>Workflow</h3>
            <p>Review: {record.workflow.review?.review_state || 'unreviewed'}</p>
            <p>Placement: {placementLabel(record)}</p>
            <p>Lineage: {record.workflow.selection ? `using ${record.workflow.selection.asset_id}` : 'not selected for next variation'}</p>
          </section>
          <button className="secondary-button" onClick={() => onOpenAsset(record.canonical_asset_id)} type="button">
            View in Assets
          </button>
        </div>
      ) : null}
    </article>
  );
}

function StatePill({ label }: { label: string }) {
  return <span className="ledger-pill">{label}</span>;
}

function SelectFilter<T extends string>({
  current,
  label,
  options,
  setValue,
}: {
  current: T;
  label: string;
  options: Array<[T, string]>;
  setValue: (value: T) => void;
}) {
  return (
    <label className="ledger-filter-group">
      <span>{label}</span>
      <select aria-label={label} onChange={event => setValue(event.target.value as T)} value={current}>
        {options.map(([value, optionLabel]) => (
          <option key={value} value={value}>{optionLabel}</option>
        ))}
      </select>
    </label>
  );
}
