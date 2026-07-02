import { useEffect } from 'react';

export function useEscapeClear(enabled: boolean, onClear: () => void) {
  useEffect(() => {
    function clearOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && enabled) onClear();
    }

    window.addEventListener('keydown', clearOnEscape);
    return () => window.removeEventListener('keydown', clearOnEscape);
  }, [enabled, onClear]);
}
