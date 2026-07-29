import { useEffect, useState } from 'react';
import type { LineageSnapshot, LineageWorkspace } from '../../shared/types';
import type { LineageWorkspaceProgress } from './LineageCanvas';
import type { DemoSeedMediaStatus } from './useLineageWorkspaces';
import { LineageWorkspacePicker } from './LineageWorkspacePicker';
import './LineageToolbar.css';

type LineageToolbarProps = {
  activeWorkspace: LineageWorkspace | null;
  closeSignal: number;
  demoSeedStatus: DemoSeedMediaStatus | null;
  loading: boolean;
  onArchiveWorkspace: () => void;
  onDownloadSwissifierMedia: () => void;
  onIndexLocal: () => void;
  onNewLineage: () => void;
  onOpenGeneration?: () => void;
  onOpenOutputDefaults?: () => void;
  onRefreshLineage: () => void;
  onRefreshWorkspaces: () => void;
  onReplayGrowth: () => void;
  onRestoreDemoMedia: () => void;
  onRestoreSwissifierMedia: () => void;
  onSeedDemo: () => void;
  onSeedSwissifierDemo: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
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
  closeSignal,
  demoSeedStatus,
  loading,
  onArchiveWorkspace,
  onDownloadSwissifierMedia,
  onIndexLocal,
  onNewLineage,
  onOpenGeneration,
  onOpenOutputDefaults,
  onRefreshLineage,
  onRefreshWorkspaces,
  onReplayGrowth,
  onRestoreDemoMedia,
  onRestoreSwissifierMedia,
  onSeedDemo,
  onSeedSwissifierDemo,
  onSelectWorkspace,
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
  const [demoToolsOpen, setDemoToolsOpen] = useState(false);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
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
    setDemoToolsOpen(false);
    setMaintenanceOpen(false);
  }, [closeSignal]);

  useEffect(() => {
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setDemoToolsOpen(false);
      setMaintenanceOpen(false);
    }
    document.addEventListener('keydown', closeOnEscape, true);
    return () => document.removeEventListener('keydown', closeOnEscape, true);
  }, []);

  return (
    <section className="lineage-context-tools">
      <div className="lineage-primary-controls">
        <LineageWorkspacePicker
          activeWorkspace={activeWorkspace}
          closeSignal={closeSignal}
          loading={workspaceBusy}
          onArchive={onArchiveWorkspace}
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
        {onOpenGeneration && <button className="primary-button" disabled={!snapshot || snapshot.selected.length === 0} onClick={onOpenGeneration} type="button">Plan outputs</button>}
        {onOpenOutputDefaults && <button className="secondary-button" disabled={!snapshot} onClick={onOpenOutputDefaults} type="button">Output target defaults</button>}
        <button aria-controls="lineage-canvas-panel" aria-expanded={sideOpen} className="secondary-button" disabled={!snapshot} onClick={onToggleNextPanel} type="button">Manage selection</button>
      </div>
      <div className="lineage-tool-sections">
        <details className="lineage-tool-section" onToggle={event => setMaintenanceOpen(event.currentTarget.open)} open={maintenanceOpen}>
          <summary>Maintenance</summary>
          <div>
            <button disabled={loading || !snapshot} onClick={onRefreshLineage} type="button">Refresh graph</button>
            <button disabled={workspaceBusy} onClick={onRefreshWorkspaces} type="button">Refresh workspaces</button>
            <button disabled={loading || workspaceBusy} onClick={onIndexLocal} type="button">Index local</button>
          </div>
        </details>
        <details className="lineage-tool-section" onToggle={event => setDemoToolsOpen(event.currentTarget.open)} open={demoToolsOpen}>
          <summary>Demo/QA</summary>
          <div>
            {!activeWorkspace && (
              <button disabled={workspaceBusy} onClick={onSeedDemo} type="button">Load demo lineage</button>
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
            <button disabled={workspaceBusy} onClick={onSeedDemo} type="button">Load SVG placeholder demo</button>
            <p>
              <strong>Swissifier rich demo</strong>
              <span>{swissifierMediaLabel}</span>
            </p>
            <button disabled={workspaceBusy || !swissifierCanDownload} onClick={onDownloadSwissifierMedia} type="button">Download rich images</button>
            <button disabled={workspaceBusy || swissifierReady} onClick={onRestoreSwissifierMedia} type="button">Restore rich media</button>
            <button disabled={workspaceBusy} onClick={onSeedSwissifierDemo} type="button">Load rich image demo</button>
          </div>
        </details>
      </div>
    </section>
  );
}
