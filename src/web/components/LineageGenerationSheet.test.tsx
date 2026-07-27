// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationJob } from '../../shared/generationTypes';
import type { LineageNode } from '../../shared/types';
import { LineageGenerationSheet } from './LineageGenerationSheet';
import type { CanvasTargetSettingsResponse } from './OutputTargetPreferencesDialog';

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
        default_variant_count: 2,
        targets: [{ kind: 'delivery_surface', surface_id: 'instagram.story', surface_version: 1 }],
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

  it('retains a two-source independent map through every interaction and parent rerender, then submits the canonical map unchanged', async () => {
    const canonicalMap = {
      schema_version: 'lineage.generation_target_map.v1',
      sources: [{
        asset_id: 'source-a',
        default_variant_count: 2,
        separate_surface_ids: ['facebook.story'],
        targets: [
          { kind: 'delivery_surface', surface_id: 'instagram.story', surface_version: 1 },
          { kind: 'delivery_surface', surface_id: 'facebook.story', surface_version: 1, variant_count: 1 },
        ],
      }, {
        asset_id: 'source-b',
        default_variant_count: 2,
        separate_surface_ids: [],
        targets: [
          { kind: 'custom', width: 1200, height: 1500 },
        ],
      }],
    };
    const preview = interactionPlanResponse(canonicalMap);
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(settings({
        default_variant_count: 1,
        targets: [
          { kind: 'delivery_surface', surface_id: 'instagram.story', surface_version: 1 },
        ],
        separate_surface_ids: [],
      })))
      .mockResolvedValueOnce(response(preview))
      .mockResolvedValueOnce(response({ ...preview, job: { ...preview.job, id: 'stored-custom-job' } }));
    vi.stubGlobal('fetch', fetch);
    const onPlanned = vi.fn();
    await render(onPlanned);

    const sourceOne = sourceFieldset('Source 1');
    const sourceTwo = sourceFieldset('Source 2');
    clickCheckbox(labelContaining(sourceOne, 'Facebook · Story').querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    await rerender(onPlanned);
    expect(labelContaining(sourceOne, 'Facebook · Story').querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);

    clickCheckbox(labelContaining(rowContaining(sourceOne, 'Facebook · Story'), 'Create separate variants').querySelector<HTMLInputElement>('input')!);
    await rerender(onPlanned);
    expect(labelContaining(rowContaining(sourceOne, 'Facebook · Story'), 'Create separate variants').querySelector<HTMLInputElement>('input')?.checked).toBe(true);

    setInput(inputByLabel('Source 1 Variants per format'), '2');
    await rerender(onPlanned);
    expect(inputByLabel('Source 1 Variants per format').value).toBe('2');

    setInput(inputsByLabel('Source 1 Story count', sourceOne)[1], '1');
    await rerender(onPlanned);
    expect(inputsByLabel('Source 1 Story count', sourceOne)[1].value).toBe('1');

    clickCheckbox(labelContaining(sourceTwo, 'Instagram · Story').querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    setInput(inputByLabel('Source 2 Variants per format'), '2');
    act(() => button('Add custom size', sourceTwo)!.click());
    setInput(inputByLabel('Source 2 custom size 1 width'), '1200');
    setInput(inputByLabel('Source 2 custom size 1 height'), '1500');
    await rerender(onPlanned);
    expect(inputByLabel('Source 2 custom size 1 width').value).toBe('1200');
    expect(inputByLabel('Source 2 custom size 1 height').value).toBe('1500');

    setTextarea(container.querySelector('textarea')!, 'Create custom and story formats');
    await rerender(onPlanned);
    expect(container.querySelector('textarea')?.value).toBe('Create custom and story formats');

    await act(async () => { button('Resolve preview')!.click(); await tick(); });
    const previewBody = JSON.parse(String(fetch.mock.calls[1][1].body));
    expect(previewBody.targetMap).toEqual(canonicalMap);
    expect(container.textContent).toContain('5 exact outputs');
    expect(container.textContent).toContain('3 resolved groups');
    expect(container.textContent).toContain('1200 × 1500 px');
    expect(container.textContent).toContain('No delivery destination');

    await act(async () => { button('Create planned job')!.click(); await tick(); });
    const submitBody = JSON.parse(String(fetch.mock.calls[2][1].body));
    expect(submitBody.targetMap).toEqual(canonicalMap);
    expect(onPlanned).toHaveBeenCalledWith(expect.objectContaining({ id: 'stored-custom-job' }));
  });
});

async function render(onPlanned: (job: GenerationJob) => void) {
  await act(async () => {
    root.render(<LineageGenerationSheet onClose={vi.fn()} onPlanned={onPlanned} project="project" rootAssetId="root" sources={sources} />);
    await tick();
  });
}
async function rerender(onPlanned: (job: GenerationJob) => void) {
  await act(async () => {
    root.render(<LineageGenerationSheet onClose={vi.fn()} onPlanned={onPlanned} project="project" rootAssetId="root" sources={sources.map(source => ({ ...source }))} />);
    await tick();
  });
}
function button(label: string, scope: ParentNode = container) { return [...scope.querySelectorAll('button')].find(item => item.textContent === label) as HTMLButtonElement | undefined; }
function inputByLabel(label: string, scope: ParentNode = container) { return scope.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!; }
function inputsByLabel(label: string, scope: ParentNode = container) { return [...scope.querySelectorAll<HTMLInputElement>(`input[aria-label="${label}"]`)]; }
function labelContaining(scope: ParentNode, text: string) {
  return [...scope.querySelectorAll('label')].find(label => label.textContent?.includes(text))!;
}
function rowContaining(scope: ParentNode, text: string) {
  return [...scope.querySelectorAll<HTMLElement>('.lineage-target-row')].find(row => row.textContent?.includes(text))!;
}
function sourceFieldset(title: string) {
  return [...container.querySelectorAll<HTMLFieldSetElement>('.lineage-source-targets')].find(fieldset => fieldset.querySelector('legend')?.textContent?.includes(title))!;
}
function clickCheckbox(element: HTMLInputElement) {
  act(() => element.click());
}
function setInput(element: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function setTextarea(element: HTMLTextAreaElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function tick() { return new Promise(resolve => setTimeout(resolve, 0)); }
function response(payload: unknown) { return { ok: true, json: async () => payload }; }
function settings(defaults: CanvasTargetSettingsResponse['defaults'] = {
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
      surfaces: [
        { id: 'instagram.story', version: 1, platform: 'Instagram', surface: 'Story', media_kind: 'static_image', geometry_profile_id: 'static-image.1080x1920', geometry_profile_version: 1, aliases: [], guidance: [], source_url: 'https://example.test', source_verified_at: '2026-07-27', lifecycle: 'active' },
        { id: 'facebook.story', version: 1, platform: 'Facebook', surface: 'Story', media_kind: 'static_image', geometry_profile_id: 'static-image.1080x1920', geometry_profile_version: 1, aliases: [], guidance: [], source_url: 'https://example.test', source_verified_at: '2026-07-27', lifecycle: 'active' },
      ],
    },
  };
}
function interactionPlanResponse(map: unknown) {
  const groups = [
    { id: 'group-a-instagram', parent_asset_id: 'source-a', width: 1080, height: 1920, delivery_surfaces: [{ platform: 'Instagram', surface: 'Story' }], grouping_mode: 'consolidated', variant_count: 2, target_map_digest: 'digest', guidance: [], unlocked: false },
    { id: 'group-a-facebook', parent_asset_id: 'source-a', width: 1080, height: 1920, delivery_surfaces: [{ platform: 'Facebook', surface: 'Story' }], grouping_mode: 'explicit_split', variant_count: 1, target_map_digest: 'digest', guidance: [], unlocked: false },
    { id: 'group-b-custom', parent_asset_id: 'source-b', width: 1200, height: 1500, delivery_surfaces: [], grouping_mode: 'consolidated', variant_count: 2, target_map_digest: 'digest', guidance: [], unlocked: false },
  ];
  return {
    ok: true, command: 'generate image plan', project: 'project', dryRun: true, wouldWrite: true,
    job: {
      id: 'preview-custom-job', project_id: 'project', expected_output_count: 5, status: 'planned', inputs: [], outputs: [], receipts: [],
      target_plan: { map, canonical_json: JSON.stringify(map), digest_sha256: 'digest', groups, slots: [], expected_output_count: 5 },
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
