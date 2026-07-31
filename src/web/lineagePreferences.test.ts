import { describe, expect, it, vi } from 'vitest';
import {
  readHoverPreviewsEnabled,
  readCanvasSettingsHintDismissed,
  readLineageCanvasPresentation,
  readLineageEdgeLabelsVisible,
  readLineageEdgeWeight,
  readLineageGraphDirection,
  readLineageMinimapVisible,
  readVariationPromptAutoEdit,
  resetLineageAppearancePreferences,
  writeHoverPreviewsEnabled,
  writeCanvasSettingsHintDismissed,
  writeLineageCanvasPresentation,
  writeLineageEdgeLabelsVisible,
  writeLineageEdgeWeight,
  writeLineageGraphDirection,
  writeLineageMinimapVisible,
  writeVariationPromptAutoEdit,
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

describe('variation queue prompt editing preference', () => {
  it('defaults on, persists an explicit choice, and fails safely', () => {
    expect(readVariationPromptAutoEdit({ getItem: () => null })).toBe(true);
    expect(readVariationPromptAutoEdit({ getItem: () => 'false' })).toBe(false);
    expect(readVariationPromptAutoEdit({ getItem: () => { throw new Error('denied'); } })).toBe(true);
    const setItem = vi.fn();
    expect(writeVariationPromptAutoEdit(false, { setItem })).toBe(true);
    expect(setItem).toHaveBeenCalledWith('lineage.preferences.variation-prompt-auto-edit', 'false');
    expect(writeVariationPromptAutoEdit(true, { setItem: () => { throw new Error('denied'); } })).toBe(false);
  });
});

describe('lineage Canvas settings hint preference', () => {
  it('shows for a fresh browser and stays dismissed after the first interaction', () => {
    expect(readCanvasSettingsHintDismissed({ getItem: () => null })).toBe(false);
    expect(readCanvasSettingsHintDismissed({ getItem: () => 'true' })).toBe(true);

    const setItem = vi.fn();
    expect(writeCanvasSettingsHintDismissed({ setItem })).toBe(true);
    expect(setItem).toHaveBeenCalledWith('lineage.preferences.canvas-settings-hint-dismissed', 'true');
  });

  it('fails closed when browser storage is unavailable', () => {
    expect(readCanvasSettingsHintDismissed({ getItem: () => { throw new Error('denied'); } })).toBe(true);
    expect(writeCanvasSettingsHintDismissed({ setItem: () => { throw new Error('denied'); } })).toBe(false);
  });
});

describe('lineage canvas appearance preferences', () => {
  it('keeps compact cards and standard edges as safe defaults', () => {
    expect(readLineageCanvasPresentation({ getItem: () => null })).toBe('compact');
    expect(readLineageCanvasPresentation({ getItem: () => 'unexpected' })).toBe('compact');
    expect(readLineageEdgeWeight({ getItem: () => null })).toBe('standard');
    expect(readLineageEdgeWeight({ getItem: () => 'unexpected' })).toBe('standard');
    expect(readLineageEdgeLabelsVisible({ getItem: () => null })).toBe(true);
    expect(readLineageMinimapVisible({ getItem: () => null })).toBe(true);
    expect(readLineageGraphDirection('compact', { getItem: () => null })).toBe('LR');
    expect(readLineageGraphDirection('portrait', { getItem: () => 'unexpected' })).toBe('LR');
  });

  it('reads and writes supported card and edge choices', () => {
    expect(readLineageCanvasPresentation({ getItem: () => 'portrait' })).toBe('portrait');
    expect(readLineageEdgeWeight({ getItem: () => 'fine' })).toBe('fine');
    expect(readLineageEdgeWeight({ getItem: () => 'bold' })).toBe('bold');
    expect(readLineageEdgeLabelsVisible({ getItem: () => 'false' })).toBe(false);
    expect(readLineageMinimapVisible({ getItem: () => 'false' })).toBe(false);
    expect(readLineageGraphDirection('compact', { getItem: () => 'TB' })).toBe('TB');
    expect(readLineageGraphDirection('portrait', { getItem: () => 'RL' })).toBe('RL');

    const setItem = vi.fn();
    expect(writeLineageCanvasPresentation('portrait', { setItem })).toBe(true);
    expect(writeLineageEdgeWeight('bold', { setItem })).toBe(true);
    expect(writeLineageEdgeLabelsVisible(false, { setItem })).toBe(true);
    expect(writeLineageMinimapVisible(false, { setItem })).toBe(true);
    expect(writeLineageGraphDirection('compact', 'BT', { setItem })).toBe(true);
    expect(writeLineageGraphDirection('portrait', 'TB', { setItem })).toBe(true);
    expect(setItem).toHaveBeenNthCalledWith(1, 'lineage.preferences.canvas-presentation', 'portrait');
    expect(setItem).toHaveBeenNthCalledWith(2, 'lineage.preferences.edge-weight', 'bold');
    expect(setItem).toHaveBeenNthCalledWith(3, 'lineage.preferences.edge-labels', 'false');
    expect(setItem).toHaveBeenNthCalledWith(4, 'lineage.preferences.minimap-visible', 'false');
    expect(setItem).toHaveBeenNthCalledWith(5, 'lineage.preferences.compact-direction', 'BT');
    expect(setItem).toHaveBeenNthCalledWith(6, 'lineage.preferences.portrait-direction', 'TB');
  });

  it('uses safe defaults and returns false when storage access fails', () => {
    const deniedReader = { getItem: () => { throw new Error('denied'); } };
    const deniedWriter = { setItem: () => { throw new Error('denied'); } };
    expect(readLineageCanvasPresentation(deniedReader)).toBe('compact');
    expect(readLineageEdgeWeight(deniedReader)).toBe('standard');
    expect(readLineageEdgeLabelsVisible(deniedReader)).toBe(true);
    expect(readLineageMinimapVisible(deniedReader)).toBe(true);
    expect(readLineageGraphDirection('compact', deniedReader)).toBe('LR');
    expect(writeLineageCanvasPresentation('portrait', deniedWriter)).toBe(false);
    expect(writeLineageEdgeWeight('bold', deniedWriter)).toBe(false);
    expect(writeLineageEdgeLabelsVisible(false, deniedWriter)).toBe(false);
    expect(writeLineageMinimapVisible(false, deniedWriter)).toBe(false);
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
      ['lineage.preferences.minimap-visible', 'true'],
      ['lineage.preferences.variation-prompt-auto-edit', 'true'],
    ]);
  });
});
