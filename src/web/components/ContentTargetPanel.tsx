import { Clipboard, Flag, X } from 'lucide-react';
import type { ContentTargetSnapshot } from '../../shared/types';

function agentSelectedCommand(project: string): string {
  return `npm --silent run studio:cli -- agent selected --project ${project}`;
}

function agentSelectedPromptCommand(project: string): string {
  return `npm --silent run studio:cli -- agent work on the selected target for ${project} --project ${project}`;
}

interface ContentTargetPanelProps {
  onClear: () => Promise<void>;
  onCopy: (text: string, label: string) => Promise<void>;
  pending: boolean;
  target: ContentTargetSnapshot | null;
}

export function ContentTargetPanel({ onClear, onCopy, pending, target }: ContentTargetPanelProps) {
  const selected = target?.target;
  const handoff = selected?.handoff || target?.handoff;
  const project = target?.project || selected?.post.project || '';
  const selectedAgentCommand = project ? agentSelectedCommand(project) : '';
  const selectedPromptCommand = project ? agentSelectedPromptCommand(project) : '';
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
