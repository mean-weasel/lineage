import type { LineageBriefResponse, LineageNode } from '../../shared/types';
import { api } from '../api';
import { copyToClipboard } from '../clipboard';

interface AgentClaimCreateResponse {
  claim: {
    id: string;
    target_id: string;
    expires_at: string;
  };
  claim_token: string;
}

export function LineageHandoffPanel({
  brief,
  nextBase,
  onRefreshBrief,
  onToast,
  project,
  rerollTargets = [],
  rootAssetId,
}: {
  brief: LineageBriefResponse | null;
  nextBase?: LineageNode;
  onRefreshBrief: () => void;
  onToast: (type: 'ok' | 'error', message: string) => void;
  project: string;
  rerollTargets?: LineageNode[];
  rootAssetId: string;
}) {
  const nextCommand = brief?.handoff?.next_command || `npx @mean-weasel/lineage next --project ${project} --root ${rootAssetId} --json`;
  const rerollCommand = `npx @mean-weasel/lineage reroll list --project ${project} --root ${rootAssetId} --json`;
  const nextBaseLabel = nextBase ? `${nextBase.title} (${nextBase.asset_id})` : 'No asset chosen; CLI will report candidates or fallback.';
  const baseItems = [
    { label: 'next command', text: nextCommand },
    nextBase && { label: 'variation source', text: nextBase.asset_id },
  ].filter((item): item is { label: string; text: string } => Boolean(item));
  const briefItems = [
    brief?.handoff?.inspect_command && { label: 'inspect command', text: brief.handoff.inspect_command },
    brief?.handoff?.link_child_command && { label: 'link-child command', text: brief.handoff.link_child_command },
    brief?.brief?.prompt && { label: 'agent brief', text: brief.brief.prompt },
  ].filter((item): item is { label: string; text: string } => Boolean(item));
  const fullBrief = briefItems.map(item => `${item.label}:\n${item.text}`).join('\n\n');
  const copyLabel = (label: string) => label === 'variation source' ? 'Copy source' : label === 'agent brief' ? 'Copy prompt' : label === 'link-child command' ? 'Copy link command' : 'Copy command';
  const claimTargetId = lineageWorkspaceClaimTargetId(project, rootAssetId);

  async function copy(text: string, label: string) {
    try {
      await copyToClipboard(text);
      onToast('ok', `Copied ${label}`);
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    }
  }

  async function copyClaimAwareHandoff() {
    try {
      const claim = await api<AgentClaimCreateResponse>('/api/agent-claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: 'Copied Lineage handoff',
          channel: nextBase?.channel,
          project,
          scopeType: 'lineage_workspace',
          targetId: claimTargetId,
          targetTitle: nextBase ? `${nextBase.title} lineage` : `Lineage workspace ${rootAssetId}`,
          ttl: '20m',
        }),
      });
      await copyToClipboard(claimAwareHandoffPacket(claim.claim_token, nextCommand, brief, fullBrief));
      onToast('ok', `Copied claim-aware handoff for ${claim.claim.id}`);
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section className="lineage-handoff-panel" data-testid="lineage-handoff-panel">
      <h3>Agent handoff</h3>
      <div className={`lineage-handoff-base ${nextBase && !nextBase.is_latest ? 'branch' : ''}`}>
        <span>{nextBase ? 'Agent will evolve' : 'Choose a variation source'}</span>
        <strong>{nextBaseLabel}</strong>
        {nextBase && <small>{[nextBase.channel, nextBase.status, nextBase.review_state].filter(Boolean).join(' / ')}</small>}
        {nextBase && !nextBase.is_latest && <p>Branch from here: this asset is not a latest leaf.</p>}
      </div>
      {baseItems.map(item => (
        <div className="lineage-copy-row" key={item.label}>
          <code>{item.text}</code>
          <button aria-label={`Copy ${item.label}`} onClick={() => void copy(item.text, item.label)}>{copyLabel(item.label)}</button>
        </div>
      ))}
      {rerollTargets.length > 0 && (
        <div className="lineage-brief-group">
          <div className="lineage-brief-head">
            <h4>Re-roll queue</h4>
            <button aria-label="Copy re-roll queue handoff" onClick={() => void copy(rerollHandoffPacket(rerollCommand, rerollTargets), 're-roll queue')}>Copy queue</button>
          </div>
          <p>Use this for repair work. Import outputs with reroll import; do not link them as lineage children.</p>
          <div className="lineage-copy-row">
            <code>{rerollCommand}</code>
            <button aria-label="Copy reroll list command" onClick={() => void copy(rerollCommand, 'reroll list command')}>Copy command</button>
          </div>
          {rerollTargets.map(target => (
            <div className="lineage-copy-row" key={target.asset_id}>
              <code>{target.asset_id}{target.reroll_request?.notes ? `: ${target.reroll_request.notes}` : ''}</code>
              <button aria-label={`Copy re-roll target ${target.asset_id}`} onClick={() => void copy(target.asset_id, 're-roll target')}>Copy target</button>
            </div>
          ))}
        </div>
      )}
      {briefItems.length > 0 && (
        <div className="lineage-brief-group">
          <div className="lineage-brief-head">
            <h4>Generated brief</h4>
            <button aria-label="Copy full generated brief" onClick={() => void copy(fullBrief, 'full brief')}>Copy all</button>
          </div>
          <p>Use this bundle when asking an agent to continue from the chosen asset.</p>
          <button aria-label="Copy claim-aware handoff" className="lineage-claim-handoff-button" onClick={() => copyClaimAwareHandoff()}>
            Copy claim handoff
          </button>
          <details>
            <summary>Commands and prompt</summary>
            {briefItems.map(item => (
              <div className="lineage-copy-row" key={item.label}>
                <code>{item.text}</code>
                <button aria-label={`Copy ${item.label}`} onClick={() => void copy(item.text, item.label)}>{copyLabel(item.label)}</button>
              </div>
            ))}
          </details>
        </div>
      )}
      <button aria-label={briefItems.length > 0 ? 'Regenerate agent brief' : 'Generate agent brief'} onClick={onRefreshBrief}>
        {briefItems.length > 0 ? 'Regenerate brief' : 'Generate brief'}
      </button>
    </section>
  );
}

function rerollHandoffPacket(rerollCommand: string, targets: LineageNode[]): string {
  return [
    rerollCommand,
    'For each pending target, ask for or use a target-specific repair prompt.',
    'Run reroll plan for one target at a time, generate one file under .asset-scratch, then run reroll import.',
    'Do not use link-child for re-roll outputs.',
    ...targets.map(target => `Target ${target.asset_id}: ${target.title}${target.reroll_request?.notes ? ` (${target.reroll_request.notes})` : ''}`),
  ].join('\n');
}

function lineageWorkspaceClaimTargetId(project: string, rootAssetId: string): string {
  return `${project}:lineage-workspace:${rootAssetId}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function dbFlagFromCommand(command: string): string {
  const match = /\s--db\s+('[^']*(?:'\\''[^']*)*'|"[^"]*"|\S+)/.exec(command);
  return match ? ` --db ${match[1]}` : '';
}

function withClaimToken(command: string): string {
  if (command.includes('--claim-token')) return command;
  if (/\s--json$/.test(command)) return command.replace(/\s--json$/, ' --claim-token "$LINEAGE_CLAIM_TOKEN" --json');
  return `${command} --claim-token "$LINEAGE_CLAIM_TOKEN"`;
}

function claimAwareHandoffPacket(claimToken: string, nextCommand: string, brief: LineageBriefResponse | null, fullBrief: string): string {
  const dbFlag = dbFlagFromCommand(brief?.handoff?.link_child_command || brief?.handoff?.next_command || nextCommand);
  const heartbeatCommand = `npx @mean-weasel/lineage agent heartbeat --claim-token "$LINEAGE_CLAIM_TOKEN"${dbFlag} --json`;
  return [
    `export LINEAGE_CLAIM_TOKEN=${shellQuote(claimToken)}`,
    heartbeatCommand,
    nextCommand,
    brief?.handoff?.inspect_command,
    brief?.handoff?.link_child_command ? withClaimToken(brief.handoff.link_child_command) : undefined,
    fullBrief ? `Agent brief:\n${fullBrief}` : undefined,
  ].filter((line): line is string => Boolean(line)).join('\n\n');
}
