import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useState } from 'react';
import type { LineageSnapshot, LineageWorkspace } from '../../shared/types';
import type { DemoSeedMediaStatus } from './useLineageWorkspaces';
import type { LineageGraphDirection } from './lineageGraph';
import { LineageWorkspacePicker } from './LineageWorkspacePicker';
import './LineageToolbar.css';

export function LineageToolbar({
  activeWorkspace,
  closeSignal,
  demoSeedStatus,
  graphDirection,
  latestCount,
  loading,
  nextVariationId,
  onArchiveWorkspace,
  onDownloadSwissifierMedia,
  onFitGraph,
  onGraphDirection,
  onIndexLocal,
  onNewLineage,
  onRefreshLineage,
  onRefreshWorkspaces,
  onRestoreDemoMedia,
  onRestoreSwissifierMedia,
  onSeedDemo,
  onSeedSwissifierDemo,
  onSelectWorkspace,
  onTidyGraph,
  onToggleNextPanel,
  sideOpen,
  snapshot,
  swissifierDemoStatus,
  workspaceLoading,
  workspaceRootAssetId,
  workspaces,
}: {
  activeWorkspace: LineageWorkspace | null;
  closeSignal: number;
  demoSeedStatus: DemoSeedMediaStatus | null;
  graphDirection: LineageGraphDirection;
  latestCount: number;
  loading: boolean;
  nextVariationId: string;
  onArchiveWorkspace: () => void;
  onDownloadSwissifierMedia: () => void;
  onFitGraph: () => void;
  onGraphDirection: (direction: LineageGraphDirection) => void;
  onIndexLocal: () => void;
  onNewLineage: () => void;
  onRefreshLineage: () => void;
  onRefreshWorkspaces: () => void;
  onRestoreDemoMedia: () => void;
  onRestoreSwissifierMedia: () => void;
  onSeedDemo: () => void;
  onSeedSwissifierDemo: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onTidyGraph: () => void;
  onToggleNextPanel: () => void;
  sideOpen: boolean;
  snapshot: LineageSnapshot | null;
  swissifierDemoStatus: DemoSeedMediaStatus | null;
  workspaceLoading: boolean;
  workspaceRootAssetId: string;
  workspaces: LineageWorkspace[];
}) {
  const mediaLabel = demoSeedStatus ? `${demoSeedStatus.present}/${demoSeedStatus.total} SVG placeholders` : 'Checking media';
  const swissifierMediaLabel = swissifierDemoStatus ? `${swissifierDemoStatus.present}/${swissifierDemoStatus.total} PNG images` : 'Checking media';
  const swissifierReady = Boolean(swissifierDemoStatus && swissifierDemoStatus.present === swissifierDemoStatus.total);
  const swissifierCanDownload = Boolean(swissifierDemoStatus?.download_available && !swissifierReady);
  const activeSeedLabel = activeWorkspace?.title === 'Swissifier rich demo'
    ? 'Rich PNG seed active'
    : activeWorkspace?.title === 'Demo: Content iteration tree'
      ? 'Basic SVG placeholders active'
      : null;
  const [demoOpen, setDemoOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);

  useEffect(() => {
    setDemoOpen(false);
    setActionsOpen(false);
  }, [closeSignal]);

  useEffect(() => {
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setDemoOpen(false);
      setActionsOpen(false);
    }
    document.addEventListener('keydown', closeOnEscape, true);
    return () => document.removeEventListener('keydown', closeOnEscape, true);
  }, []);

  function runAndClose(action: () => void) {
    setDemoOpen(false);
    setActionsOpen(false);
    action();
  }

  function closeMenusOnEscape(event: ReactKeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    setDemoOpen(false);
    setActionsOpen(false);
  }

  return (
    <header className="lineage-header">
      <div className="lineage-title">
        <h2>Lineage</h2>
        <p>
          <span>{snapshot ? `${snapshot.nodes.length} nodes · ${snapshot.edges.length} links` : workspaceRootAssetId || 'Choose a lineage workspace'}</span>
          {activeSeedLabel && <span className="lineage-seed-identity">{activeSeedLabel}</span>}
        </p>
      </div>
      <div className="lineage-primary-controls">
        <LineageWorkspacePicker
          activeWorkspace={activeWorkspace}
          closeSignal={closeSignal}
          loading={workspaceLoading}
          onNewLineage={onNewLineage}
          onRefresh={onRefreshWorkspaces}
          onSelect={onSelectWorkspace}
          workspaces={workspaces}
        />
        <button className="primary-button" onClick={onNewLineage} type="button">New lineage</button>
        {!activeWorkspace && (
          <button className="secondary-button" disabled={workspaceLoading} onClick={() => runAndClose(onSeedDemo)} type="button">Load demo lineage</button>
        )}
        <details className="lineage-demo-menu" onToggle={event => setDemoOpen(event.currentTarget.open)} open={demoOpen}>
          <summary onKeyDown={closeMenusOnEscape} tabIndex={0}>
            <span>QA seed media</span>
            <strong>{swissifierMediaLabel}</strong>
          </summary>
          <div>
            <p>
              <strong>Basic SVG demo</strong>
              <span>{mediaLabel}</span>
            </p>
            <button disabled={workspaceLoading || demoSeedStatus?.present === demoSeedStatus?.total} onClick={onRestoreDemoMedia} type="button">Restore media</button>
            <button disabled={workspaceLoading} onClick={() => runAndClose(onSeedDemo)} type="button">Load SVG placeholder demo</button>
            <p>
              <strong>Swissifier rich demo</strong>
              <span>{swissifierMediaLabel}</span>
            </p>
            <button disabled={workspaceLoading || !swissifierCanDownload} onClick={onDownloadSwissifierMedia} type="button">Download rich images</button>
            <button disabled={workspaceLoading || swissifierReady} onClick={onRestoreSwissifierMedia} type="button">Restore media</button>
            <button disabled={workspaceLoading} onClick={() => runAndClose(onSeedSwissifierDemo)} type="button">Load rich image demo</button>
            <button disabled={workspaceLoading || !activeWorkspace} onClick={() => runAndClose(onArchiveWorkspace)} type="button">Archive current lineage</button>
          </div>
        </details>
      </div>
      <button
        aria-controls="lineage-selection-panel"
        aria-expanded={sideOpen}
        className="lineage-next-summary"
        disabled={!snapshot}
        onClick={onToggleNextPanel}
        type="button"
      >
        <span>Next variation</span>
        <strong>{nextVariationId}</strong>
        <small>{latestCount} latest candidate{latestCount === 1 ? '' : 's'}</small>
      </button>
      <label className="lineage-direction-control">
        <span>Direction</span>
        <select
          aria-label="Lineage graph direction"
          disabled={!snapshot || loading}
          onChange={event => onGraphDirection(event.target.value as LineageGraphDirection)}
          value={graphDirection}
        >
          <option value="LR">Left to right</option>
          <option value="TB">Top to bottom</option>
          <option value="RL">Right to left</option>
          <option value="BT">Bottom to top</option>
        </select>
      </label>
      <details className="lineage-overflow" onToggle={event => setActionsOpen(event.currentTarget.open)} open={actionsOpen}>
        <summary onKeyDown={closeMenusOnEscape} tabIndex={0}>Actions</summary>
        <div>
          <button disabled={!snapshot} onClick={() => runAndClose(onFitGraph)} type="button">Fit graph</button>
          <button disabled={!snapshot} onClick={() => runAndClose(onTidyGraph)} type="button">Tidy tree</button>
          <button disabled={workspaceLoading || !activeWorkspace} onClick={() => runAndClose(onArchiveWorkspace)} type="button">Archive current lineage</button>
          <button disabled={loading} onClick={() => runAndClose(onIndexLocal)} type="button">Index local</button>
          <button disabled={loading || !snapshot} onClick={() => runAndClose(onRefreshLineage)} type="button">Refresh graph</button>
          <button disabled={workspaceLoading} onClick={() => runAndClose(onRefreshWorkspaces)} type="button">Refresh workspaces</button>
        </div>
      </details>
    </header>
  );
}
