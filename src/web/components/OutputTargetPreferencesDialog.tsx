import { useEffect, useMemo, useState } from 'react';
import type { OutputTargetRegistry, GenerationTarget } from '../../shared/outputTargetTypes';
import { api } from '../api';
import './OutputTargetPreferencesDialog.css';

export interface CanvasTargetSettingsResponse {
  ok: true;
  project: string;
  root_asset_id: string;
  registry: OutputTargetRegistry;
  defaults: {
    default_variant_count: number;
    targets: GenerationTarget[];
    separate_surface_ids: string[];
  } | null;
  mutation_policy: { actor: 'human'; origin: 'canvas'; agent_access: 'read_only' };
}

export function OutputTargetPreferencesDialog({ onClose, onSaved, project, rootAssetId }: {
  onClose: () => void;
  onSaved?: () => void;
  project: string;
  rootAssetId: string;
}) {
  const [settings, setSettings] = useState<CanvasTargetSettingsResponse | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [split, setSplit] = useState<string[]>([]);
  const [count, setCount] = useState(1);
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const params = useMemo(() => new URLSearchParams({ project, rootAssetId }).toString(), [project, rootAssetId]);

  useEffect(() => {
    let cancelled = false;
    api<CanvasTargetSettingsResponse>(`/api/generation/targets?${params}`)
      .then(result => {
        if (cancelled) return;
        setSettings(result);
        setCount(result.defaults?.default_variant_count ?? 1);
        setSelected(result.defaults?.targets.flatMap(target => target.kind === 'delivery_surface' ? [target.surface_id] : []) ?? []);
        setUnlocked(result.defaults?.targets.some(target => target.kind === 'unlocked') ?? false);
        setSplit(result.defaults?.separate_surface_ids ?? []);
      })
      .catch(reason => !cancelled && setError(reason instanceof Error ? reason.message : String(reason)));
    return () => { cancelled = true; };
  }, [params]);

  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter(item => item !== value) : [...list, value];
  }

  async function save() {
    if (!settings || (!unlocked && selected.length === 0)) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/generation/targets/defaults', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project,
          rootAssetId,
          confirmWrite: true,
          default_variant_count: count,
          targets: unlocked
            ? [{ kind: 'unlocked', variant_count: count }]
            : selected.map(surfaceId => ({ kind: 'delivery_surface', surface_id: surfaceId, surface_version: 1 })),
          separate_surface_ids: unlocked ? [] : split.filter(surfaceId => selected.includes(surfaceId)),
        }),
      });
      onSaved?.();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setError('');
    try {
      await api('/api/generation/targets/defaults', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, rootAssetId, confirmWrite: true }),
      });
      onSaved?.();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="output-target-dialog-backdrop" onClick={onClose}>
      <section aria-labelledby="output-target-preferences-title" aria-modal="true" className="output-target-dialog" onClick={event => event.stopPropagation()} role="dialog">
        <header>
          <div>
            <h3 id="output-target-preferences-title">Output target defaults</h3>
            <p>Defaults apply to this lineage only. They are saved by an explicit human action; agents and CLI can read them but cannot change them.</p>
          </div>
          <button onClick={onClose} type="button">Close</button>
        </header>
        {error && <p className="output-target-error" role="alert">{error}</p>}
        {!settings && !error && <p>Loading output targets…</p>}
        {settings && (
          <>
            <label className="output-target-unlocked">
              <input checked={unlocked} onChange={event => setUnlocked(event.target.checked)} type="checkbox" />
              <span><strong>Explicitly unlocked</strong><small>No pixel dimensions will be enforced for this default.</small></span>
            </label>
            <fieldset disabled={unlocked}>
              <legend>Delivery surfaces</legend>
              {settings.registry.surfaces.map(surface => {
                const geometry = settings.registry.geometries.find(item => item.id === surface.geometry_profile_id && item.version === surface.geometry_profile_version)!;
                return (
                  <label className="output-target-surface" key={surface.id}>
                    <input checked={selected.includes(surface.id)} onChange={() => setSelected(toggle(selected, surface.id))} type="checkbox" />
                    <span><strong>{surface.platform} · {surface.surface}</strong><small>{geometry.width} × {geometry.height} px</small></span>
                    {selected.includes(surface.id) && (
                      <input aria-label={`Split ${surface.platform} ${surface.surface}`} checked={split.includes(surface.id)} onChange={() => setSplit(toggle(split, surface.id))} title="Keep this surface in a separate output group even when dimensions match" type="checkbox" />
                    )}
                  </label>
                );
              })}
            </fieldset>
            <label className="output-target-count">
              Variants per resolved group
              <input max={100} min={1} onChange={event => setCount(Number(event.target.value))} type="number" value={count} />
            </label>
            <p className="output-target-guidance">Platform safe zones are creative guidance only. Lineage enforces exact pixel dimensions, not safe-zone placement.</p>
            <footer>
              <button disabled={busy || !settings.defaults} onClick={() => void clear()} type="button">Clear defaults</button>
              <button className="primary-button" disabled={busy || count < 1 || (!unlocked && selected.length === 0)} onClick={() => void save()} type="button">Save human defaults</button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
