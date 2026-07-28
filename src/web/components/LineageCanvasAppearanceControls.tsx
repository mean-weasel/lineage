import type { LineageEdgeWeight } from '../lineagePreferences';
import type { LineageCanvasPresentation } from './LineageAssetNode';
import type { LineageGraphDirection } from './lineageGraph';

export function LineageCanvasAppearanceControls({
  canvasPresentation,
  edgeSummariesVisible,
  edgeWeight,
  graphDirection,
  hoverPreviewsEnabled,
  loading,
  onCanvasPresentation,
  onEdgeSummariesVisible,
  onEdgeWeight,
  onGraphDirection,
  onHoverPreviewsEnabled,
  snapshotAvailable,
}: {
  canvasPresentation: LineageCanvasPresentation;
  edgeSummariesVisible: boolean;
  edgeWeight: LineageEdgeWeight;
  graphDirection: LineageGraphDirection;
  hoverPreviewsEnabled: boolean;
  loading: boolean;
  onCanvasPresentation: (presentation: LineageCanvasPresentation) => void;
  onEdgeSummariesVisible: (visible: boolean) => void;
  onEdgeWeight: (weight: LineageEdgeWeight) => void;
  onGraphDirection: (direction: LineageGraphDirection) => void;
  onHoverPreviewsEnabled: (enabled: boolean) => void;
  snapshotAvailable: boolean;
}) {
  const disabled = !snapshotAvailable || loading;

  return (
    <section aria-label="Canvas appearance" className="lineage-canvas-appearance-controls">
      <strong>Canvas appearance</strong>
      <label className="lineage-action-select">
        <span>Cards</span>
        <select
          aria-label="Canvas card style"
          disabled={disabled}
          onChange={event => onCanvasPresentation(event.target.value as LineageCanvasPresentation)}
          value={canvasPresentation}
        >
          <option value="compact">Compact nodes</option>
          <option value="portrait">Portrait cards</option>
        </select>
      </label>
      <label className="lineage-action-select">
        <span>Direction</span>
        <select
          aria-label="Lineage graph direction"
          disabled={disabled}
          onChange={event => onGraphDirection(event.target.value as LineageGraphDirection)}
          value={graphDirection}
        >
          <option value="LR">Left to right</option>
          <option value="TB">Top to bottom</option>
          <option value="RL">Right to left</option>
          <option value="BT">Bottom to top</option>
        </select>
      </label>
      <label className="lineage-action-select">
        <span>Edges</span>
        <select
          aria-label="Canvas edge weight"
          disabled={disabled}
          onChange={event => onEdgeWeight(event.target.value as LineageEdgeWeight)}
          value={edgeWeight}
        >
          <option value="fine">Fine</option>
          <option value="standard">Standard</option>
          <option value="bold">Bold</option>
        </select>
      </label>
      <label className="lineage-action-select">
        <span>Edge labels</span>
        <select
          aria-label="Canvas edge labels"
          disabled={!snapshotAvailable}
          onChange={event => onEdgeSummariesVisible(event.target.value === 'show')}
          value={edgeSummariesVisible ? 'show' : 'hide'}
        >
          <option value="show">Show labels</option>
          <option value="hide">Hide labels</option>
        </select>
      </label>
      <label className="lineage-action-select">
        <span>Hover previews</span>
        <select
          aria-label="Canvas hover previews"
          disabled={!snapshotAvailable}
          onChange={event => onHoverPreviewsEnabled(event.target.value === 'enabled')}
          value={hoverPreviewsEnabled ? 'enabled' : 'disabled'}
        >
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
        </select>
      </label>
    </section>
  );
}
