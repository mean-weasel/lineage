// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationJob } from '../../shared/generationTypes';
import type { LineageNode } from '../../shared/types';
import { LineageGenerationSheet } from './LineageGenerationSheet';

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

describe('LineageGenerationSheet', () => {
  it('requires a backend-resolved preview and submits its canonical map unchanged', async () => {
    const canonicalMap = {
      schema_version: 'lineage.generation_target_map.v1',
      sources: sources.map(source => ({
        asset_id: source.asset_id,
        targets: [{ kind: 'delivery_surface', surface_id: 'instagram.story', surface_version: 1, variant_count: 2 }],
        separate_surface_ids: [],
      })),
    };
    const preview = planResponse(canonicalMap);
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(settings()))
      .mockResolvedValueOnce(response(preview))
      .mockResolvedValueOnce(response({ ...preview, dryRun: undefined, job: { ...preview.job, id: 'stored-job' } }));
    vi.stubGlobal('fetch', fetch);
    const onPlanned = vi.fn();
    await render(onPlanned);

    expect(button('Create planned job')!.disabled).toBe(true);
    const prompt = container.querySelector('textarea')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(prompt, 'Create exact story variants');
      prompt.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { button('Resolve preview')!.click(); await tick(); });

    expect(container.textContent).toContain('4 exact outputs');
    expect(container.textContent).toContain('1080 × 1920 px');
    expect(container.textContent).toContain('Safe zones are guidance only');
    expect(button('Create planned job')!.disabled).toBe(false);
    const previewBody = JSON.parse(String(fetch.mock.calls[1][1].body));
    expect(previewBody.targetMap.sources).toHaveLength(2);
    expect(previewBody.targetMap.sources.every((source: { asset_id: string }) => sources.some(item => item.asset_id === source.asset_id))).toBe(true);

    await act(async () => { button('Create planned job')!.click(); await tick(); });
    const submitBody = JSON.parse(String(fetch.mock.calls[2][1].body));
    expect(submitBody.targetMap).toEqual(canonicalMap);
    expect(submitBody.confirmWrite).toBe(true);
    expect(onPlanned).toHaveBeenCalledWith(expect.objectContaining({ id: 'stored-job' }));
  });

  it('keeps incomplete and mixed mappings from preview or submission', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(settings(null))));
    await render(vi.fn());
    expect(button('Resolve preview')!.disabled).toBe(true);
    expect(button('Create planned job')!.disabled).toBe(true);
    expect(container.textContent).toContain('Incomplete, ambiguous, conflicting, or invalid mappings cannot submit');
    expect(container.querySelectorAll('.lineage-source-targets')).toHaveLength(2);
  });
});

async function render(onPlanned: (job: GenerationJob) => void) {
  await act(async () => {
    root.render(<LineageGenerationSheet onClose={vi.fn()} onPlanned={onPlanned} project="project" rootAssetId="root" sources={sources} />);
    await tick();
  });
}
function button(label: string) { return [...container.querySelectorAll('button')].find(item => item.textContent === label) as HTMLButtonElement | undefined; }
function tick() { return new Promise(resolve => setTimeout(resolve, 0)); }
function response(payload: unknown) { return { ok: true, json: async () => payload }; }
function settings(defaults: null | { default_variant_count: number; targets: Array<{ kind: 'delivery_surface'; surface_id: string; surface_version: number }>; separate_surface_ids: string[] } = {
  default_variant_count: 2,
  targets: [{ kind: 'delivery_surface', surface_id: 'instagram.story', surface_version: 1 }],
  separate_surface_ids: [],
}) {
  return {
    ok: true, project: 'project', root_asset_id: 'root', defaults,
    mutation_policy: { actor: 'human', origin: 'canvas', agent_access: 'read_only' },
    registry: {
      schema_version: 'lineage.output_target_registry.v1',
      geometries: [{ id: 'static-image.1080x1920', version: 1, media_kind: 'static_image', width: 1080, height: 1920 }],
      surfaces: [{ id: 'instagram.story', version: 1, platform: 'Instagram', surface: 'Story', media_kind: 'static_image', geometry_profile_id: 'static-image.1080x1920', geometry_profile_version: 1, aliases: [], guidance: [], source_url: 'https://example.test', source_verified_at: '2026-07-27', lifecycle: 'active' }],
    },
  };
}
function planResponse(map: unknown) {
  const groups = sources.map((source, index) => ({
    id: `job:group:${index}`, parent_asset_id: source.asset_id, media_kind: 'static_image', width: 1080, height: 1920,
    delivery_surfaces: [{ platform: 'Instagram', surface: 'Story' }], grouping_mode: 'consolidated', variant_count: 2, target_map_digest: 'digest', guidance: [], unlocked: false,
  }));
  return {
    ok: true, command: 'generate image plan', project: 'project', dryRun: true, wouldWrite: true,
    job: {
      id: 'preview-job', project_id: 'project', expected_output_count: 4, status: 'planned', inputs: [], outputs: [], receipts: [],
      target_plan: { map, canonical_json: JSON.stringify(map), digest_sha256: 'digest', groups, slots: [], expected_output_count: 4 },
    },
  };
}
const sources = ['source-a', 'source-b'].map((asset_id, index) => ({
  asset_id, title: `Source ${index + 1}`, project: 'project', source: 'local', status: 'working', review_state: 'unreviewed',
  media_type: 'image', is_latest: true, user_selected: true,
})) as LineageNode[];
