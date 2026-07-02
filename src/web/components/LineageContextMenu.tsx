import type { AssetReviewState, LineageNode } from '../../shared/types';
import './LineageContextMenu.css';

export function LineageContextMenu({
  node,
  onClearAllNext,
  canRemoveFromLineage,
  onClearNext,
  onClose,
  onOpenDetail,
  onRemoveFromLineage,
  onReplaceNext,
  onReview,
  onSelectNext,
  position,
  selectedCount,
  selectionFull,
}: {
  node: LineageNode;
  canRemoveFromLineage: boolean;
  onClearAllNext: () => void;
  onClearNext: () => void;
  onClose: () => void;
  onOpenDetail: () => void;
  onRemoveFromLineage: () => void;
  onReplaceNext: () => void;
  onReview: (reviewState: AssetReviewState) => void;
  onSelectNext: () => void;
  position: { x: number; y: number };
  selectedCount: number;
  selectionFull: boolean;
}) {
  function run(action: () => void) {
    action();
    onClose();
  }

  return (
    <div className="lineage-context-menu" role="menu" style={{ left: position.x, top: position.y }}>
      <strong>{node.title}</strong>
      <button disabled={!node.user_selected && selectionFull} onClick={() => run(node.user_selected ? onClearNext : onSelectNext)} role="menuitem">
        {node.user_selected ? 'Remove from next variation' : selectionFull ? 'Selection full' : 'Use for next variation'}
      </button>
      {!node.user_selected && selectedCount > 0 && <button className="selection-replace" onClick={() => run(onReplaceNext)} role="menuitem">Replace selection</button>}
      {node.user_selected && selectedCount > 1 && <button className="selection-replace" onClick={() => run(onReplaceNext)} role="menuitem">Use only this for next variation</button>}
      {selectedCount > 0 && <button onClick={() => run(onClearAllNext)} role="menuitem">Clear all next variation</button>}
      {node.user_selected && !node.is_latest && <p role="status">Selected but not latest. Good for branching from an earlier idea.</p>}
      <button onClick={() => run(onOpenDetail)} role="menuitem">Open detail</button>
      <button className="danger" disabled={!canRemoveFromLineage} onClick={() => run(onRemoveFromLineage)} role="menuitem">
        {canRemoveFromLineage ? 'Remove from lineage' : 'Root cannot be removed'}
      </button>
      <button onClick={() => run(() => onReview('approved'))} role="menuitem">Approve</button>
      <button onClick={() => run(() => onReview('needs_revision'))} role="menuitem">Needs revision</button>
      <button onClick={() => run(() => onReview('rejected'))} role="menuitem">Reject</button>
      <button onClick={() => run(() => onReview('ignored'))} role="menuitem">Ignore</button>
    </div>
  );
}
