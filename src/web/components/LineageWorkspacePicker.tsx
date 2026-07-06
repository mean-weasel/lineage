import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { AgentClaimSummary, AgentClaimsResponse, LineageWorkspace } from '../../shared/types';
import { api } from '../api';
import { agentClaimOccupancyLabel, agentClaimOccupancyState, lineageWorkspaceClaims, lineageWorkspaceOptionLabel } from './lineageWorkspacePickerModel';
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
  const [claims, setClaims] = useState<AgentClaimSummary[]>([]);
  const pickerRef = useRef<HTMLElement | null>(null);
  const project = activeWorkspace?.project || workspaces[0]?.project || '';

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

  useEffect(() => {
    if (!project) {
      setClaims([]);
      return;
    }
    let cancelled = false;
    api<AgentClaimsResponse>(`/api/agent-claims?${new URLSearchParams({ project })}`)
      .then(response => { if (!cancelled) setClaims(response.claims); })
      .catch(() => { if (!cancelled) setClaims([]); });
    return () => { cancelled = true; };
  }, [project, closeSignal, workspaces.length]);

  function select(workspaceId: string) {
    setOpen(false);
    onSelect(workspaceId);
  }

  const activeClaims = activeWorkspace ? lineageWorkspaceClaims(claims, activeWorkspace) : [];

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
        <ClaimOccupancy claims={activeClaims} />
      </button>
      {open && (
        <div className="lineage-workspace-menu">
          <div className="lineage-workspace-options" role="listbox">
            {workspaces.length === 0 && <p>No workspaces yet.</p>}
            {workspaces.map(workspace => (
              <WorkspaceOption
                active={activeWorkspace?.id === workspace.id}
                claims={lineageWorkspaceClaims(claims, workspace)}
                key={workspace.id}
                onSelect={() => select(workspace.id)}
                workspace={workspace}
              />
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

function WorkspaceOption({ active, claims, onSelect, workspace }: {
  active: boolean;
  claims: AgentClaimSummary[];
  onSelect: () => void;
  workspace: LineageWorkspace;
}) {
  return (
    <button
      aria-selected={active}
      className={active ? 'active' : ''}
      onClick={onSelect}
      role="option"
      type="button"
    >
      <strong>{workspace.title}</strong>
      <code>{workspace.root_asset_id}</code>
      <span>{lineageWorkspaceOptionLabel(workspace)}</span>
      <ClaimOccupancy claims={claims} />
    </button>
  );
}

function ClaimOccupancy({ claims }: { claims: AgentClaimSummary[] }) {
  if (claims.length === 0) return null;
  const state = agentClaimOccupancyState(claims);
  return (
    <small className={`lineage-workspace-claim ${state}`}>
      <ShieldCheck size={13} />
      <span>{agentClaimOccupancyLabel(claims)}</span>
    </small>
  );
}
