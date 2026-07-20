import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react';
import { EdgeSummaryValidationError, normalizeEdgeSummary } from '../../shared/edgeSummary';
import type { LineageEdge } from '../../shared/types';
import './LineageEdgeSummaryDialog.css';

export type EdgeSummaryEditAction = 'set' | 'clear';

export function LineageEdgeSummaryDialog({
  childTitle,
  edge,
  onClose,
  onSubmit,
  parentTitle,
  returnFocus,
}: {
  childTitle: string;
  edge: LineageEdge;
  onClose: () => void;
  onSubmit: (action: EdgeSummaryEditAction, summary?: string) => Promise<void>;
  parentTitle: string;
  returnFocus: HTMLElement | SVGElement | null;
}) {
  const [value, setValue] = useState(edge.summary || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const normalized = useMemo(() => normalizedInput(value), [value]);
  const wordCount = value.trim() ? value.trim().split(/\s+/u).length : 0;
  const unchanged = normalized.value === edge.summary;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    inputRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      returnFocus?.focus();
    };
  }, [returnFocus]);

  useEffect(() => {
    setValue(edge.summary || '');
  }, [edge.id, edge.summary, edge.summary_updated_at]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'Tab') trapFocus(event, dialogRef);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, submitting]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!normalized.value || normalized.error || unchanged) return;
    await run(() => onSubmit('set', normalized.value));
  }

  async function clear() {
    if (!edge.summary) return;
    await run(() => onSubmit('clear'));
  }

  async function run(action: () => Promise<void>) {
    setError('');
    setSubmitting(true);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  }

  const guidance = normalized.error
    ? normalized.error
    : wordCount === 0
      ? edge.summary ? 'Blank input is not a clear action. Use Clear label.' : 'Enter one or two words.'
      : `${wordCount} of 2 words`;

  return (
    <div className="lineage-edge-summary-backdrop" onClick={() => { if (!submitting) onClose(); }}>
      <section
        aria-describedby="lineage-edge-summary-guidance lineage-edge-summary-provenance"
        aria-labelledby="lineage-edge-summary-title"
        aria-modal="true"
        className="lineage-edge-summary-dialog"
        onClick={event => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <h3 id="lineage-edge-summary-title">Edit edge label</h3>
            <p>{parentTitle} <span aria-hidden="true">→</span> {childTitle}</p>
          </div>
          <button disabled={submitting} onClick={onClose} type="button">Close</button>
        </header>
        <form onSubmit={event => void save(event)}>
          <label htmlFor="lineage-edge-summary-input">Edge label</label>
          <input
            aria-invalid={Boolean(normalized.error)}
            autoComplete="off"
            disabled={submitting}
            id="lineage-edge-summary-input"
            onChange={event => { setValue(event.target.value); setError(''); }}
            placeholder="Two words max"
            ref={inputRef}
            value={value}
          />
          <p className={normalized.error ? 'invalid' : ''} id="lineage-edge-summary-guidance">{guidance}</p>
          <p id="lineage-edge-summary-provenance">{provenanceLabel(edge)}</p>
          {error && <p className="lineage-edge-summary-error" role="alert">{error}</p>}
          <div className="lineage-edge-summary-actions">
            <button disabled={submitting || !normalized.value || Boolean(normalized.error) || unchanged} type="submit">
              {submitting ? 'Saving…' : 'Save label'}
            </button>
            {edge.summary && <button className="clear" disabled={submitting} onClick={() => void clear()} type="button">Clear label</button>}
            <button disabled={submitting} onClick={onClose} type="button">Cancel</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function normalizedInput(value: string): { value?: string; error?: string } {
  try {
    return { value: normalizeEdgeSummary(value) };
  } catch (error) {
    if (error instanceof EdgeSummaryValidationError) return { error: error.message };
    throw error;
  }
}

function provenanceLabel(edge: LineageEdge): string {
  if (!edge.summary) return edge.summary_updated_by === 'human' ? 'Label cleared by a person' : 'This edge is unlabeled';
  if (edge.summary_created_by === 'agent' && edge.summary_updated_by === 'human') return 'Agent-generated · Human-edited';
  if (edge.summary_updated_by === 'agent') return 'Agent-generated';
  if (edge.summary_updated_by === 'human') return 'Human-authored';
  return 'Existing edge label';
}

function trapFocus(event: KeyboardEvent, dialogRef: RefObject<HTMLElement>) {
  const dialog = dialogRef.current;
  if (!dialog) return;
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(element => !element.hidden);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
