// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeNextOutputTargetsEditor } from './NodeNextOutputTargets';
import type { NodeNextOutputTargetsResponse } from './NodeNextOutputTargetsModel';

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

describe('NodeNextOutputTargetsEditor', () => {
  it('replaces and clears sticky targets with exact compare-and-swap revisions', async () => {
    const initial = state('node-a', 'node_override', 4, 1080, 1920);
    const replaced = state('node-a', 'node_override', 5, 1080, 1920);
    replaced.setting!.targets.push({ kind: 'delivery_surface', surface_id: 'facebook.story', surface_version: 1 });
    replaced.effective.targets = replaced.setting!.targets;
    replaced.effective.resolved_targets[0].delivery_surfaces.push(surfaceSnapshot('facebook.story', 'Facebook'));
    const inherited = state('node-a', 'canvas_default', undefined, 1080, 1350);
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(settings()))
      .mockResolvedValueOnce(response(initial))
      .mockResolvedValueOnce(response({ ok: true, setting: replaced.setting, effective: replaced.effective }))
      .mockResolvedValueOnce(response({ ok: true }))
      .mockResolvedValueOnce(response(settings()))
      .mockResolvedValueOnce(response(inherited));
    vi.stubGlobal('fetch', fetch);
    const onSaved = vi.fn();
    await act(async () => {
      root.render(<NodeNextOutputTargetsEditor nodeAssetId="node-a" nodeTitle="Node A" onClose={vi.fn()} onSaved={onSaved} project="project" rootAssetId="root" />);
      await tick();
    });

    expect(container.textContent).toContain('Sticky next 1080×1920');
    click('Replace sticky targets');
    const facebook = [...container.querySelectorAll('label')].find(label => label.textContent?.includes('Facebook · Story'))!.querySelector('input')!;
    act(() => facebook.click());
    await clickAsync('Replace revision');

    const putBody = JSON.parse(String(fetch.mock.calls[2][1]?.body));
    expect(putBody).toMatchObject({
      confirmWrite: true,
      expectedRevision: 4,
      nodeAssetId: 'node-a',
      project: 'project',
      rootAssetId: 'root',
    });
    expect(putBody.targets).toEqual([
      { kind: 'delivery_surface', surface_id: 'instagram.story', surface_version: 1 },
      { kind: 'delivery_surface', surface_id: 'facebook.story', surface_version: 1 },
    ]);
    expect(putBody).not.toHaveProperty('variant_count');

    await clickAsync('Clear to canvas default');
    const deleteBody = JSON.parse(String(fetch.mock.calls[3][1]?.body));
    expect(deleteBody).toMatchObject({ confirmWrite: true, expectedRevision: 5, nodeAssetId: 'node-a' });
    expect(container.textContent).toContain('Inherited next 1080×1350');
    expect(onSaved).toHaveBeenCalledTimes(2);
  });
});

function click(label: string) {
  act(() => button(label)!.click());
}

async function clickAsync(label: string) {
  await act(async () => {
    button(label)!.click();
    await tick();
  });
}

function button(label: string) {
  return [...container.querySelectorAll('button')].find(item => item.textContent === label) as HTMLButtonElement | undefined;
}

function tick() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function response(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload };
}

function surfaceRecord(id: string, platform: string) {
  return {
    aliases: [],
    geometry_profile_id: 'static-image.1080x1920',
    geometry_profile_version: 1,
    guidance: [],
    id,
    lifecycle: 'active' as const,
    media_kind: 'static_image' as const,
    platform,
    source_url: 'https://example.test',
    source_verified_at: '2026-07-27',
    surface: 'Story',
    version: 1,
  };
}

function surfaceSnapshot(id: string, platform: string) {
  return {
    geometry: { height: 1920, id: 'static-image.1080x1920', media_kind: 'static_image' as const, version: 1, width: 1080 },
    guidance: [],
    id,
    lifecycle: 'active' as const,
    media_kind: 'static_image' as const,
    platform,
    source_url: 'https://example.test',
    source_verified_at: '2026-07-27',
    surface: 'Story',
    version: 1,
  };
}

function settings() {
  return {
    ok: true,
    project: 'project',
    root_asset_id: 'root',
    defaults: null,
    mutation_policy: { actor: 'human', origin: 'canvas', agent_access: 'read_only' },
    registry: {
      schema_version: 'lineage.output_target_registry.v1',
      geometries: [
        { id: 'static-image.1080x1920', version: 1, media_kind: 'static_image', width: 1080, height: 1920 },
      ],
      surfaces: [surfaceRecord('instagram.story', 'Instagram'), surfaceRecord('facebook.story', 'Facebook')],
    },
  };
}

function state(
  nodeAssetId: string,
  origin: NodeNextOutputTargetsResponse['effective']['origin'],
  revision: number | undefined,
  width: number,
  height: number,
): NodeNextOutputTargetsResponse {
  const targets = [{ kind: 'delivery_surface' as const, surface_id: 'instagram.story', surface_version: 1 }];
  const resolvedTargets = [{
    delivery_surfaces: [surfaceSnapshot('instagram.story', 'Instagram')],
    height,
    media_kind: 'static_image' as const,
    width,
  }];
  return {
    ok: true,
    project: 'project',
    root_asset_id: 'root',
    node_asset_id: nodeAssetId,
    setting: revision ? {
      created_at: '2026-07-27T00:00:00.000Z',
      digest_sha256: `setting-${revision}`,
      node_asset_id: nodeAssetId,
      project_id: 'project',
      provenance: { actor: 'human', origin: 'canvas' },
      resolved_targets: resolvedTargets,
      revision,
      root_asset_id: 'root',
      schema_version: 'lineage.node_next_output_targets.v1',
      targets,
      updated_at: '2026-07-27T00:00:00.000Z',
    } : null,
    effective: {
      node_asset_id: nodeAssetId,
      origin,
      project_id: 'project',
      resolution_digest_sha256: `resolution-${origin}-${revision ?? 'default'}`,
      resolved_targets: resolvedTargets,
      root_asset_id: 'root',
      schema_version: 'lineage.node_next_output_targets.v1',
      targets,
      ...(revision ? { setting_digest_sha256: `setting-${revision}`, setting_revision: revision } : {}),
    },
  };
}
