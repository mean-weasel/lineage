import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  EffectiveNodeNextOutputTargets,
  NodeNextOutputTarget,
  NodeNextOutputTargetSetting,
  OutputTargetRegistry,
} from '../../shared/outputTargetTypes';
import { api } from '../api';
import type { CanvasTargetSettingsResponse } from './OutputTargetPreferencesDialog';
import './NodeNextOutputTargets.css';

export interface NodeNextOutputTargetsResponse {
  ok: true;
  project: string;
  root_asset_id: string;
  node_asset_id: string;
  setting: NodeNextOutputTargetSetting | null;
  effective: EffectiveNodeNextOutputTargets;
}

export async function loadNodeNextOutputTargets(
  project: string,
  rootAssetId: string,
  nodeAssetId: string,
): Promise<NodeNextOutputTargetsResponse> {
  const query = new URLSearchParams({ project, rootAssetId, nodeAssetId });
  return api<NodeNextOutputTargetsResponse>(`/api/generation/targets/node?${query.toString()}`);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function selectedNodeTargetResolutionDigest(
  states: readonly NodeNextOutputTargetsResponse[],
): Promise<string> {
  const canonical = states
    .map(state => ({
      parent_asset_id: state.node_asset_id,
      resolution_digest_sha256: state.effective.resolution_digest_sha256,
    }))
    .sort((left, right) => left.parent_asset_id.localeCompare(right.parent_asset_id));
  const bytes = new TextEncoder().encode(stableJson(canonical));
  const result = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function nodeTargetStateLabel(effective: EffectiveNodeNextOutputTargets): string {
  if (effective.origin === 'unresolved') return 'Next targets unresolved';
  const sizes = effective.resolved_targets.map(target => `${target.width}×${target.height}`).join(', ');
  if (effective.origin === 'canvas_default') return `Inherited next ${sizes}`;
  if (effective.origin === 'derived_child') return `Produced next ${sizes}`;
  return `Sticky next ${sizes}`;
}

type CustomDraft = { id: string; height: string; width: string };

export function NodeNextOutputTargetsEditor({
  embedded = false,
  nodeAssetId,
  nodeTitle,
  onClose,
  onSaved,
  project,
  rootAssetId,
}: {
  embedded?: boolean;
  nodeAssetId: string;
  nodeTitle: string;
  onClose?: () => void;
  onSaved?: (state: NodeNextOutputTargetsResponse) => void;
  project: string;
  rootAssetId: string;
}) {
  const [registry, setRegistry] = useState<OutputTargetRegistry | null>(null);
  const [state, setState] = useState<NodeNextOutputTargetsResponse | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState<CustomDraft[]>([]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const hydrateDraft = useCallback((next: NodeNextOutputTargetsResponse) => {
    const targets = next.setting?.targets ?? next.effective.targets;
    setSelected(targets.flatMap(target => target.kind === 'delivery_surface'
      ? [`${target.surface_id}@${target.surface_version}`]
      : []));
    setCustom(targets.flatMap((target, index) => target.kind === 'custom'
      ? [{ id: `custom-${index}`, width: String(target.width), height: String(target.height) }]
      : []));
  }, []);

  const reload = useCallback(async () => {
    const [settings, nodeState] = await Promise.all([
      api<CanvasTargetSettingsResponse>(`/api/generation/targets?${new URLSearchParams({ project, rootAssetId })}`),
      loadNodeNextOutputTargets(project, rootAssetId, nodeAssetId),
    ]);
    setRegistry(settings.registry);
    setState(nodeState);
    hydrateDraft(nodeState);
    return nodeState;
  }, [hydrateDraft, nodeAssetId, project, rootAssetId]);

  useEffect(() => {
    let cancelled = false;
    reload().catch(reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { cancelled = true; };
  }, [reload]);

  const targets = useMemo<NodeNextOutputTarget[]>(() => [
    ...selected.map(reference => {
      const [surfaceId, version] = reference.split('@');
      return { kind: 'delivery_surface' as const, surface_id: surfaceId, surface_version: Number(version) };
    }),
    ...custom.map(target => ({
      kind: 'custom' as const,
      width: Number(target.width),
      height: Number(target.height),
    })),
  ], [custom, selected]);

  async function save() {
    if (!state || targets.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ setting: NodeNextOutputTargetSetting; effective: EffectiveNodeNextOutputTargets }>(
        '/api/generation/targets/node',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project,
            rootAssetId,
            nodeAssetId,
            expectedRevision: state.setting?.revision ?? null,
            targets,
            confirmWrite: true,
          }),
        },
      );
      const next = {
        ...state,
        setting: result.setting,
        effective: result.effective,
      };
      setState(next);
      hydrateDraft(next);
      setEditing(false);
      onSaved?.(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!state?.setting) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/generation/targets/node', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project,
          rootAssetId,
          nodeAssetId,
          expectedRevision: state.setting.revision,
          confirmWrite: true,
        }),
      });
      const next = await reload();
      setEditing(false);
      onSaved?.(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  const content = (
    <section className={`node-next-targets ${embedded ? 'embedded' : ''}`} aria-label={`Next output targets for ${nodeTitle}`}>
      <header>
        <div>
          <h3>{embedded ? nodeTitle : 'Next output targets'}</h3>
          {!embedded && <p>{nodeTitle}</p>}
        </div>
        {!embedded && <button onClick={onClose} type="button">Close</button>}
      </header>
      <p className="node-next-targets-separation">These targets apply to future children only. They do not change this asset’s current pixels.</p>
      {error && <p className="output-target-error" role="alert">{error}</p>}
      {!state && !error && <p>Loading next-output intent…</p>}
      {state && (
        <>
          <div className={`node-next-target-summary origin-${state.effective.origin}`}>
            <strong>{nodeTargetStateLabel(state.effective)}</strong>
            <span>
              {state.effective.origin === 'canvas_default' && 'Dynamic human canvas default'}
              {state.effective.origin === 'node_override' && `Explicit sticky override · revision ${state.setting?.revision}`}
              {state.effective.origin === 'derived_child' && 'Inherited from this child’s verified produced geometry'}
              {state.effective.origin === 'unresolved' && 'Set an explicit surface or custom size before locked generation'}
            </span>
            {state.effective.resolved_targets.map((target, index) => (
              <small key={`${target.width}x${target.height}-${index}`}>
                {target.width} × {target.height} px
                {target.delivery_surfaces.length > 0
                  ? ` · ${target.delivery_surfaces.map(surface => `${surface.platform} ${surface.surface}`).join(', ')}`
                  : ' · custom'}
              </small>
            ))}
          </div>
          {!editing ? (
            <div className="node-next-target-actions">
              <button onClick={() => setEditing(true)} type="button">
                {state.setting ? 'Replace sticky targets' : 'Set sticky targets'}
              </button>
              {state.setting && <button disabled={busy} onClick={() => void clear()} type="button">Clear to canvas default</button>}
            </div>
          ) : (
            <>
              <fieldset disabled={busy}>
                <legend>Static-image surfaces</legend>
                {registry?.surfaces.filter(surface => surface.lifecycle !== 'removed').map(surface => {
                  const reference = `${surface.id}@${surface.version}`;
                  const geometry = registry.geometries.find(item =>
                    item.id === surface.geometry_profile_id && item.version === surface.geometry_profile_version);
                  return (
                    <label className="node-next-target-choice" key={reference}>
                      <input
                        checked={selected.includes(reference)}
                        onChange={() => setSelected(current => current.includes(reference)
                          ? current.filter(item => item !== reference)
                          : [...current, reference])}
                        type="checkbox"
                      />
                      <span><strong>{surface.platform} · {surface.surface}</strong><small>{geometry?.width} × {geometry?.height} px</small></span>
                    </label>
                  );
                })}
              </fieldset>
              <section className="node-next-custom-targets">
                <div><strong>Custom dimensions</strong><button onClick={() => setCustom(current => [...current, { id: `custom-${Date.now()}`, width: '', height: '' }])} type="button">Add size</button></div>
                {custom.map((target, index) => (
                  <div key={target.id}>
                    <label>Width<input aria-label={`${nodeTitle} custom width ${index + 1}`} onChange={event => setCustom(current => current.map(item => item.id === target.id ? { ...item, width: event.target.value } : item))} type="number" value={target.width} /></label>
                    <span>×</span>
                    <label>Height<input aria-label={`${nodeTitle} custom height ${index + 1}`} onChange={event => setCustom(current => current.map(item => item.id === target.id ? { ...item, height: event.target.value } : item))} type="number" value={target.height} /></label>
                    <button onClick={() => setCustom(current => current.filter(item => item.id !== target.id))} type="button">Remove</button>
                  </div>
                ))}
              </section>
              <div className="node-next-target-actions">
                <button disabled={busy} onClick={() => { hydrateDraft(state); setEditing(false); }} type="button">Cancel edit</button>
                <button className="primary-button" disabled={busy || targets.length === 0 || custom.some(target => !Number.isInteger(Number(target.width)) || !Number.isInteger(Number(target.height)))} onClick={() => void save()} type="button">
                  {state.setting ? 'Replace revision' : 'Set sticky targets'}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );

  if (embedded) return content;
  return <div className="node-next-targets-backdrop" onClick={onClose}><div onClick={event => event.stopPropagation()}>{content}</div></div>;
}
