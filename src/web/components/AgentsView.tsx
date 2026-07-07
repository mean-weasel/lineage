import { ArrowRight, Clipboard, Filter, RefreshCcw, Search, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AgentClaimsResponse, AgentClaimSummary } from '../../shared/types';
import type { StudioView } from '../assetUi';
import { api } from '../api';
import './AgentsView.css';

type StatusFilter = 'open' | 'attention' | 'closed' | 'all';
type ScopeFilter = AgentClaimSummary['scope_type'] | 'all';
export type AgentWorkTarget = { assetId?: string; claim: AgentClaimSummary; view: StudioView; workspaceId?: string };

export function AgentsView({
  onCopy,
  onOpenWork,
  project,
}: {
  onCopy: (text: string, label: string) => Promise<void>;
  onOpenWork: (target: AgentWorkTarget) => void;
  project: string;
}) {
  const [claims, setClaims] = useState<AgentClaimSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  async function refresh() {
    setLoading(true);
    try {
      const response = await api<AgentClaimsResponse>(`/api/agent-claims?${new URLSearchParams({ project })}`);
      setClaims(response.claims);
      setError(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [project]);

  const filteredClaims = useMemo(() => claims.filter(claim => matchesFilters(claim, query, scopeFilter, statusFilter)), [claims, query, scopeFilter, statusFilter]);
  const scopes = useMemo(() => [...new Set(claims.map(claim => claim.scope_type))].sort(), [claims]);

  return (
    <section className="agents-view" aria-label="Agents">
      <header className="agents-head">
        <div>
          <h2>Agents</h2>
          <p>{project} active work claims</p>
        </div>
        <button className="secondary-button" disabled={loading} onClick={() => void refresh()} type="button">
          <RefreshCcw className={loading ? 'spin' : ''} size={17} />Refresh
        </button>
      </header>
      {error && <p className="agents-error">{error}</p>}
      <div className="agents-workspace">
        <section className="agents-browser" aria-label="Agent claim browser">
          <div className="agents-filters">
            <label>
              <Search size={15} />
              <input aria-label="Search claims" onChange={event => setQuery(event.target.value)} placeholder="Agent, target, channel..." value={query} />
            </label>
            <label>
              <Filter size={15} />
              <select aria-label="Filter status" onChange={event => setStatusFilter(event.target.value as StatusFilter)} value={statusFilter}>
                <option value="open">Open</option>
                <option value="attention">Attention</option>
                <option value="closed">Closed</option>
                <option value="all">All</option>
              </select>
            </label>
            <select aria-label="Filter scope" onChange={event => setScopeFilter(event.target.value as ScopeFilter)} value={scopeFilter}>
              <option value="all">All scopes</option>
              {scopes.map(scope => <option key={scope} value={scope}>{scopeLabel(scope)}</option>)}
            </select>
          </div>
          <ClaimGroup
            claims={filteredClaims}
            empty="No claims match these filters."
            onCopy={onCopy}
            onOpenWork={onOpenWork}
            title="Claims"
          />
        </section>
      </div>
    </section>
  );
}

function ClaimGroup({
  claims,
  empty,
  onCopy,
  onOpenWork,
  title,
}: {
  claims: AgentClaimSummary[];
  empty: string;
  onCopy: (text: string, label: string) => Promise<void>;
  onOpenWork: (target: AgentWorkTarget) => void;
  title: string;
}) {
  return (
    <section className="agents-group">
      <h3>{title}</h3>
      {claims.length === 0 ? <p className="agents-empty">{empty}</p> : (
        <div className="agents-list">
          {claims.map(claim => (
            <ClaimRow
              claim={claim}
              key={claim.id}
              onCopy={onCopy}
              onOpenWork={onOpenWork}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ClaimRow({
  claim,
  onCopy,
  onOpenWork,
}: {
  claim: AgentClaimSummary;
  onCopy: (text: string, label: string) => Promise<void>;
  onOpenWork: (target: AgentWorkTarget) => void;
}) {
  const openWork = () => onOpenWork(workTargetForClaim(claim));
  return (
    <article
      className={`agent-claim-row ${claim.derived_state}`}
      onDoubleClick={openWork}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openWork();
        }
      }}
      tabIndex={0}
      title="Double-click to open the corresponding graph"
    >
      <div className="agent-claim-main">
        <ShieldCheck size={16} />
        <div>
          <strong>{claim.agent_name}</strong>
          <span>{scopeLabel(claim.scope_type)} · {claim.derived_state}</span>
        </div>
      </div>
      <div className="agent-claim-target">
        <strong>{claim.target_title || claim.target_id}</strong>
        <code>{claim.target_id}</code>
      </div>
      <dl>
        <div><dt>Project</dt><dd>{claim.project}</dd></div>
        <div><dt>Channel</dt><dd>{claim.channel || 'all'}</dd></div>
        <div><dt>Last seen</dt><dd>{formatAge(claim.heartbeat_age_seconds)}</dd></div>
        <div><dt>Expires</dt><dd>{formatDateTime(claim.expires_at)}</dd></div>
      </dl>
      <div className="agent-row-actions">
        <button
          aria-label={`Open graph for ${claim.agent_name}`}
          className="secondary-button agent-row-open-graph"
          onClick={event => {
            event.stopPropagation();
            openWork();
          }}
          type="button"
        >
          <ArrowRight size={14} />
          Open graph
        </button>
        <button
          aria-label={`Copy briefing for ${claim.agent_name}`}
          className="secondary-button agent-row-copy-briefing"
          onClick={event => {
            event.stopPropagation();
            void onCopy(agentBriefingText(claim), 'agent briefing');
          }}
          type="button"
        >
          <Clipboard size={14} />
          Copy briefing
        </button>
      </div>
    </article>
  );
}

function workTargetForClaim(claim: AgentClaimSummary): AgentWorkTarget {
  const assetId = lineageRootFromTarget(claim.target_id);
  return { assetId, claim, view: 'lineage', workspaceId: assetId ? claim.target_id : undefined };
}

function lineageRootFromTarget(targetId: string): string | undefined {
  const marker = ':lineage-workspace:';
  const index = targetId.indexOf(marker);
  return index >= 0 ? targetId.slice(index + marker.length) : undefined;
}

function agentBriefingText(claim: AgentClaimSummary): string {
  const rootAssetId = lineageRootFromTarget(claim.target_id);
  return [
    `Agent briefing: ${claim.agent_name}`,
    `Project: ${claim.project}`,
    `Target: ${claim.target_title || claim.target_id}`,
    `Claim: ${claim.id}`,
    `Scope: ${scopeLabel(claim.scope_type)}`,
    `Channel: ${claim.channel || 'all'}`,
    `Status: ${claim.status} / ${claim.derived_state}`,
    rootAssetId ? `Lineage root: ${rootAssetId}` : undefined,
    rootAssetId ? `Inspect graph: npx @mean-weasel/lineage next --project ${claim.project} --root ${rootAssetId} --json` : undefined,
    rootAssetId ? `Brief graph: npx @mean-weasel/lineage brief --project ${claim.project} --root ${rootAssetId} --json` : undefined,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function matchesFilters(claim: AgentClaimSummary, query: string, scopeFilter: ScopeFilter, statusFilter: StatusFilter): boolean {
  if (scopeFilter !== 'all' && claim.scope_type !== scopeFilter) return false;
  if (statusFilter === 'open' && claim.status !== 'active') return false;
  if (statusFilter === 'attention' && !(claim.status === 'active' && (claim.derived_state === 'stale' || claim.derived_state === 'expired'))) return false;
  if (statusFilter === 'closed' && claim.status === 'active') return false;
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    claim.agent_name,
    claim.agent_id,
    claim.channel,
    claim.project,
    claim.scope_type,
    claim.status,
    claim.target_id,
    claim.target_title,
  ].some(value => value?.toLowerCase().includes(normalized));
}

function scopeLabel(scope: AgentClaimSummary['scope_type']): string {
  return scope.replace(/_/g, ' ');
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
