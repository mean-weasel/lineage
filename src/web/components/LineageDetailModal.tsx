import { useEffect, useState } from 'react';
import type { AssetReviewState, LineageNode, LineageSnapshot } from '../../shared/types';
import type { GenerationJobListResponse } from '../../shared/generationTypes';
import { storageStateFor } from '../assetUi';
import { api } from '../api';
import { LineageNodeActionFooter } from './LineageNodeActionFooter';
import './LineageDetailModal.css';

const receiptOrder = { plan: 0, import: 1, error: 2 };

export function LineageDetailModal({
  node,
  canRemoveFromLineage,
  onClearAllNext,
  onClearNext,
  onClose,
  onOpenNode,
  onRemoveFromLineage,
  onReplaceNext,
  onReview,
  onSelectNext,
  onToast,
  selectedCount,
  selectionFull,
  snapshot,
}: {
  node: LineageNode;
  canRemoveFromLineage: boolean;
  onClearAllNext: () => void;
  onClearNext: () => void;
  onClose: () => void;
  onOpenNode: (assetId: string) => void;
  onRemoveFromLineage: (node: LineageNode) => void;
  onReplaceNext: (node: LineageNode) => void;
  onReview: (reviewState: AssetReviewState, assetId: string) => void;
  onSelectNext: (node: LineageNode) => void;
  onToast: (type: 'ok' | 'error', message: string) => void;
  selectedCount: number;
  selectionFull: boolean;
  snapshot: LineageSnapshot;
}) {
  const parents = snapshot.edges.filter(edge => edge.child_asset_id === node.asset_id)
    .map(edge => snapshot.nodes.find(item => item.asset_id === edge.parent_asset_id)).filter((item): item is LineageNode => Boolean(item));
  const children = snapshot.edges.filter(edge => edge.parent_asset_id === node.asset_id)
    .map(edge => snapshot.nodes.find(item => item.asset_id === edge.child_asset_id)).filter((item): item is LineageNode => Boolean(item));
  const storage = storageStateFor({ hasLocal: Boolean(node.local_path), hasS3: Boolean(node.s3_key) });
  const [proof, setProof] = useState<GenerationJobListResponse | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [proofLoading, setProofLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      assetId: node.asset_id,
      limit: '6',
      project: snapshot.project,
      rootAssetId: snapshot.root_asset_id,
    });
    setProof(null);
    setProofError(null);
    setProofLoading(true);
    api<GenerationJobListResponse>(`/api/generation/jobs?${params.toString()}`)
      .then(result => {
        if (!cancelled) setProof(result);
      })
      .catch(error => {
        if (!cancelled) setProofError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setProofLoading(false);
      });
    return () => { cancelled = true; };
  }, [node.asset_id, snapshot.project, snapshot.root_asset_id]);

  function openNode(assetId: string) {
    onOpenNode(assetId);
  }

  return (
    <div className="lineage-detail-backdrop" onClick={onClose}>
      <section aria-labelledby="lineage-detail-title" aria-modal="true" className="lineage-detail-modal" onClick={event => event.stopPropagation()} role="dialog">
        <header>
          <div>
            <h3 id="lineage-detail-title">{node.title}</h3>
            <code>{node.asset_id}</code>
          </div>
          <button onClick={onClose} title="Close detail">Close</button>
        </header>
        <div className="lineage-detail-body">
          <div className="lineage-detail-preview">
            {node.preview_url && (node.media_type === 'image' || node.media_type === 'gif') ? (
              <img src={node.preview_url} alt={node.title} />
            ) : node.preview_url && node.media_type === 'video' ? (
              <video src={node.preview_url} controls />
            ) : (
              <div className="lineage-preview-empty">
                <strong>{node.media_type}</strong>
                <span>{node.s3_key ? 'Preview available from Assets when signed.' : storage.description}</span>
              </div>
            )}
          </div>
          <dl>
            <div><dt>Storage</dt><dd><span className={`storage-chip ${storage.kind}`}>{storage.label}</span></dd></div>
            <div><dt>Source</dt><dd>{node.source}</dd></div>
            <div><dt>Channel</dt><dd>{node.channel || 'none'}</dd></div>
            <div><dt>Campaign</dt><dd>{node.campaign || 'none'}</dd></div>
            <div><dt>Status</dt><dd>{node.status}</dd></div>
            <div><dt>Review</dt><dd>{node.review_state}</dd></div>
            <div><dt>Latest</dt><dd>{node.is_latest ? 'yes' : 'no'}</dd></div>
            <div><dt>Next variation</dt><dd>{node.user_selected ? 'yes' : 'no'}</dd></div>
            {node.local_path && <div><dt>Local path</dt><dd>{node.local_path}</dd></div>}
            {node.s3_key && <div><dt>S3 key</dt><dd>{node.s3_key}</dd></div>}
            {node.selection_note && <div><dt>Rationale</dt><dd>{node.selection_note}</dd></div>}
            {node.review_notes && <div><dt>Notes</dt><dd>{node.review_notes}</dd></div>}
          </dl>
          <section className="lineage-detail-context">
            <h4>Lineage context</h4>
            <p>{parents.length || 'No'} parent · {children.length || 'No'} children · {node.is_latest ? 'latest leaf' : 'branch point'}</p>
            {node.user_selected && !node.is_latest && (
              <div className="lineage-detail-warning" role="status">
                This asset is selected for next variation but is not a latest leaf. Keep it for an intentional branch, or replace it with a newer leaf before continuing.
              </div>
            )}
            <div className="lineage-relation-list">
              {parents.map(parent => (
                <button aria-label={`Open parent ${parent.title}`} className="lineage-relation-button" key={parent.asset_id} onClick={() => openNode(parent.asset_id)}>
                  <span>View parent</span>
                  <strong>{parent.title}</strong>
                </button>
              ))}
              {children.map(child => (
                <button aria-label={`Open child ${child.title}`} className="lineage-relation-button" key={child.asset_id} onClick={() => openNode(child.asset_id)}>
                  <span>View child</span>
                  <strong>{child.title}</strong>
                </button>
              ))}
            </div>
          </section>
          <section className="lineage-detail-proof" data-testid="lineage-generation-proof">
            <h4>Generation proof</h4>
            {proofLoading && <p>Loading receipt proof...</p>}
            {proofError && <p className="lineage-proof-error">{proofError}</p>}
            {!proofLoading && !proofError && proof && proof.jobs.length === 0 && <p>No generation receipts for this node yet.</p>}
            {!proofLoading && !proofError && proof?.jobs.map(job => (
              <article className="lineage-proof-job" key={job.id}>
                <div className="lineage-proof-job-head">
                  <strong>{job.id}</strong>
                  <span>{job.status}</span>
                </div>
                <p>{job.prompt}</p>
                <dl>
                  <div><dt>Receipts</dt><dd>{[...job.receipts].sort((a, b) => receiptOrder[a.receipt_type] - receiptOrder[b.receipt_type]).map(receipt => `${receipt.receipt_type}: ${receipt.status}`).join(' · ') || 'none'}</dd></div>
                  <div><dt>Parents</dt><dd>{job.inputs.map(input => input.asset_id).join(', ')}</dd></div>
                  <div><dt>Outputs</dt><dd>{job.outputs.length || 'none yet'}</dd></div>
                </dl>
                {job.outputs.length > 0 && (
                  <div className="lineage-proof-output-list">
                    {job.outputs.map(output => (
                      <div className="lineage-proof-output" key={output.id}>
                        <span>Output {output.output_index}</span>
                        <strong>{output.imported_asset_id}</strong>
                        <code>{output.file_path}</code>
                        <small>parent {output.parent_asset_id}</small>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </section>
        </div>
        <LineageNodeActionFooter
          canRemoveFromLineage={canRemoveFromLineage}
          node={node}
          onClearAllNext={onClearAllNext}
          onClearNext={onClearNext}
          onOpenNode={openNode}
          onRemoveFromLineage={onRemoveFromLineage}
          onReplaceNext={onReplaceNext}
          onReview={onReview}
          onSelectNext={onSelectNext}
          onToast={onToast}
          selectedCount={selectedCount}
          selectionFull={selectionFull}
          snapshot={snapshot}
        />
      </section>
    </div>
  );
}
