// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsView } from './SettingsView';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('SettingsView', () => {
  it('keeps global settings focused on runtime and integrations without duplicating Canvas hover preferences', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => ({
      json: async () => String(input).includes('/api/runtime')
        ? { runtime: { database: { exists: true, path: '/tmp/test.db' }, profile: { bound: true, environment: 'development', id: 'test' }, schema: { migration_keys: [] } } }
        : { settings: [] },
      ok: true,
    })));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<SettingsView onToast={vi.fn()} project="demo-project" />);
      await new Promise(resolve => window.setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Release');
    expect(container.textContent).toContain('Cloud storage');
    expect(container.textContent).toContain('Social scheduling');
    expect(container.textContent).toContain('Image generation');
    expect(container.textContent).not.toContain('Lineage experience');
    expect(container.querySelector('[aria-label="Enable lineage hover previews"]')).toBeNull();

    act(() => root.unmount());
  });
});
