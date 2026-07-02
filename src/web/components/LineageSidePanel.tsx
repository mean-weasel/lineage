import type { Dispatch, FormEvent, SetStateAction } from 'react';
import type { AssetReviewState, LineageBriefResponse, LineageNode, LineageSnapshot } from '../../shared/types';
import { storageStateFor } from '../assetUi';
import { CandidateMeta } from './LineageCandidateMeta';
import { LineageHandoffPanel } from './LineageHandoffPanel';

interface LineageSidePanelProps {
  activeNode?: LineageNode;
  brief: LineageBriefResponse | null;
  childAssetId: string;
  clearNextVariation: (assetId?: string) => Promise<void>;
  closePanel: () => void;
  latestNodes: LineageNode[];
  linkChild: () => Promise<void>;
  noteDirty: boolean;
  nextVariationLimit: number;
  onSelectedAsset: (assetId: string) => void;
  onToast: (type: 'ok' | 'error', message: string) => void;
  project: string;
  refreshBrief: () => Promise<void>;
  replaceNextVariation: (node: LineageNode, notes?: string) => void;
  saveRationale: () => void;
  selectNextBase: (node: LineageNode, notes?: string) => void;
  selectedNode?: LineageNode;
  selectedNodes: LineageNode[];
  selectionFull: boolean;
  selectionNote: string;
  setActiveNodeId: Dispatch<SetStateAction<string | null>>;
  setChildAssetId: Dispatch<SetStateAction<string>>;
  setDetailNodeId: Dispatch<SetStateAction<string | null>>;
  setSelected: () => void;
  setSelectionNote: Dispatch<SetStateAction<string>>;
  sideOpen: boolean;
  snapshot: LineageSnapshot;
  markReview: (reviewState: AssetReviewState, assetId?: string) => Promise<void>;
}

export function LineageSidePanel(props: LineageSidePanelProps) {
  const {
    activeNode, brief, childAssetId, clearNextVariation, closePanel, latestNodes, linkChild, markReview, noteDirty, onSelectedAsset,
    nextVariationLimit, onToast, project, refreshBrief, saveRationale, selectNextBase, selectedNode, selectedNodes, selectionFull,
    replaceNextVariation, selectionNote, setActiveNodeId, setChildAssetId, setDetailNodeId, setSelected, setSelectionNote, sideOpen, snapshot,
  } = props;
  const activeStorage = activeNode ? storageStateFor({ hasLocal: Boolean(activeNode.local_path), hasS3: Boolean(activeNode.s3_key) }) : null;
  const staleSelectedNodes = selectedNodes.filter(node => !node.is_latest);
  const submitChild = (event: FormEvent) => {
    event.preventDefault();
    void linkChild();
  };

  return (
    <aside aria-hidden={!sideOpen} className={`lineage-side ${sideOpen ? '' : 'collapsed'}`} id="lineage-selection-panel">
      <div className="lineage-side-head">
        <div>
          <h3>Next variation</h3>
          <p className="muted-copy">Choose what the agent will evolve next; double-click nodes for full details.</p>
        </div>
        <button aria-label="Close lineage selection panel" className="icon-button" onClick={closePanel} type="button">×</button>
      </div>
      <section className="lineage-next-panel">
        <div className="lineage-panel-title-row">
          <h3>Using for next variation</h3>
          <span className={`lineage-count-pill ${selectionFull ? 'full' : ''}`}>{selectedNodes.length}/{nextVariationLimit}</span>
        </div>
        {selectedNodes.length > 0 && (
          <div className="lineage-panel-action-row">
            <button onClick={() => void clearNextVariation()} type="button">Clear all</button>
          </div>
        )}
        {staleSelectedNodes.length > 0 && (
          <div className="lineage-selection-warning" role="status">
            {staleSelectedNodes.length} selected asset{staleSelectedNodes.length === 1 ? ' is' : 's are'} not latest. This is valid for branching, but clear or replace it if you meant to continue from the newest leaves.
          </div>
        )}
        {selectedNodes.length > 0 ? (
          selectedNodes.map(node => (
            <div className="lineage-candidate selected" key={node.asset_id}>
              <button aria-label={`Inspect asset used for next variation ${node.title}`} className="lineage-candidate-main" onClick={() => { setActiveNodeId(node.asset_id); onSelectedAsset(node.asset_id); }}>
                <span>{node.title}</span>
                <code>{node.asset_id}</code>
                <CandidateMeta node={node} />
              </button>
              {!node.is_latest && <span className="lineage-candidate-warning">Not latest</span>}
              <div className="lineage-candidate-actions">
                {selectedNodes.length > 1 && <button className="lineage-candidate-action secondary" onClick={() => replaceNextVariation(node)}>Use only this</button>}
                <button className="lineage-candidate-action remove" onClick={() => void clearNextVariation(node.asset_id)}>Remove</button>
              </div>
            </div>
          ))
        ) : (
          <p className="muted-copy">Choose up to {nextVariationLimit} assets to guide the next generation.</p>
        )}
        {selectedNodes.length > 1 && <p className="muted-copy">The agent will use these as separate next-variation bases; imported outputs should link back to the matching selected parent.</p>}
      </section>
      <section className="lineage-next-panel">
        <h3>Latest candidates</h3>
        {latestNodes.length > 0 ? latestNodes.map(node => {
          const cannotAdd = !node.user_selected && selectionFull;
          return (
            <div className={`lineage-candidate ${node.asset_id === activeNode?.asset_id ? 'active' : ''} ${node.user_selected ? 'selected' : ''}`} key={node.asset_id}>
              <button aria-label={`Inspect ${node.title}`} className="lineage-candidate-main" onClick={() => { setActiveNodeId(node.asset_id); onSelectedAsset(node.asset_id); }}>
                <span>{node.title}</span>
                <code>{node.asset_id}</code>
                <CandidateMeta node={node} />
              </button>
              <div className="lineage-candidate-actions">
                <button aria-label={node.user_selected ? `Remove ${node.title} from next variation` : `Use ${node.title} for next variation`} className={`lineage-candidate-action ${node.user_selected ? 'remove' : ''}`} disabled={cannotAdd} onClick={() => node.user_selected ? void clearNextVariation(node.asset_id) : selectNextBase(node)}>
                  {node.user_selected ? 'Remove' : cannotAdd ? 'Selection full' : 'Use for next variation'}
                </button>
                {!node.user_selected && selectedNodes.length > 0 && <button className="lineage-candidate-action secondary" onClick={() => replaceNextVariation(node)}>Replace selection</button>}
              </div>
            </div>
          );
        }) : <p className="muted-copy">No latest leaves yet.</p>}
      </section>
      <LineageHandoffPanel brief={brief} nextBase={selectedNode} onRefreshBrief={() => void refreshBrief()} onToast={onToast} project={project} rootAssetId={snapshot.root_asset_id} />
      <h3>Inspecting</h3>
      {activeNode ? (
        <>
          <strong>{activeNode.title}</strong>
          <code>{activeNode.asset_id}</code>
          <dl>
            <div><dt>Storage</dt><dd>{activeStorage && <span className={`storage-chip ${activeStorage.kind}`}>{activeStorage.label}</span>}</dd></div>
            <div><dt>Source</dt><dd>{activeNode.source}</dd></div>
            <div><dt>Review</dt><dd>{activeNode.review_state}</dd></div>
            <div><dt>Latest</dt><dd>{activeNode.is_latest ? 'yes' : 'no'}</dd></div>
            <div><dt>Next variation</dt><dd>{activeNode.user_selected ? 'yes' : 'no'}</dd></div>
          </dl>
          {activeNode.user_selected && !activeNode.is_latest && (
            <div className="lineage-selection-warning" role="status">
              This selected asset is not a latest leaf. Keep it selected to branch from an earlier idea, or replace it with the current inspected asset.
            </div>
          )}
          <label className="lineage-note-field">
            Variation rationale
            <textarea value={selectionNote} onChange={event => setSelectionNote(event.target.value)} placeholder="Why should the next generation branch from this asset?" />
            <span className={`lineage-note-status ${noteDirty ? 'dirty' : ''}`}>{activeNode.user_selected ? (noteDirty ? 'Unsaved rationale' : 'Rationale saved for next variation') : 'Rationale saves when this is used for next variation'}</span>
          </label>
          <div className="lineage-side-actions">
            <button aria-label={activeNode.user_selected ? `Remove ${activeNode.title} from next variation` : `Use ${activeNode.title} for next variation`} className="primary-lite" disabled={!activeNode.user_selected && selectionFull} onClick={() => activeNode.user_selected ? void clearNextVariation(activeNode.asset_id) : setSelected()}>{activeNode.user_selected ? 'Remove from next variation' : selectionFull ? 'Selection full' : 'Use for next variation'}</button>
            {activeNode.user_selected && selectedNodes.length > 1 && <button onClick={() => replaceNextVariation(activeNode, selectionNote)}>Use only this</button>}
            {!activeNode.user_selected && selectedNodes.length > 0 && <button onClick={() => replaceNextVariation(activeNode, selectionNote)}>Replace selection</button>}
            <button disabled={!activeNode.user_selected || !noteDirty} onClick={saveRationale}>Save rationale</button>
            <button aria-label={`Open detail for ${activeNode.title}`} onClick={() => setDetailNodeId(activeNode.asset_id)}>Open detail</button>
            <button aria-label={`Approve ${activeNode.title}`} onClick={() => void markReview('approved')}>Approve</button>
            <button aria-label={`Reject ${activeNode.title}`} onClick={() => void markReview('rejected')}>Reject</button>
            <button aria-label={`Ignore ${activeNode.title}`} onClick={() => void markReview('ignored')}>Ignore</button>
          </div>
          <form className="lineage-link-form" onSubmit={submitChild}>
            <label>
              Child asset ID
              <input value={childAssetId} onChange={event => setChildAssetId(event.target.value)} placeholder="local-... or catalog id" />
            </label>
            <button disabled={!childAssetId.trim()} type="submit">Link child</button>
          </form>
        </>
      ) : (
        <p className="muted-copy">No lineage node selected.</p>
      )}
    </aside>
  );
}
