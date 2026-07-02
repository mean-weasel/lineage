import type { LineageBriefResponse, LineageNode } from '../../shared/types';
import { copyToClipboard } from '../clipboard';

export function LineageHandoffPanel({
  brief,
  nextBase,
  onRefreshBrief,
  onToast,
  project,
  rootAssetId,
}: {
  brief: LineageBriefResponse | null;
  nextBase?: LineageNode;
  onRefreshBrief: () => void;
  onToast: (type: 'ok' | 'error', message: string) => void;
  project: string;
  rootAssetId: string;
}) {
  const nextCommand = `npx lineage lineage next --project ${project} --root ${rootAssetId} --json`;
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

  async function copy(text: string, label: string) {
    try {
      await copyToClipboard(text);
      onToast('ok', `Copied ${label}`);
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
      {briefItems.length > 0 && (
        <div className="lineage-brief-group">
          <div className="lineage-brief-head">
            <h4>Generated brief</h4>
            <button aria-label="Copy full generated brief" onClick={() => void copy(fullBrief, 'full brief')}>Copy all</button>
          </div>
          <p>Use this bundle when asking an agent to continue from the chosen asset.</p>
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
