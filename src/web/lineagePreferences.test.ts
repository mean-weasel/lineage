import { describe, expect, it, vi } from 'vitest';
import { readHoverPreviewsEnabled, writeHoverPreviewsEnabled } from './lineagePreferences';

describe('lineage hover preview preference', () => {
  it('defaults to enabled and remembers an explicit disabled value', () => {
    expect(readHoverPreviewsEnabled({ getItem: () => null })).toBe(true);
    expect(readHoverPreviewsEnabled({ getItem: () => 'false' })).toBe(false);
  });

  it('writes the preference and fails closed without throwing when storage is unavailable', () => {
    const setItem = vi.fn();
    expect(writeHoverPreviewsEnabled(false, { setItem })).toBe(true);
    expect(setItem).toHaveBeenCalledWith('lineage.preferences.hover-previews', 'false');
    expect(writeHoverPreviewsEnabled(true, { setItem: () => { throw new Error('denied'); } })).toBe(false);
  });
});
