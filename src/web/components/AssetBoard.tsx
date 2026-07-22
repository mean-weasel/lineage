import { useEffect, useState } from 'react';
import type { AssetLibrarySnapshot, AssetLookupSnapshot, AssetSelectionSnapshot, GrowthAsset } from '../../shared/types';
import { formatDate } from '../../shared/format';
import { api } from '../api';
import { lineageCliCommand, useLineageCli } from '../lineageRuntimeCommand';
import { AssetRow } from './AssetRow';
import { SelectionLedgerPanel } from './SelectionLedgerPanel';
import { assetBoardContext } from './assetBoardContext';
import './AssetBoard.css';

export function AssetBoard(props: {
  assets: GrowthAsset[];
  liveSync: boolean;
  onCopy?: (text: string, label: string) => void | Promise<void>;
  onSelectionChanged?: () => void;
  page: number;
  pageSize: number;
  previewUrls: Record<string, string>;
  project: string;
  selected?: GrowthAsset;
  setLiveSync: React.Dispatch<React.SetStateAction<boolean>>;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  setPageSize: (value: number) => void;
  setSelectedId: (value: string) => void;
  snapshot: AssetLibrarySnapshot | null;
  source: 'local' | 'catalog' | 'all';
  totals: { orphan: number };
}) {
  const cli = useLineageCli();
  const { snapshot } = props;
  const [selection, setSelection] = useState<AssetSelectionSnapshot | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [pendingSelectionId, setPendingSelectionId] = useState<string | null>(null);
  const [draftReviewLabels, setDraftReviewLabels] = useState<string[]>([]);
  const [candidateAssets, setCandidateAssets] = useState<GrowthAsset[]>([]);
  const [inspectedReviewSetId, setInspectedReviewSetId] = useState<string | null>(null);
  const selectedAssetIds = new Set(selection?.current.items.filter(item => item.selected_at && !item.deselected_at).map(item => item.asset_id) || []);
  const activeReviewSet = selection?.active_review_set || null;
  const reviewCandidateIds = [...new Set((selection?.review_sets || []).slice(0, 6).flatMap(set => set.items.map(item => item.asset_id)))];
  const reviewCandidateIdsKey = reviewCandidateIds.join('|');
  const selectedReviewLabels = activeReviewSet?.items
    .filter(item => item.selected_at && !item.deselected_at)
    .map(item => item.variation_label)
    .filter((label): label is string => Boolean(label)) || [];
  const selectedReviewLabelsKey = selectedReviewLabels.join('|');
  const boardContext = assetBoardContext(snapshot, props.source, activeReviewSet);

  async function refreshSelection() {
    setSelectionLoading(true);
    try {
      const params = new URLSearchParams({ project: props.project });
      setSelection(await api<AssetSelectionSnapshot>(`/api/selections?${params}`));
      setSelectionError(null);
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSelectionLoading(false);
    }
  }

  async function writeSelection(assetIds: string[], pendingId: string | null) {
    setPendingSelectionId(pendingId);
    try {
      const result = await api<{ current?: AssetSelectionSnapshot['current']; selection?: AssetSelectionSnapshot['current'] }>('/api/selections/current', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: props.project, assetIds, confirmWrite: true }),
      });
      setSelection(current => current ? { ...current, current: result.selection || result.current || current.current } : current);
      setSelectionError(null);
      props.onSelectionChanged?.();
      window.dispatchEvent(new CustomEvent('asset-selection-updated'));
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingSelectionId(null);
    }
  }

  async function clearSelection() {
    setPendingSelectionId('clear');
    try {
      await api('/api/selections/current/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: props.project, confirmWrite: true }),
      });
      await refreshSelection();
      props.onSelectionChanged?.();
      window.dispatchEvent(new CustomEvent('asset-selection-updated'));
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingSelectionId(null);
    }
  }

  async function chooseReviewLabels(labels: string[]) {
    const setId = selection?.active_review_set?.id;
    if (!setId) return;
    setPendingSelectionId(`review:${labels.join(',')}`);
    try {
      await api('/api/selections/review-sets/choose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: props.project, labels, setId, selectedBy: 'human', confirmWrite: true }),
      });
      await refreshSelection();
      props.onSelectionChanged?.();
      window.dispatchEvent(new CustomEvent('asset-selection-updated'));
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingSelectionId(null);
    }
  }

  async function writeReviewSetStatus(setId: string, action: 'activate' | 'archive') {
    setPendingSelectionId(`review-set:${action}:${setId}`);
    try {
      await api(`/api/selections/review-sets/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: props.project, setId, confirmWrite: true }),
      });
      await refreshSelection();
      props.onSelectionChanged?.();
      window.dispatchEvent(new CustomEvent('asset-selection-updated'));
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingSelectionId(null);
    }
  }

  function toggleReviewLabel(label: string) {
    setDraftReviewLabels(current => current.includes(label) ? current.filter(item => item !== label) : [...current, label].sort());
  }

  function toggleSelection(asset: GrowthAsset) {
    const current = selection?.current.items.filter(item => item.selected_at && !item.deselected_at).map(item => item.asset_id) || [];
    const next = selectedAssetIds.has(asset.asset_id) ? current.filter(id => id !== asset.asset_id) : [...current, asset.asset_id];
    void writeSelection(next, asset.asset_id);
  }

  function continueFromNextContext() {
    void props.onCopy?.(lineageCliCommand(cli, `agent "keep working on my selections" --project '${props.project}'`), 'next context command');
  }

  useEffect(() => {
    void refreshSelection();
  }, [props.project]);

  useEffect(() => {
    setDraftReviewLabels(selectedReviewLabels);
  }, [activeReviewSet?.id, selectedReviewLabelsKey]);

  useEffect(() => {
    if (reviewCandidateIds.length === 0) {
      setCandidateAssets([]);
      return;
    }
    void api<AssetLookupSnapshot>('/api/assets/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: props.project, assetIds: reviewCandidateIds }),
    })
      .then(result => {
        setCandidateAssets(result.assets);
        setSelectionError(null);
      })
      .catch(error => { setSelectionError(error instanceof Error ? error.message : String(error)); });
  }, [props.project, reviewCandidateIdsKey]);

  return (
    <section className="asset-board">
      <div className="board-head">
        <div>
          <h2>{boardContext.title}</h2>
          <p>{boardContext.subtitle}</p>
          {boardContext.note && <p className="board-context-note">{boardContext.note}</p>}
        </div>
        <div className="mini-stats">
          <button
            aria-checked={props.liveSync}
            aria-label="Live cloud inventory"
            className={`asset-live-inventory ${props.liveSync ? 'on' : ''}`}
            onClick={() => props.setLiveSync(value => !value)}
            role="switch"
            type="button"
          >
            <span>Live cloud inventory</span>
            <small>Includes a live read from the configured cloud bucket for this project.</small>
          </button>
          <span>{props.liveSync ? `${props.totals.orphan} uncataloged cloud objects` : 'Live cloud inventory off'}</span>
          <span>Page {snapshot?.pagination.page || props.page}/{snapshot?.pagination.totalPages || 1}</span>
          <span>{formatDate(snapshot?.fetchedAt)}</span>
        </div>
      </div>
      <SelectionLedgerPanel
        assets={props.assets}
        candidateAssets={candidateAssets}
        cli={cli}
        inspectedReviewSetId={inspectedReviewSetId}
        error={selectionError}
        loading={selectionLoading}
        onActivateReviewSet={setId => writeReviewSetStatus(setId, 'activate')}
        onArchiveReviewSet={setId => writeReviewSetStatus(setId, 'archive')}
        onClear={() => void clearSelection()}
        onChooseReviewLabels={labels => chooseReviewLabels(labels)}
        onContinueFromNextContext={props.onCopy ? continueFromNextContext : undefined}
        onInspectReviewSet={setInspectedReviewSetId}
        onRefresh={() => void refreshSelection()}
        onToggleReviewLabel={toggleReviewLabel}
        pending={pendingSelectionId === 'clear'}
        project={props.project}
        reviewDraftLabels={draftReviewLabels}
        reviewActionPending={pendingSelectionId}
        reviewPending={Boolean(pendingSelectionId?.startsWith('review:'))}
        selection={selection}
      />
      <div className="asset-list">
        {props.assets.map(asset => (
          <AssetRow
            asset={asset}
            key={asset.asset_id}
            ledgerSelected={selectedAssetIds.has(asset.asset_id)}
            onSelect={() => props.setSelectedId(asset.asset_id)}
            onToggleLedgerSelected={() => toggleSelection(asset)}
            previewUrl={props.previewUrls[asset.asset_id] || null}
            selected={asset.asset_id === props.selected?.asset_id}
            selectionPending={pendingSelectionId === asset.asset_id}
          />
        ))}
      </div>
      <footer className="pagination-bar">
        <button disabled={!snapshot || snapshot.pagination.page <= 1} onClick={() => props.setPage(value => Math.max(value - 1, 1))}>
          Previous
        </button>
        <span>{snapshot?.pagination.page || 1} of {snapshot?.pagination.totalPages || 1}</span>
        <button disabled={!snapshot || snapshot.pagination.page >= snapshot.pagination.totalPages} onClick={() => props.setPage(value => value + 1)}>
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
