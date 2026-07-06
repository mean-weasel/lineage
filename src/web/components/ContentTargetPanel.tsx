import { Clipboard, Flag, ShieldCheck, X } from 'lucide-react';
import type { AgentClaimSummary, ContentTargetSnapshot } from '../../shared/types';
import { api } from '../api';

type ClaimControlAction = 'release-stale' | 'revoke' | 'transfer';

function agentSelectedCommand(project: string): string {
  return `npx lineage agent selected --project ${project}`;
}

function agentSelectedPromptCommand(project: string): string {
  return `npx lineage agent work on the selected target for ${project} --project ${project}`;
}

interface ContentTargetPanelProps {
  agentClaims?: AgentClaimSummary[];
  onClear: () => Promise<void>;
  onCopy: (text: string, label: string) => Promise<void>;
  pending: boolean;
  target: ContentTargetSnapshot | null;
}

export function ContentTargetPanel({ agentClaims = [], onClear, onCopy, pending, target }: ContentTargetPanelProps) {
  const selected = target?.target;
  const handoff = selected?.handoff || target?.handoff;
  const project = target?.project || selected?.post.project || '';
  const selectedAgentCommand = project ? agentSelectedCommand(project) : '';
  const selectedPromptCommand = project ? agentSelectedPromptCommand(project) : '';
  const selectedClaims = selected ? claimsForContentPost(agentClaims, selected.post.project, selected.post.id, selected.post.channel) : [];
  return (
    <section className={`target-panel ${selected ? 'has-target' : 'empty-target'}`}>
      <header>
        <div>
          <h3><Flag size={16} />Next content target</h3>
          <p>{selected ? `${selected.post.channel} · ${selected.readiness}` : 'No selected target yet'}</p>
        </div>
        <div className="target-actions">
          {handoff && (
            <button className="secondary-button" onClick={() => void onCopy(handoff.inspectTargetCommand, 'content target inspect command')} type="button">
              <Clipboard size={15} />Copy inspect
            </button>
          )}
          {selectedAgentCommand && (
            <button className="secondary-button" onClick={() => void onCopy(selectedAgentCommand, 'agent selected command')} type="button">
              <Clipboard size={15} />Copy agent
            </button>
          )}
          {selected && (
            <button className="secondary-button danger" disabled={pending} onClick={() => void onClear()} type="button">
              <X size={15} />Clear
            </button>
          )}
        </div>
      </header>
      {selected ? (
        <div className="target-body">
          <strong>{selected.post.title}</strong>
          <code>{selected.post.id}</code>
          <div className="target-meta">
            <span>{selected.batch.id}</span>
            <span>{selected.post.assets.length} asset{selected.post.assets.length === 1 ? '' : 's'}</span>
            <span>SQLite target</span>
            {selected.notes && <span>{selected.notes}</span>}
          </div>
          {claimOccupancy(selectedClaims)}
          <p>{selected.handoff.agentPrompt}</p>
          <code className="agent-command">{selectedAgentCommand}</code>
          <div className="target-actions wrap">
            <button onClick={() => void onCopy(selectedAgentCommand, 'agent selected command')} type="button">Copy selected</button>
            <button onClick={() => void onCopy(selectedPromptCommand, 'agent selected prompt')} type="button">Copy prompt</button>
            <button onClick={() => void onCopy(selected.handoff.attachAssetTemplate, 'content target attach command')} type="button">Copy attach</button>
            <button onClick={() => void onCopy(selected.handoff.moveToReviewCommand, 'content target review command')} type="button">Copy review</button>
            <button onClick={() => void onCopy(selected.handoff.scheduleTemplate, 'content target schedule command')} type="button">Copy schedule</button>
          </div>
        </div>
      ) : (
        <div className="target-empty">
          <p>Choose Set next on a post so agents can inspect the same SQLite target from the CLI.</p>
          {project && <code className="agent-command">{agentSelectedCommand(project)}</code>}
        </div>
      )}
    </section>
  );
}

function claimsForContentPost(claims: AgentClaimSummary[], project: string, postId: string, channel?: string): AgentClaimSummary[] {
  return claims.filter(claim => {
    if (claim.project !== project || claim.status !== 'active' || claim.derived_state === 'expired') return false;
    if (claim.scope_type === 'content_post' && claim.target_id === postId) return true;
    return claim.scope_type === 'project_channel' && (!claim.channel || !channel || claim.channel === channel);
  });
}

function claimOccupancy(claims: AgentClaimSummary[]) {
  if (claims.length === 0) return null;
  const state = claims.some(claim => claim.derived_state === 'stale') ? 'stale' : claims.some(claim => claim.derived_state === 'idle') ? 'idle' : 'active';
  const label = claims.length === 1
    ? `${state === 'active' ? 'Claimed' : state === 'idle' ? 'Idle claim' : 'Stale claim'} by ${claims[0].agent_name}`
    : `${claims.length} active claims`;
  return (
    <p className={`target-claim-occupancy ${state}`}>
      <ShieldCheck size={14} />
      <span>{label}</span>
      {claims.length === 1 && (
        <span className="target-claim-actions">
          {claims[0].derived_state === 'stale' && <button onClick={() => { void runClaimControl('release-stale', claims[0]); }} type="button">Release stale</button>}
          <button onClick={() => { void runClaimControl('transfer', claims[0]); }} type="button">Transfer</button>
          <button onClick={() => { void runClaimControl('revoke', claims[0]); }} type="button">Revoke</button>
        </span>
      )}
    </p>
  );
}

async function runClaimControl(action: ClaimControlAction, claim: AgentClaimSummary) {
  const body = claimControlBody(action, claim);
  if (!body) return;
  await api(`/api/agent-claims/${claim.id}/${action}`, {
    body: JSON.stringify({ project: claim.project, ...body }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

function claimControlBody(action: ClaimControlAction, claim: AgentClaimSummary): { confirmWrite: true; reason?: string; toAgentName?: string } | null {
  if (action === 'release-stale') {
    if (!window.confirm(`Release stale claim held by ${claim.agent_name}?`)) return null;
    return { confirmWrite: true, reason: `Released stale ${claim.scope_type} claim ${claim.id} from the content target panel.` };
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
  return { confirmWrite: true, reason: 'Transferred from content target panel.', toAgentName: toAgentName.trim() };
}
