import type { LineageCanvasPresentation } from './components/LineageAssetNode';
import type { LineageGraphDirection } from './components/lineageGraph';

const hoverPreviewsKey = 'lineage.preferences.hover-previews';
const canvasPresentationKey = 'lineage.preferences.canvas-presentation';
const edgeWeightKey = 'lineage.preferences.edge-weight';
const edgeLabelsKey = 'lineage.preferences.edge-labels';
const compactDirectionKey = 'lineage.preferences.compact-direction';
const portraitDirectionKey = 'lineage.preferences.portrait-direction';

type PreferenceReader = Pick<Storage, 'getItem'>;
type PreferenceWriter = Pick<Storage, 'setItem'>;

export type LineageEdgeWeight = 'fine' | 'standard' | 'bold';
const lineageAppearanceDefaults = {
  canvasPresentation: 'compact',
  compactDirection: 'LR',
  edgeLabelsVisible: true,
  edgeWeight: 'standard',
  hoverPreviewsEnabled: true,
  portraitDirection: 'LR',
} as const;

export function readHoverPreviewsEnabled(storage?: PreferenceReader): boolean {
  try {
    return (storage || window.localStorage).getItem(hoverPreviewsKey) !== 'false';
  } catch {
    return true;
  }
}

export function writeHoverPreviewsEnabled(enabled: boolean, storage?: PreferenceWriter): boolean {
  try {
    (storage || window.localStorage).setItem(hoverPreviewsKey, String(enabled));
    return true;
  } catch {
    return false;
  }
}

export function readLineageCanvasPresentation(storage?: PreferenceReader): LineageCanvasPresentation {
  try {
    return (storage || window.localStorage).getItem(canvasPresentationKey) === 'portrait' ? 'portrait' : 'compact';
  } catch {
    return 'compact';
  }
}

export function writeLineageCanvasPresentation(presentation: LineageCanvasPresentation, storage?: PreferenceWriter): boolean {
  try {
    (storage || window.localStorage).setItem(canvasPresentationKey, presentation);
    return true;
  } catch {
    return false;
  }
}

export function readLineageEdgeWeight(storage?: PreferenceReader): LineageEdgeWeight {
  try {
    const stored = (storage || window.localStorage).getItem(edgeWeightKey);
    return stored === 'fine' || stored === 'bold' ? stored : 'standard';
  } catch {
    return 'standard';
  }
}

export function writeLineageEdgeWeight(weight: LineageEdgeWeight, storage?: PreferenceWriter): boolean {
  try {
    (storage || window.localStorage).setItem(edgeWeightKey, weight);
    return true;
  } catch {
    return false;
  }
}

export function readLineageEdgeLabelsVisible(storage?: PreferenceReader): boolean {
  try {
    return (storage || window.localStorage).getItem(edgeLabelsKey) !== 'false';
  } catch {
    return lineageAppearanceDefaults.edgeLabelsVisible;
  }
}

export function writeLineageEdgeLabelsVisible(visible: boolean, storage?: PreferenceWriter): boolean {
  try {
    (storage || window.localStorage).setItem(edgeLabelsKey, String(visible));
    return true;
  } catch {
    return false;
  }
}

function directionKey(presentation: LineageCanvasPresentation): string {
  return presentation === 'portrait' ? portraitDirectionKey : compactDirectionKey;
}

export function readLineageGraphDirection(
  presentation: LineageCanvasPresentation,
  storage?: PreferenceReader,
): LineageGraphDirection {
  try {
    const stored = (storage || window.localStorage).getItem(directionKey(presentation));
    return stored === 'TB' || stored === 'RL' || stored === 'BT' ? stored : 'LR';
  } catch {
    return lineageAppearanceDefaults.compactDirection;
  }
}

export function writeLineageGraphDirection(
  presentation: LineageCanvasPresentation,
  direction: LineageGraphDirection,
  storage?: PreferenceWriter,
): boolean {
  try {
    (storage || window.localStorage).setItem(directionKey(presentation), direction);
    return true;
  } catch {
    return false;
  }
}

export function resetLineageAppearancePreferences(storage?: PreferenceWriter): boolean {
  const writer = storage || window.localStorage;
  try {
    writer.setItem(canvasPresentationKey, lineageAppearanceDefaults.canvasPresentation);
    writer.setItem(compactDirectionKey, lineageAppearanceDefaults.compactDirection);
    writer.setItem(portraitDirectionKey, lineageAppearanceDefaults.portraitDirection);
    writer.setItem(edgeWeightKey, lineageAppearanceDefaults.edgeWeight);
    writer.setItem(edgeLabelsKey, String(lineageAppearanceDefaults.edgeLabelsVisible));
    writer.setItem(hoverPreviewsKey, String(lineageAppearanceDefaults.hoverPreviewsEnabled));
    return true;
  } catch {
    return false;
  }
}
