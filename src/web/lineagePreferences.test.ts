import { describe, expect, it, vi } from 'vitest';
import {
  readHoverPreviewsEnabled,
  readLineageCanvasPresentation,
  readLineageEdgeLabelsVisible,
  readLineageEdgeWeight,
  readLineageGraphDirection,
  resetLineageAppearancePreferences,
  writeHoverPreviewsEnabled,
  writeLineageCanvasPresentation,
  writeLineageEdgeLabelsVisible,
  writeLineageEdgeWeight,
  writeLineageGraphDirection,
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
    expect(readLineageEdgeLabelsVisible({ getItem: () => null })).toBe(true);
    expect(readLineageGraphDirection('compact', { getItem: () => null })).toBe('LR');
    expect(readLineageGraphDirection('portrait', { getItem: () => 'unexpected' })).toBe('LR');
  });

  it('reads and writes supported card and edge choices', () => {
    expect(readLineageCanvasPresentation({ getItem: () => 'portrait' })).toBe('portrait');
    expect(readLineageEdgeWeight({ getItem: () => 'fine' })).toBe('fine');
    expect(readLineageEdgeWeight({ getItem: () => 'bold' })).toBe('bold');
    expect(readLineageEdgeLabelsVisible({ getItem: () => 'false' })).toBe(false);
    expect(readLineageGraphDirection('compact', { getItem: () => 'TB' })).toBe('TB');
    expect(readLineageGraphDirection('portrait', { getItem: () => 'RL' })).toBe('RL');

    const setItem = vi.fn();
    expect(writeLineageCanvasPresentation('portrait', { setItem })).toBe(true);
    expect(writeLineageEdgeWeight('bold', { setItem })).toBe(true);
    expect(writeLineageEdgeLabelsVisible(false, { setItem })).toBe(true);
    expect(writeLineageGraphDirection('compact', 'BT', { setItem })).toBe(true);
    expect(writeLineageGraphDirection('portrait', 'TB', { setItem })).toBe(true);
    expect(setItem).toHaveBeenNthCalledWith(1, 'lineage.preferences.canvas-presentation', 'portrait');
    expect(setItem).toHaveBeenNthCalledWith(2, 'lineage.preferences.edge-weight', 'bold');
    expect(setItem).toHaveBeenNthCalledWith(3, 'lineage.preferences.edge-labels', 'false');
    expect(setItem).toHaveBeenNthCalledWith(4, 'lineage.preferences.compact-direction', 'BT');
    expect(setItem).toHaveBeenNthCalledWith(5, 'lineage.preferences.portrait-direction', 'TB');
  });

  it('uses safe defaults and returns false when storage access fails', () => {
    const deniedReader = { getItem: () => { throw new Error('denied'); } };
    const deniedWriter = { setItem: () => { throw new Error('denied'); } };
    expect(readLineageCanvasPresentation(deniedReader)).toBe('compact');
    expect(readLineageEdgeWeight(deniedReader)).toBe('standard');
    expect(readLineageEdgeLabelsVisible(deniedReader)).toBe(true);
    expect(readLineageGraphDirection('compact', deniedReader)).toBe('LR');
    expect(writeLineageCanvasPresentation('portrait', deniedWriter)).toBe(false);
    expect(writeLineageEdgeWeight('bold', deniedWriter)).toBe(false);
    expect(writeLineageEdgeLabelsVisible(false, deniedWriter)).toBe(false);
    expect(writeLineageGraphDirection('portrait', 'BT', deniedWriter)).toBe(false);
    expect(resetLineageAppearancePreferences(deniedWriter)).toBe(false);
  });

  it('resets every appearance preference to its existing default', () => {
    const setItem = vi.fn();
    expect(resetLineageAppearancePreferences({ setItem })).toBe(true);
    expect(setItem.mock.calls).toEqual([
      ['lineage.preferences.canvas-presentation', 'compact'],
      ['lineage.preferences.compact-direction', 'LR'],
      ['lineage.preferences.portrait-direction', 'LR'],
      ['lineage.preferences.edge-weight', 'standard'],
      ['lineage.preferences.edge-labels', 'true'],
      ['lineage.preferences.hover-previews', 'true'],
    ]);
  });
});
