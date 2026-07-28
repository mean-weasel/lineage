import type { LineageCanvasPresentation } from './components/LineageAssetNode';

const hoverPreviewsKey = 'lineage.preferences.hover-previews';
const canvasPresentationKey = 'lineage.preferences.canvas-presentation';
const edgeWeightKey = 'lineage.preferences.edge-weight';

type PreferenceReader = Pick<Storage, 'getItem'>;
type PreferenceWriter = Pick<Storage, 'setItem'>;

export type LineageEdgeWeight = 'fine' | 'standard' | 'bold';

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
