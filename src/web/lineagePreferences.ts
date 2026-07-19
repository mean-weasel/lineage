const hoverPreviewsKey = 'lineage.preferences.hover-previews';

type PreferenceReader = Pick<Storage, 'getItem'>;
type PreferenceWriter = Pick<Storage, 'setItem'>;

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
