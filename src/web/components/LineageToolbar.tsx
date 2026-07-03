import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useState } from 'react';
import type { LineageSnapshot, LineageWorkspace } from '../../shared/types';
import type { DemoSeedMediaStatus } from './useLineageWorkspaces';
import { LineageWorkspacePicker } from './LineageWorkspacePicker';
import './LineageToolbar.css';

export function LineageToolbar({
  activeWorkspace,
  closeSignal,
  demoSeedStatus,
  latestCount,
  loading,
  nextVariationId,
  onArchiveWorkspace,
  onFitGraph,
  onIndexLocal,
  onNewLineage,
  onRefreshLineage,
  onRefreshWorkspaces,
  onRestoreDemoMedia,
  onSeedDemo,
  onSelectWorkspace,
  onTidyGraph,
  onToggleNextPanel,
  sideOpen,
  snapshot,
  workspaceLoading,
  workspaceRootAssetId,
  workspaces,
}: {
  activeWorkspace: LineageWorkspace | null;
  closeSignal: number;
  demoSeedStatus: DemoSeedMediaStatus | null;
  latestCount: number;
  loading: boolean;
  nextVariationId: string;
  onArchiveWorkspace: () => void;
  onFitGraph: () => void;
  onIndexLocal: () => void;
  onNewLineage: () => void;
  onRefreshLineage: () => void;
  onRefreshWorkspaces: () => void;
  onRestoreDemoMedia: () => void;
  onSeedDemo: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onTidyGraph: () => void;
  onToggleNextPanel: () => void;
  sideOpen: boolean;
  snapshot: LineageSnapshot | null;
  workspaceLoading: boolean;
  workspaceRootAssetId: string;
  workspaces: LineageWorkspace[];
}) {
  const mediaLabel = demoSeedStatus ? `${demoSeedStatus.present}/${demoSeedStatus.total} media files` : 'Checking media';
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
        <p>{snapshot ? `${snapshot.nodes.length} nodes · ${snapshot.edges.length} links` : workspaceRootAssetId || 'Choose a lineage workspace'}</p>
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
            <span>Demo seed</span>
            <strong>{mediaLabel}</strong>
          </summary>
          <div>
            <p>
              <strong>Demo demo lineage</strong>
              <span>{mediaLabel}</span>
            </p>
            <button disabled={workspaceLoading || demoSeedStatus?.present === demoSeedStatus?.total} onClick={onRestoreDemoMedia} type="button">Restore media</button>
            <button disabled={workspaceLoading} onClick={() => runAndClose(onSeedDemo)} type="button">Load demo lineage</button>
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
