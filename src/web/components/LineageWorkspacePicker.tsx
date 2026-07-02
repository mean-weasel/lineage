import { useEffect, useRef, useState } from 'react';
import type { LineageWorkspace } from '../../shared/types';
import { lineageWorkspaceOptionLabel } from './lineageWorkspacePickerModel';
import './LineageWorkspacePicker.css';

export function LineageWorkspacePicker({
  activeWorkspace,
  closeSignal,
  loading,
  onNewLineage,
  onRefresh,
  onSelect,
  workspaces,
}: {
  activeWorkspace: LineageWorkspace | null;
  closeSignal?: number;
  loading: boolean;
  onNewLineage: () => void;
  onRefresh: () => void;
  onSelect: (workspaceId: string) => void;
  workspaces: LineageWorkspace[];
}) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [closeSignal]);

  function select(workspaceId: string) {
    setOpen(false);
    onSelect(workspaceId);
  }

  return (
    <section aria-label="Lineage workspace picker" className="lineage-workspace-picker" ref={pickerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="lineage-workspace-trigger"
        disabled={loading}
        onClick={() => setOpen(value => !value)}
        onKeyDown={event => {
          if (event.key === 'Escape') setOpen(false);
        }}
        type="button"
      >
        <span>Workspace</span>
        <strong>{activeWorkspace?.title || 'No workspace selected'}</strong>
        <code>{activeWorkspace?.root_asset_id || 'Start with New lineage'}</code>
      </button>
      {open && (
        <div className="lineage-workspace-menu">
          <div className="lineage-workspace-options" role="listbox">
            {workspaces.length === 0 && <p>No workspaces yet.</p>}
            {workspaces.map(workspace => (
              <button
                aria-selected={activeWorkspace?.id === workspace.id}
                className={activeWorkspace?.id === workspace.id ? 'active' : ''}
                key={workspace.id}
                onClick={() => select(workspace.id)}
                role="option"
                type="button"
              >
                <strong>{workspace.title}</strong>
                <code>{workspace.root_asset_id}</code>
                <span>{lineageWorkspaceOptionLabel(workspace)}</span>
              </button>
            ))}
          </div>
          <footer>
            <button className="secondary-button" disabled={loading} onClick={onRefresh} type="button">Refresh</button>
            <button
              className="primary-button"
              onClick={() => {
                setOpen(false);
                onNewLineage();
              }}
              type="button"
            >
              New lineage
            </button>
          </footer>
        </div>
      )}
    </section>
  );
}
