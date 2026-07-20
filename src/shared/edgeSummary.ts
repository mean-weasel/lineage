export const edgeSummaryWordLimit = 2 as const;

export type EdgeSummaryValidationCode = 'not_text' | 'required' | 'too_many_words';

export class EdgeSummaryValidationError extends Error {
  constructor(
    public readonly code: EdgeSummaryValidationCode,
    message: string,
  ) {
    super(message);
    this.name = 'EdgeSummaryValidationError';
  }
}

export function normalizeEdgeSummary(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new EdgeSummaryValidationError('not_text', 'Edge summary must be text');
  const words = value.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return undefined;
  if (words.length > edgeSummaryWordLimit) {
    throw new EdgeSummaryValidationError('too_many_words', `Edge summary must contain at most ${edgeSummaryWordLimit} words`);
  }
  return words.join(' ');
}

export function requireEdgeSummary(value: unknown): string {
  const summary = normalizeEdgeSummary(value);
  if (!summary) throw new EdgeSummaryValidationError('required', 'Edge summary is required');
  return summary;
}
