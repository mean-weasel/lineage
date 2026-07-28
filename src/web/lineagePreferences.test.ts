import { describe, expect, it, vi } from 'vitest';
import {
  readHoverPreviewsEnabled,
  readLineageCanvasPresentation,
  readLineageEdgeWeight,
  writeHoverPreviewsEnabled,
  writeLineageCanvasPresentation,
  writeLineageEdgeWeight,
} from './lineagePreferences';

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

describe('lineage canvas appearance preferences', () => {
  it('keeps compact cards and standard edges as safe defaults', () => {
    expect(readLineageCanvasPresentation({ getItem: () => null })).toBe('compact');
    expect(readLineageCanvasPresentation({ getItem: () => 'unexpected' })).toBe('compact');
    expect(readLineageEdgeWeight({ getItem: () => null })).toBe('standard');
    expect(readLineageEdgeWeight({ getItem: () => 'unexpected' })).toBe('standard');
  });

  it('reads and writes supported card and edge choices', () => {
    expect(readLineageCanvasPresentation({ getItem: () => 'portrait' })).toBe('portrait');
    expect(readLineageEdgeWeight({ getItem: () => 'fine' })).toBe('fine');
    expect(readLineageEdgeWeight({ getItem: () => 'bold' })).toBe('bold');

    const setItem = vi.fn();
    expect(writeLineageCanvasPresentation('portrait', { setItem })).toBe(true);
    expect(writeLineageEdgeWeight('bold', { setItem })).toBe(true);
    expect(setItem).toHaveBeenNthCalledWith(1, 'lineage.preferences.canvas-presentation', 'portrait');
    expect(setItem).toHaveBeenNthCalledWith(2, 'lineage.preferences.edge-weight', 'bold');
  });

  it('uses safe defaults and returns false when storage access fails', () => {
    const deniedReader = { getItem: () => { throw new Error('denied'); } };
    const deniedWriter = { setItem: () => { throw new Error('denied'); } };
    expect(readLineageCanvasPresentation(deniedReader)).toBe('compact');
    expect(readLineageEdgeWeight(deniedReader)).toBe('standard');
    expect(writeLineageCanvasPresentation('portrait', deniedWriter)).toBe(false);
    expect(writeLineageEdgeWeight('bold', deniedWriter)).toBe(false);
  });
});
