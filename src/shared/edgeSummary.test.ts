import { describe, expect, it } from 'vitest';
import {
  EdgeSummaryValidationError,
  edgeSummaryWordLimit,
  normalizeEdgeSummary,
  requireEdgeSummary,
} from './edgeSummary';

function validationCode(action: () => unknown): string | undefined {
  try {
    action();
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(EdgeSummaryValidationError);
    return (error as EdgeSummaryValidationError).code;
  }
}

describe('edge summary validation', () => {
  it('normalizes one- and two-word summaries', () => {
    expect(edgeSummaryWordLimit).toBe(2);
    expect(requireEdgeSummary('Cleaner')).toBe('Cleaner');
    expect(requireEdgeSummary('  Cleaner\n type  ')).toBe('Cleaner type');
    expect(requireEdgeSummary('Cleaner\u00a0type')).toBe('Cleaner type');
    expect(requireEdgeSummary('\tCleaner\r\ntype\u2003')).toBe('Cleaner type');
    expect(requireEdgeSummary('High-contrast')).toBe('High-contrast');
    expect(requireEdgeSummary('before/after')).toBe('before/after');
    expect(requireEdgeSummary('更清晰')).toBe('更清晰');
  });

  it('allows a missing optional summary for legacy and human-cleared edges', () => {
    expect(normalizeEdgeSummary(undefined)).toBeUndefined();
    expect(normalizeEdgeSummary(null)).toBeUndefined();
    expect(normalizeEdgeSummary('   ')).toBeUndefined();
  });

  it('rejects missing agent summaries, non-text values, and more than two words', () => {
    for (const missing of [undefined, null, '', ' \n\t ']) {
      expect(validationCode(() => requireEdgeSummary(missing))).toBe('required');
    }
    for (const nonText of [42, true, ['Cleaner', 'type'], { summary: 'Cleaner type' }]) {
      expect(validationCode(() => requireEdgeSummary(nonText))).toBe('not_text');
    }
    expect(validationCode(() => requireEdgeSummary('Much cleaner type'))).toBe('too_many_words');
    expect(validationCode(() => requireEdgeSummary('Much\u00a0cleaner\u2003type'))).toBe('too_many_words');
  });
});
