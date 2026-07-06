import { useEffect, useState } from 'react';
import { Bot, ChevronDown, Clipboard, Crosshair, FileSearch, Flag, ListChecks, RefreshCcw, ShieldCheck } from 'lucide-react';
import type { AgentClaimSummary, AgentClaimsResponse, AssetSelectionSnapshot, ContentOpsQueueSnapshot, ContentTargetSnapshot, GrowthAsset } from '../../shared/types';
import { api } from '../api';
import { assetStorageState, type StudioView } from '../assetUi';
import './CurrentWorkTargetPanel.css';

type ClaimControlAction = 'release-stale' | 'revoke' | 'transfer';

function agentSelectedCommand(project: string): string {
  return `npx lineage agent selected --project ${project}`;
}

function agentSelectedPromptCommand(project: string): string {
  return `npx lineage agent work on the selected target for ${project} --project ${project}`;
}

function agentNextCommand(project: string): string {
  return `npx lineage agent next --project ${project}`;
}

function agentSelectionsCommand(project: string): string {
  return `npx lineage agent selections --project ${project}`;
}

export function CurrentWorkTarget({
  onCopy,
  project,
  refreshKey,
  selectedAsset,
  view,
}: {
  onCopy: (text: string, label: string) => Promise<void>;
  project: string;
  refreshKey: number;
  selectedAsset?: GrowthAsset;
  view: StudioView;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<AssetSelectionSnapshot | null>(null);
  const [target, setTarget] = useState<ContentTargetSnapshot | null>(null);
  const [queue, setQueue] = useState<ContentOpsQueueSnapshot | null>(null);
  const [claims, setClaims] = useState<AgentClaimSummary[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ project });
      const [nextTarget, nextQueue, nextSelection, nextClaims] = await Promise.all([
        api<ContentTargetSnapshot>(`/api/content/target?${params}`),
        api<ContentOpsQueueSnapshot>(`/api/content/queue?${params}`),
        api<AssetSelectionSnapshot>(`/api/selections?${params}`),
        api<AgentClaimsResponse>(`/api/agent-claims?${params}`),
      ]);
      setTarget(nextTarget);
      setQueue(nextQueue);
      setSelection(nextSelection);
      setClaims(nextClaims.claims);
      setError(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [project, refreshKey]);

  useEffect(() => {
    const listener = () => { void refresh(); };
    window.addEventListener('asset-selection-updated', listener);
    return () => window.removeEventListener('asset-selection-updated', listener);
  }, [project]);

  async function controlClaim(action: ClaimControlAction, claim: AgentClaimSummary) {
    const body = claimControlBody(action, claim);
    if (!body) return;
    await api(`/api/agent-claims/${claim.id}/${action}`, {
      body: JSON.stringify({ project, ...body }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    await refresh();
  }

  return <CurrentWorkTargetPanel claims={claims} drawerOpen={drawerOpen} error={error} loading={loading} onClaimControl={(action, claim) => { void controlClaim(action, claim); }} onCopy={onCopy} onRefresh={() => void refresh()} onToggleDrawer={() => setDrawerOpen(current => !current)} project={project} queue={queue} selectedAsset={selectedAsset} selection={selection} target={target} view={view} />;
}

export function CurrentWorkTargetPanel({
  drawerOpen = false,
  claims = [],
  error,
  loading,
  onClaimControl,
  onCopy,
  onRefresh,
  onToggleDrawer,
  project,
  queue,
  selectedAsset,
  selection,
  target,
  view,
}: {
  drawerOpen?: boolean;
  claims?: AgentClaimSummary[];
  error?: string | null;
  loading: boolean;
  onClaimControl?: (action: ClaimControlAction, claim: AgentClaimSummary) => void;
  onCopy: (text: string, label: string) => Promise<void>;
  onRefresh: () => void;
  onToggleDrawer?: () => void;
  project: string;
  queue: ContentOpsQueueSnapshot | null;
  selectedAsset?: GrowthAsset;
  selection?: AssetSelectionSnapshot | null;
  target: ContentTargetSnapshot | null;
  view: StudioView;
}) {
  const lineageContext = view === 'lineage';
  const selectedTarget = target?.target;
  const nextItem = queue?.next_action;
  const selectedAssets = selection?.current.items.filter(item => item.selected_at && !item.deselected_at) || [];
  const selectedTargetClaims = selectedTarget
    ? claimsForTarget(claims, project, 'content_post', selectedTarget.post.id, selectedTarget.post.channel)
    : [];
  const queueLaneClaims = nextItem
    ? claimsForTarget(claims, project, 'content_queue_lane', queue?.next_action_lane?.id || nextItem.readiness, nextItem.post.channel)
    : [];
  const selectionClaims = selection?.current
    ? claimsForTarget(claims, project, 'selection_set', selection.current.id)
    : [];
  const visibleClaimCount = new Set([...selectedTargetClaims, ...queueLaneClaims, ...selectionClaims].map(claim => claim.id)).size;
  const drawerSummary = selectedAssets.length > 0
    ? `${selectedAssets.length} selected asset${selectedAssets.length === 1 ? '' : 's'}`
    : selectedTarget
      ? 'Selected content target'
      : nextItem
        ? 'Next content item ready'
        : 'Natural language handoff ready';
  const drawerSummaryWithClaims = visibleClaimCount > 0 ? `${drawerSummary} · ${visibleClaimCount} claim${visibleClaimCount === 1 ? '' : 's'}` : drawerSummary;
  return (
    <section className={`current-work-panel ${lineageContext ? 'lineage-context' : ''} ${drawerOpen ? 'open' : 'collapsed'}`} aria-label="Agent context drawer" data-testid="agent-context-drawer">
      <header>
        <button
          aria-controls="agent-context-drawer-body"
          aria-expanded={drawerOpen}
          className="work-target-toggle"
          data-testid="agent-context-toggle"
          onClick={onToggleDrawer}
          type="button"
        >
          <span className="work-target-toggle-icon"><Bot size={16} /></span>
          <span>
            <strong>Agent context</strong>
            <small>{drawerSummaryWithClaims}</small>
          </span>
          <ChevronDown className="work-target-chevron" size={17} />
        </button>
        <button className="secondary-button" disabled={loading} onClick={onRefresh} type="button">
          <RefreshCcw className={loading ? 'spin' : ''} size={15} />Refresh
        </button>
      </header>
      <div
        className={`work-target-drawer-body ${drawerOpen ? 'open' : 'collapsed'}`}
        data-testid="agent-context-drawer-body"
        id="agent-context-drawer-body"
        style={{
          height: drawerOpen ? 360 : 0,
          opacity: drawerOpen ? 1 : 0,
          transform: drawerOpen ? 'translateY(0)' : 'translateY(10px)',
        }}
      >
        <div className="work-target-drawer-content">
          <p className="work-target-intro">Use plain English in the agent session, or keep the exact CLI commands here when precision helps.</p>
          {error && <p className="work-target-error">{error}</p>}
          <div className="work-target-grid">
        <article className={selectedTarget ? 'work-target-card primary' : 'work-target-card'}>
          <div className="work-target-title">
            <Flag size={16} />
            <div>
              <span>Content selected target</span>
              <small>SQLite content target</small>
            </div>
          </div>
          {selectedTarget ? (
            <>
              <strong>{selectedTarget.post.title}</strong>
              <code>{selectedTarget.post.id}</code>
              <p>{selectedTarget.post.channel} · {selectedTarget.readiness} · {selectedTarget.post.assets.length} asset{selectedTarget.post.assets.length === 1 ? '' : 's'}</p>
              {claimOccupancy(selectedTargetClaims, onClaimControl)}
              <code className="command-line">{agentSelectedCommand(project)}</code>
              <div className="work-target-actions">
                <button onClick={() => void onCopy(agentSelectedCommand(project), 'agent selected command')} type="button"><Clipboard size={14} />Copy selected</button>
                <button onClick={() => void onCopy(agentSelectedPromptCommand(project), 'agent selected prompt')} type="button"><Clipboard size={14} />Copy prompt</button>
              </div>
            </>
          ) : (
            <>
              <strong>No selected content target</strong>
              <p>Say: work on the selected target for Demo.</p>
              <code className="command-line">{agentSelectedCommand(project)}</code>
            </>
          )}
        </article>
        <article className="work-target-card">
          <div className="work-target-title">
            <Crosshair size={16} />
            <div>
              <span>Content queue next</span>
              <small>Computed next action</small>
            </div>
          </div>
          {nextItem ? (
            <>
              <strong>{nextItem.post.title}</strong>
              <code>{nextItem.post.id}</code>
              <p>{nextItem.post.channel} · {nextItem.readiness} · {storageSummary(nextItem.asset_storage)}</p>
              {claimOccupancy(queueLaneClaims, onClaimControl)}
              <code className="command-line">{agentNextCommand(project)}</code>
              <div className="work-target-actions">
                <button onClick={() => void onCopy(agentNextCommand(project), 'agent next command')} type="button"><Clipboard size={14} />Copy next</button>
              </div>
            </>
          ) : (
            <>
              <strong>No actionable queue item</strong>
              <p>{queue?.warning || 'Say: what should I work on next for Demo.'}</p>
              <code className="command-line">{agentNextCommand(project)}</code>
            </>
          )}
        </article>
        <article className="work-target-card context">
          <div className="work-target-title">
            <FileSearch size={16} />
            <div>
              <span>Selected asset</span>
              <small>UI context, not an agent target</small>
            </div>
          </div>
          {selectedAsset ? (
            <>
              <strong>{selectedAsset.title}</strong>
              <code>{selectedAsset.asset_id}</code>
              <p>{selectedAsset.channel || 'no channel'} · {selectedAsset.status} · {assetStorageState(selectedAsset).label}</p>
              <div className="work-target-actions">
                <button onClick={() => void onCopy(selectedAsset.asset_id, 'selected asset ID')} type="button"><Clipboard size={14} />Copy asset ID</button>
              </div>
            </>
          ) : (
            <>
              <strong>No asset selected</strong>
              <p>Select an asset to use as context for content attachment, backup, or lineage work.</p>
            </>
          )}
        </article>
        <article className={selectedAssets.length > 0 ? 'work-target-card asset-selection' : 'work-target-card'} data-testid="agent-context-asset-selections">
          <div className="work-target-title">
            <ListChecks size={16} />
            <div>
              <span>Asset selections</span>
              <small>SQLite current set</small>
            </div>
          </div>
          {selectedAssets.length > 0 ? (
            <>
              <strong>{selectedAssets.length} selected asset{selectedAssets.length === 1 ? '' : 's'}</strong>
              <code>{selectedAssets.map(item => item.variation_label ? `${item.variation_label}:${item.asset_id}` : item.asset_id).join(', ')}</code>
              {claimOccupancy(selectionClaims, onClaimControl)}
              <code className="command-line">{agentSelectionsCommand(project)}</code>
              <div className="work-target-actions">
                <button onClick={() => void onCopy(agentSelectionsCommand(project), 'agent selections command')} type="button"><Clipboard size={14} />Copy selections</button>
              </div>
            </>
          ) : (
            <>
              <strong>No selected assets</strong>
              <p>Say: keep working on my selections.</p>
              <code className="command-line">{agentSelectionsCommand(project)}</code>
            </>
          )}
        </article>
          </div>
        </div>
      </div>
    </section>
  );
}

function claimsForTarget(claims: AgentClaimSummary[], project: string, scopeType: AgentClaimSummary['scope_type'], targetId: string, channel?: string): AgentClaimSummary[] {
  return claims.filter(claim => {
    if (claim.project !== project || claim.status !== 'active' || claim.derived_state === 'expired') return false;
    if (claim.scope_type === scopeType && claim.target_id === targetId) return true;
    return claim.scope_type === 'project_channel' && (!claim.channel || !channel || claim.channel === channel);
  });
}

function claimControlBody(action: ClaimControlAction, claim: AgentClaimSummary): { confirmWrite: true; reason?: string; toAgentName?: string } | null {
  if (action === 'release-stale') {
    if (!window.confirm(`Release stale claim held by ${claim.agent_name}?`)) return null;
    return { confirmWrite: true, reason: `Released stale ${claim.scope_type} claim ${claim.id} from the Agent context drawer.` };
  }
  if (action === 'revoke') {
    const reason = window.prompt(`Reason for revoking ${claim.agent_name}'s claim?`);
    if (!reason?.trim()) return null;
    if (!window.confirm(`Revoke claim ${claim.id} from ${claim.agent_name}?`)) return null;
    return { confirmWrite: true, reason: reason.trim() };
  }
  const toAgentName = window.prompt(`Transfer claim ${claim.id} to which agent?`);
  if (!toAgentName?.trim()) return null;
  if (!window.confirm(`Transfer claim ${claim.id} from ${claim.agent_name} to ${toAgentName.trim()}?`)) return null;
  return { confirmWrite: true, reason: `Transferred from Agent context drawer.`, toAgentName: toAgentName.trim() };
}

function claimOccupancy(claims: AgentClaimSummary[], onClaimControl?: (action: ClaimControlAction, claim: AgentClaimSummary) => void) {
  if (claims.length === 0) return null;
  const staleCount = claims.filter(claim => claim.derived_state === 'stale').length;
  const state = staleCount > 0 ? 'stale' : claims.some(claim => claim.derived_state === 'idle') ? 'idle' : 'active';
  const label = claims.length === 1
    ? `${state === 'active' ? 'Claimed' : state === 'idle' ? 'Idle claim' : 'Stale claim'} by ${claims[0].agent_name}`
    : `${claims.length} active claims`;
  return (
    <div className={`claim-occupancy ${state}`}>
      <p>
        <ShieldCheck size={14} />
        <span>{label}</span>
      </p>
      {onClaimControl && claims.length === 1 && (
        <span className="claim-occupancy-actions">
          {claims[0].derived_state === 'stale' && <button onClick={() => onClaimControl('release-stale', claims[0])} type="button">Release stale</button>}
          <button onClick={() => onClaimControl('transfer', claims[0])} type="button">Transfer</button>
          <button onClick={() => onClaimControl('revoke', claims[0])} type="button">Revoke</button>
        </span>
      )}
    </div>
  );
}

function storageSummary(storage: ContentOpsQueueSnapshot['totals']['storage']): string {
  if (storage.total === 0) return 'no assets';
  return [
    storage.local ? `${storage.local} local` : '',
    storage.s3 ? `${storage.s3} S3` : '',
    storage.unresolved ? `${storage.unresolved} unresolved` : '',
  ].filter(Boolean).join(' · ');
}
