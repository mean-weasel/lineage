// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutputTargetPreferencesDialog, type CanvasTargetSettingsResponse } from './OutputTargetPreferencesDialog';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OutputTargetPreferencesDialog', () => {
  it('explains human ownership and saves the exact scoped default', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(settings()));
    fetch.mockResolvedValueOnce(response({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    const onClose = vi.fn();
    await render(onClose);

    expect(container.textContent).toContain('agents and CLI can read them but cannot change them');
    expect(container.textContent).toContain('safe zones are creative guidance only');
    const story = input('Instagram · Story')!;
    act(() => story.click());
    const save = button('Save human defaults')!;
    await act(async () => { save.click(); await tick(); });

    const request = JSON.parse(String(fetch.mock.calls[1][1].body));
    expect(request).toMatchObject({
      project: 'project',
      rootAssetId: 'root',
      confirmWrite: true,
      default_variant_count: 1,
      targets: [{ kind: 'delivery_surface', surface_id: 'instagram.story', surface_version: 1 }],
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders explicit unlocked state distinctly and clears existing defaults', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(settings({
        default_variant_count: 2,
        separate_surface_ids: [],
        targets: [{ kind: 'unlocked', variant_count: 2 }],
      })))
      .mockResolvedValueOnce(response({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    await render(vi.fn());

    expect(container.querySelector<HTMLInputElement>('.output-target-unlocked input')?.checked).toBe(true);
    await act(async () => { button('Clear defaults')!.click(); await tick(); });
    expect(fetch.mock.calls[1][1].method).toBe('DELETE');
    expect(JSON.parse(String(fetch.mock.calls[1][1].body))).toMatchObject({ confirmWrite: true, rootAssetId: 'root' });
  });
});

async function render(onClose: () => void) {
  await act(async () => {
    root.render(<OutputTargetPreferencesDialog onClose={onClose} project="project" rootAssetId="root" />);
    await tick();
  });
}

function input(label: string) {
  return [...container.querySelectorAll('label')].find(item => item.textContent?.includes(label))?.querySelector<HTMLInputElement>('input');
}
function button(label: string) {
  return [...container.querySelectorAll('button')].find(item => item.textContent === label);
}
function tick() { return new Promise(resolve => setTimeout(resolve, 0)); }
function response(payload: unknown) { return { ok: true, json: async () => payload }; }
function settings(defaults: CanvasTargetSettingsResponse['defaults'] = null): CanvasTargetSettingsResponse {
  return {
    ok: true,
    project: 'project',
    root_asset_id: 'root',
    defaults,
    mutation_policy: { actor: 'human', origin: 'canvas', agent_access: 'read_only' },
    registry: {
      schema_version: 'lineage.output_target_registry.v1',
      geometries: [{ id: 'static-image.1080x1920', version: 1, media_kind: 'static_image', width: 1080, height: 1920 }],
      surfaces: [{
        id: 'instagram.story', version: 1, platform: 'Instagram', surface: 'Story', media_kind: 'static_image',
        geometry_profile_id: 'static-image.1080x1920', geometry_profile_version: 1, aliases: [], guidance: [],
        source_url: 'https://example.test', source_verified_at: '2026-07-27', lifecycle: 'active',
      }],
    },
  };
}
