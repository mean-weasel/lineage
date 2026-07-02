import { CheckSquare, RefreshCcw, Trash2 } from 'lucide-react';
import type { AssetSelectionItem, AssetSelectionSnapshot, GrowthAsset } from '../../shared/types';
import { formatDate } from '../../shared/format';
import { assetStorageState } from '../assetUi';
import './SelectionLedgerPanel.css';

export function SelectionLedgerPanel({
  assets,
  candidateAssets = [],
  inspectedReviewSetId,
  error,
  loading,
  onActivateReviewSet,
  onArchiveReviewSet,
  onClear,
  onChooseReviewLabels,
  onContinueFromNextContext,
  onInspectReviewSet,
  onRefresh,
  onToggleReviewLabel,
  pending,
  project,
  reviewDraftLabels,
  reviewActionPending,
  reviewPending,
  selection,
}: {
  assets: GrowthAsset[];
  candidateAssets?: GrowthAsset[];
  inspectedReviewSetId?: string | null;
  error: string | null;
  loading: boolean;
  onActivateReviewSet?: (setId: string) => Promise<void>;
  onArchiveReviewSet?: (setId: string) => Promise<void>;
  onClear: () => void;
  onChooseReviewLabels?: (labels: string[]) => Promise<void>;
  onContinueFromNextContext?: () => void;
  onInspectReviewSet?: (setId: string) => void;
  onRefresh: () => void;
  onToggleReviewLabel?: (label: string) => void;
  pending: boolean;
  project: string;
  reviewActionPending?: string | null;
  reviewDraftLabels?: string[];
  reviewPending?: boolean;
  selection: AssetSelectionSnapshot | null;
}) {
  const selectedItems = selection?.current.items.filter(item => item.selected_at && !item.deselected_at) || [];
  const activeReviewSet = selection?.active_review_set || null;
  const reviewSets = selection?.review_sets || [];
  const assetById = new Map([...candidateAssets, ...assets].map(asset => [asset.asset_id, asset]));
  const draftLabels = reviewDraftLabels || [];
  const inspectedSet = reviewSets.find(set => set.id === inspectedReviewSetId) || activeReviewSet || reviewSets[0] || null;
  const activeReviewSelectedCount = activeReviewSet?.items.filter(isSelected).length || 0;

  function chooseDraftLabels() {
    if (!onChooseReviewLabels || draftLabels.length === 0) return;
    void onChooseReviewLabels(draftLabels);
  }

  return (
    <section className="selection-ledger-panel" aria-label="Current asset selections">
      <div className="selection-ledger-title">
        <CheckSquare size={16} />
        <div>
          <h3>Current asset selections</h3>
          <p>{project} · SQLite selection set</p>
        </div>
      </div>
      <div className="selection-ledger-actions">
        <span>{selectedItems.length} selected</span>
        <button disabled={loading} onClick={onRefresh} type="button"><RefreshCcw className={loading ? 'spin' : ''} size={14} />Refresh</button>
        <button disabled={pending || selectedItems.length === 0} onClick={onClear} type="button"><Trash2 size={14} />Clear</button>
      </div>
      {error && <p className="selection-ledger-error">{error}</p>}
      {selectedItems.length > 0 && (
        <div className="selection-ledger-items">
          {selectedItems.map(item => (
            <span key={item.id} title={item.asset_id}>
              {item.variation_label ? `${item.variation_label}: ` : ''}{assetById.get(item.asset_id)?.title || item.asset_id}
            </span>
          ))}
        </div>
      )}
      {!activeReviewSet && reviewSets.length > 0 && <p className="review-set-empty">No active review set. Activate a recent set to choose labels from it.</p>}
      {activeReviewSet && (
        <details className="review-set-panel" aria-label="Active review set">
          <summary className="review-set-header">
            <div>
              <h4>Active review set</h4>
              <p>{activeReviewSet.label} · {activeReviewSet.key}</p>
            </div>
            <div className="review-set-header-badges">
              <span className="review-set-next-context">next work context</span>
              <span>{activeReviewSet.items.length} candidates</span>
            </div>
          </summary>
          <div className="review-set-candidates">
            {activeReviewSet.items.map(item => {
              const label = item.variation_label || String(item.position + 1);
              const asset = assetById.get(item.asset_id);
              const storage = asset ? assetStorageState(asset) : null;
              const selected = isSelected(item);
              const drafted = draftLabels.includes(label);
              return (
                <button
                  aria-pressed={drafted}
                  className={`review-set-candidate${selected ? ' selected' : ''}${drafted ? ' drafted' : ''}`}
                  disabled={reviewPending || !onToggleReviewLabel}
                  key={item.id}
                  onClick={() => onToggleReviewLabel?.(label)}
                  title={item.asset_id}
                  type="button"
                >
                  <span className="review-set-label">{label}</span>
                  <span className="review-set-copy">
                    <strong>{asset?.title || item.asset_id}</strong>
                    <small>{asset ? asset.asset_id : 'not on this page'} · {storage?.label || 'storage unknown'}</small>
                  </span>
                  {selected && <span className="review-set-selected">selected</span>}
                </button>
              );
            })}
          </div>
          <div className="review-set-actions">
            <span>{draftLabels.length} label{draftLabels.length === 1 ? '' : 's'} chosen</span>
            <button disabled={!onChooseReviewLabels || reviewPending || draftLabels.length === 0} onClick={chooseDraftLabels} type="button">
              <CheckSquare size={14} />Select labels
            </button>
          </div>
          <details className="review-set-work-packet" aria-label="Agent work packet">
            <summary className="review-set-work-packet-title">
              <h4>Agent work packet</h4>
              <span>{activeReviewSet.items.length} candidates · {activeReviewSelectedCount} selected · SQLite-backed</span>
            </summary>
            <div className="review-set-work-packet-body">
              <code>npm run studio:cli -- selections review-set packet --project {project} --json</code>
              <code>npm run studio:cli -- agent "keep working on my selections" --project {project} --json</code>
              <button
                disabled={activeReviewSet.items.length === 0 || !onContinueFromNextContext}
                onClick={onContinueFromNextContext}
                type="button"
              >
                Continue from next context
              </button>
            </div>
          </details>
        </details>
      )}
      {reviewSets.length > 0 && (
        <details className="review-set-history" aria-label="Recent review sets">
          <summary className="review-set-history-title">
            <h4>Recent review sets</h4>
            <span>{reviewSets.length} total</span>
          </summary>
          {reviewSets.slice(0, 5).map(set => {
            const selectedLabels = set.items.filter(isSelected).map(item => item.variation_label).filter(Boolean).join(', ');
            const pendingSet = reviewActionPending?.endsWith(`:${set.id}`);
            return (
              <div className={`review-set-history-row ${set.status}`} key={set.id}>
                <span className={`review-set-status ${set.status}`}>{set.status}</span>
                <strong>{set.label}</strong>
                <small>{set.key} · {formatDate(set.updated_at)} · {set.items.length} candidates{selectedLabels ? ` · selected ${selectedLabels}` : ''}</small>
                <div className="review-set-history-actions">
                  <button aria-pressed={inspectedSet?.id === set.id} onClick={() => { onInspectReviewSet?.(set.id); }} type="button">Inspect</button>
                  <button disabled={set.status === 'active' || pendingSet || !onActivateReviewSet} onClick={() => { void onActivateReviewSet?.(set.id); }} type="button">Set next</button>
                  <button disabled={set.status === 'archived' || pendingSet || !onArchiveReviewSet} onClick={() => { void onArchiveReviewSet?.(set.id); }} type="button">Archive</button>
                </div>
              </div>
            );
          })}
        </details>
      )}
      {inspectedSet && (
        <details className="review-set-detail" aria-label="Review set detail">
          <summary>
            <h4>Review set handoff</h4>
            <p>{inspectedSet.label} · {inspectedSet.status === 'active' ? 'next work context' : inspectedSet.status} · {inspectedSet.items.filter(isSelected).length} selected</p>
          </summary>
          <div className="review-set-detail-assets">
            {inspectedSet.items.map(item => {
              const label = item.variation_label || String(item.position + 1);
              const asset = assetById.get(item.asset_id);
              return <span className={isSelected(item) ? 'selected' : ''} key={item.id}>{label}: {asset?.title || item.asset_id}</span>;
            })}
          </div>
          <code>npm run studio:cli -- selections review-set inspect --project {project} --set-id {inspectedSet.id} --json</code>
          <code>npm run studio:cli -- selections review-set set-next --project {project} --set-id {inspectedSet.id} --json</code>
          <code>After choosing labels: npm run studio:cli -- agent "keep working on my selections" --project {project} --json</code>
        </details>
      )}
    </section>
  );
}

function isSelected(item: AssetSelectionItem): boolean {
  return Boolean(item.selected_at && !item.deselected_at);
}
