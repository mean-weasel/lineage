import { RefreshCcw, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AgentClaimsResponse, AgentClaimSummary } from '../../shared/types';
import { api } from '../api';
import './AgentsView.css';

export function AgentsView({ project }: { project: string }) {
  const [claims, setClaims] = useState<AgentClaimSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const active = useMemo(() => claims.filter(claim => claim.status === 'active' && claim.derived_state !== 'stale' && claim.derived_state !== 'expired'), [claims]);
  const stale = useMemo(() => claims.filter(claim => claim.status === 'active' && (claim.derived_state === 'stale' || claim.derived_state === 'expired')), [claims]);
  const inactive = useMemo(() => claims.filter(claim => claim.status !== 'active'), [claims]);

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
      <div className="agents-summary">
        <SummaryTile label="Active" value={active.length} />
        <SummaryTile label="Idle or stale" value={stale.length} />
        <SummaryTile label="Closed" value={inactive.length} />
      </div>
      <ClaimGroup claims={active} empty="No active agent claims." title="Active" />
      <ClaimGroup claims={stale} empty="No idle or stale claims." title="Idle / Stale" />
      <ClaimGroup claims={inactive.slice(0, 12)} empty="No closed claims." title="Recent closed" />
    </section>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ClaimGroup({ claims, empty, title }: { claims: AgentClaimSummary[]; empty: string; title: string }) {
  return (
    <section className="agents-group">
      <h3>{title}</h3>
      {claims.length === 0 ? <p className="agents-empty">{empty}</p> : (
        <div className="agents-list">
          {claims.map(claim => <ClaimRow claim={claim} key={claim.id} />)}
        </div>
      )}
    </section>
  );
}

function ClaimRow({ claim }: { claim: AgentClaimSummary }) {
  return (
    <article className={`agent-claim-row ${claim.derived_state}`}>
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
    </article>
  );
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
