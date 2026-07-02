import './LineageSelectionStrip.css';

export function LineageSelectionStrip({
  clearSelection,
  limit,
  openManager,
  selectedCount,
  staleCount,
}: {
  clearSelection: () => void;
  limit: number;
  openManager: () => void;
  selectedCount: number;
  staleCount: number;
}) {
  return (
    <div className={`lineage-selection-strip ${staleCount > 0 ? 'has-warning' : ''}`} data-testid="lineage-selection-strip">
      <div>
        <strong>Use for next variation</strong>
        <span>{selectedCount}/{limit} selected{staleCount > 0 ? ` · ${staleCount} not latest` : ''}</span>
      </div>
      {selectedCount > 0 ? (
        <div className="lineage-selection-strip-actions">
          <button onClick={openManager} type="button">Manage</button>
          <button onClick={clearSelection} type="button">Clear all</button>
        </div>
      ) : (
        <button onClick={openManager} type="button">Choose assets</button>
      )}
    </div>
  );
}
