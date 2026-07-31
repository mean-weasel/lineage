import { useEffect, useRef, useState, type FormEvent } from 'react';
import { GitBranch, RefreshCcw, Sparkles } from 'lucide-react';
import type { LineageNode } from '../../shared/types';
import './LineageVariationPromptDialog.css';

export type VariationPromptMode = 'branch' | 'reroll';

export function LineageVariationPromptDialog({
  initialPrompt = '',
  mode,
  node,
  onClose,
  onSubmit,
}: {
  initialPrompt?: string;
  mode: VariationPromptMode;
  node: LineageNode;
  onClose: () => void;
  onSubmit: (prompt: string) => Promise<void> | void;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isBranch = mode === 'branch';
  const title = isBranch ? 'Describe the next branch' : 'Describe the re-roll';
  const action = isBranch ? 'Queue branch' : 'Queue re-roll';
  const trimmed = prompt.trim();

  useEffect(() => {
    textareaRef.current?.focus();
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [busy, onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await onSubmit(trimmed);
    } finally {
      setBusy(false);
    }
  }

  const Icon = isBranch ? GitBranch : RefreshCcw;
  return (
    <div className="lineage-prompt-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <form aria-labelledby="lineage-prompt-title" aria-modal="true" className="lineage-prompt-dialog" onSubmit={submit} role="dialog">
        <header>
          <span aria-hidden="true" className={`lineage-prompt-icon ${mode}`}><Icon size={22} /></span>
          <div>
            <span className="lineage-prompt-eyebrow">{isBranch ? 'New variation' : 'New attempt'}</span>
            <h2 id="lineage-prompt-title">{title}</h2>
            <p>{node.title}</p>
          </div>
          <button aria-label="Close prompt" className="lineage-prompt-close" disabled={busy} onClick={onClose} type="button">×</button>
        </header>
        <label className="lineage-prompt-field">
          <span>What should Codex change?</span>
          <textarea
            maxLength={1600}
            onChange={event => setPrompt(event.target.value)}
            placeholder={isBranch
              ? 'e.g. Restyle this as a crisp Swiss editorial poster with a tighter grid and warmer red.'
              : 'e.g. Keep the composition exactly, but fix the distorted headline and soften the shadows.'}
            ref={textareaRef}
            rows={6}
            value={prompt}
          />
          <small><span>{prompt.length}/1600</span> Be exact—this prompt travels with the node.</small>
        </label>
        <div className="lineage-prompt-destination">
          <Sparkles aria-hidden="true" size={18} />
          <div>
            <strong>Saved to Canvas · ready for Codex</strong>
            <span>The prompt remains visible here and is included in the durable agent task and generation handoff.</span>
          </div>
        </div>
        <footer>
          <button disabled={busy} onClick={onClose} type="button">Cancel</button>
          <button className="primary-button" disabled={!trimmed || busy} type="submit">{busy ? 'Saving…' : action}</button>
        </footer>
      </form>
    </div>
  );
}
