import { type KeyboardEvent as ReactKeyboardEvent, useEffect } from 'react';
import type { LineageSnapshot, LineageWorkspace } from '../../shared/types';
import type { LineageWorkspaceProgress } from './LineageCanvas';
import type { DemoSeedMediaStatus } from './useLineageWorkspaces';
import type { LineageGraphDirection } from './lineageGraph';
import { LineageWorkspacePicker } from './LineageWorkspacePicker';
import './LineageToolbar.css';

type LineageToolbarProps = {
  activeWorkspace: LineageWorkspace | null;
  actionsOpen: boolean;
  closeSignal: number;
  demoSeedStatus: DemoSeedMediaStatus | null;
  edgeSummariesVisible: boolean;
  graphDirection: LineageGraphDirection;
  loading: boolean;
  onArchiveWorkspace: () => void;
  onActionsOpenChange: (open: boolean) => void;
  onDownloadSwissifierMedia: () => void;
  onEdgeSummariesVisible: () => void;
  onFitGraph: () => void;
  onGraphDirection: (direction: LineageGraphDirection) => void;
  onIndexLocal: () => void;
  onNewLineage: () => void;
  onRefreshLineage: () => void;
  onRefreshWorkspaces: () => void;
  onReplayGrowth: () => void;
  onRestoreDemoMedia: () => void;
  onRestoreSwissifierMedia: () => void;
  onSeedDemo: () => void;
  onSeedSwissifierDemo: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onTidyGraph: () => void;
  onToggleNextPanel: () => void;
  sideOpen: boolean;
  replayActive: boolean;
  snapshot: LineageSnapshot | null;
  swissifierDemoStatus: DemoSeedMediaStatus | null;
  workspaceLoading: boolean;
  workspaceProgress: LineageWorkspaceProgress;
  workspaceRootAssetId: string;
  workspaces: LineageWorkspace[];
};

export function LineageToolbar({
  activeWorkspace,
  actionsOpen,
  closeSignal,
  demoSeedStatus,
  edgeSummariesVisible,
  graphDirection,
  loading,
  onArchiveWorkspace,
  onActionsOpenChange,
  onDownloadSwissifierMedia,
  onEdgeSummariesVisible,
  onFitGraph,
  onGraphDirection,
  onIndexLocal,
  onNewLineage,
  onRefreshLineage,
  onRefreshWorkspaces,
  onReplayGrowth,
  onRestoreDemoMedia,
  onRestoreSwissifierMedia,
  onSeedDemo,
  onSeedSwissifierDemo,
  onSelectWorkspace,
  onTidyGraph,
  onToggleNextPanel,
  sideOpen,
  replayActive,
  snapshot,
  swissifierDemoStatus,
  workspaceLoading,
  workspaceProgress,
  workspaceRootAssetId,
  workspaces,
}: LineageToolbarProps) {
  const mediaLabel = demoSeedStatus ? `${demoSeedStatus.present}/${demoSeedStatus.total} SVG placeholders` : 'Checking media';
  const swissifierMediaLabel = swissifierDemoStatus ? `${swissifierDemoStatus.present}/${swissifierDemoStatus.total} PNG images` : 'Checking media';
  const swissifierReady = Boolean(swissifierDemoStatus && swissifierDemoStatus.present === swissifierDemoStatus.total);
  const swissifierCanDownload = Boolean(swissifierDemoStatus?.download_available && !swissifierReady);
  const progressLabel = workspaceProgress === 'downloading' ? 'Downloading rich demo media'
    : workspaceProgress === 'downloaded' ? 'Rich demo media ready to seed'
      : workspaceProgress === 'seeding' ? 'Creating rich demo workspace'
        : workspaceProgress === 'indexing' ? 'Indexing 14 rich demo images'
          : workspaceProgress === 'ready' ? 'Rich demo ready'
            : workspaceProgress === 'error' ? 'Rich demo setup failed'
              : null;
  const workspaceBusy = workspaceLoading || ['downloading', 'seeding', 'indexing'].includes(workspaceProgress || '');
  const workspaceContext = progressLabel || (snapshot ? `${snapshot.nodes.length} nodes · ${snapshot.edges.length} links` : workspaceRootAssetId || 'Choose a lineage workspace');
  useEffect(() => {
    onActionsOpenChange(false);
  }, [closeSignal, onActionsOpenChange]);

  useEffect(() => {
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return;
      onActionsOpenChange(false);
    }
    document.addEventListener('keydown', closeOnEscape, true);
    return () => document.removeEventListener('keydown', closeOnEscape, true);
  }, [onActionsOpenChange]);

  function runAndClose(action: () => void) {
    onActionsOpenChange(false);
    action();
  }

  function closeMenusOnEscape(event: ReactKeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    onActionsOpenChange(false);
  }

  return (
    <header className="lineage-header">
      <div className="lineage-primary-controls">
        <LineageWorkspacePicker
          activeWorkspace={activeWorkspace}
          closeSignal={closeSignal}
          loading={workspaceBusy}
          onNewLineage={onNewLineage}
          onRefresh={onRefreshWorkspaces}
          onSelect={onSelectWorkspace}
          workspaces={workspaces}
        />
        <p className="lineage-toolbar-context">{workspaceContext}</p>
        <button
          aria-pressed={replayActive}
          className="secondary-button lineage-replay-launch"
          disabled={replayActive || !snapshot || snapshot.nodes.length < 2 || snapshot.edges.length === 0}
          onClick={onReplayGrowth}
          type="button"
        >
          Replay growth
        </button>
        <button className="primary-button" onClick={onNewLineage} type="button">New lineage</button>
      </div>
      <details className="lineage-overflow" onToggle={event => onActionsOpenChange(event.currentTarget.open)} open={actionsOpen}>
        <summary onKeyDown={closeMenusOnEscape} tabIndex={0}>Actions</summary>
        <div>
          {!activeWorkspace && (
            <button disabled={workspaceBusy} onClick={() => runAndClose(onSeedDemo)} type="button">Load demo lineage</button>
          )}
          <p>
            <strong>QA seed media</strong>
            <span>{swissifierMediaLabel}</span>
          </p>
          <p>
            <strong>Basic SVG demo</strong>
            <span>{mediaLabel}</span>
          </p>
          <button disabled={workspaceBusy || demoSeedStatus?.present === demoSeedStatus?.total} onClick={onRestoreDemoMedia} type="button">Restore basic media</button>
          <button disabled={workspaceBusy} onClick={() => runAndClose(onSeedDemo)} type="button">Load SVG placeholder demo</button>
          <p>
            <strong>Swissifier rich demo</strong>
            <span>{swissifierMediaLabel}</span>
          </p>
          <button disabled={workspaceBusy || !swissifierCanDownload} onClick={onDownloadSwissifierMedia} type="button">Download rich images</button>
          <button disabled={workspaceBusy || swissifierReady} onClick={onRestoreSwissifierMedia} type="button">Restore rich media</button>
          <button disabled={workspaceBusy} onClick={() => runAndClose(onSeedSwissifierDemo)} type="button">Load rich image demo</button>
          <label className="lineage-action-select">
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
          <button
            aria-pressed={edgeSummariesVisible}
            disabled={!snapshot}
            onClick={() => runAndClose(onEdgeSummariesVisible)}
            type="button"
          >
            {edgeSummariesVisible ? 'Hide edge labels' : 'Show edge labels'}
          </button>
          <button disabled={!snapshot} onClick={() => runAndClose(onFitGraph)} type="button">Fit graph</button>
          <button disabled={!snapshot} onClick={() => runAndClose(onTidyGraph)} type="button">Tidy tree</button>
          <button aria-controls="lineage-selection-panel" aria-expanded={sideOpen} disabled={!snapshot} onClick={() => runAndClose(onToggleNextPanel)} type="button">Manage selection</button>
          <button disabled={workspaceBusy || !activeWorkspace} onClick={() => runAndClose(onArchiveWorkspace)} type="button">Archive current lineage</button>
          <button disabled={loading || workspaceBusy} onClick={() => runAndClose(onIndexLocal)} type="button">Index local</button>
          <button disabled={loading || !snapshot} onClick={() => runAndClose(onRefreshLineage)} type="button">Refresh graph</button>
          <button disabled={workspaceBusy} onClick={() => runAndClose(onRefreshWorkspaces)} type="button">Refresh workspaces</button>
        </div>
      </details>
    </header>
  );
}
