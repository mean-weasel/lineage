export const CONTEXT_PANEL_OPEN_KEY = 'lineage.navigation.context-open.v1';

export function readContextPanelOpen(storage: Pick<Storage, 'getItem'> | null = browserStorage()): boolean {
  if (!storage) return true;
  try {
    const stored = storage.getItem(CONTEXT_PANEL_OPEN_KEY);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

export function writeContextPanelOpen(
  open: boolean,
  storage: Pick<Storage, 'setItem'> | null = browserStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(CONTEXT_PANEL_OPEN_KEY, String(open));
  } catch {
    // Navigation remains usable when browser storage is unavailable.
  }
}

function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}
