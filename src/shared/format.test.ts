import { describe, expect, it } from 'vitest';
import { formatBytes, formatDate, slug } from './format';

describe('format helpers', () => {
  it('formats byte counts compactly', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(44)).toBe('44 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });

  it('passes through invalid dates and formats valid dates', () => {
    expect(formatDate()).toBe('Not synced');
    expect(formatDate('not-a-date')).toBe('not-a-date');
    expect(formatDate('2026-06-21T12:30:00.000Z')).toContain('Jun');
  });

  it('creates kebab-case slugs', () => {
    expect(slug('Upload. Demo. Export.')).toBe('upload-demo-export');
  });
});
