// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  CONTEXT_PANEL_OPEN_KEY,
  readContextPanelOpen,
  writeContextPanelOpen,
} from './navigationPreferences';

describe('navigation preferences', () => {
  beforeEach(() => window.localStorage.clear());

  it('defaults the desktop contextual panel open', () => {
    expect(readContextPanelOpen()).toBe(true);
  });

  it('round trips the desktop contextual panel state with the versioned key', () => {
    writeContextPanelOpen(false);

    expect(window.localStorage.getItem(CONTEXT_PANEL_OPEN_KEY)).toBe('false');
    expect(readContextPanelOpen()).toBe(false);
  });

  it('falls back safely when storage cannot be read or written', () => {
    const unavailable = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };

    expect(readContextPanelOpen(unavailable)).toBe(true);
    expect(() => writeContextPanelOpen(false, unavailable)).not.toThrow();
  });
});
