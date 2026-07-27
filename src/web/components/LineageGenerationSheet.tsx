import { useEffect, useMemo, useState } from 'react';
import type { GenerationJob, GenerationPlanResponse } from '../../shared/generationTypes';
import type { GenerationSourceTargets, GenerationTargetMap } from '../../shared/outputTargetTypes';
import type { LineageNode } from '../../shared/types';
import { api } from '../api';
import { type CanvasTargetSettingsResponse } from './OutputTargetPreferencesDialog';
import './LineageGenerationSheet.css';

type SourceDraft = {
  assetId: string;
  counts: Record<string, number>;
  selected: string[];
  split: string[];
  unlocked: boolean;
};

export function LineageGenerationSheet({ onClose, onPlanned, project, rootAssetId, sources }: {
  onClose: () => void;
  onPlanned?: (job: GenerationJob) => void;
  project: string;
  rootAssetId: string;
  sources: LineageNode[];
}) {
  const [settings, setSettings] = useState<CanvasTargetSettingsResponse | null>(null);
  const [drafts, setDrafts] = useState<SourceDraft[]>([]);
  const [prompt, setPrompt] = useState('');
  const [preview, setPreview] = useState<GenerationPlanResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const params = useMemo(() => new URLSearchParams({ project, rootAssetId }).toString(), [project, rootAssetId]);

  useEffect(() => {
    let cancelled = false;
    api<CanvasTargetSettingsResponse>(`/api/generation/targets?${params}`).then(result => {
      if (cancelled) return;
      setSettings(result);
      const defaultSurfaceIds = result.defaults?.targets.flatMap(target => target.kind === 'delivery_surface' ? [target.surface_id] : []) ?? [];
      const defaultUnlocked = result.defaults?.targets.some(target => target.kind === 'unlocked') ?? false;
      setDrafts(sources.map(source => ({
        assetId: source.asset_id,
        counts: Object.fromEntries(defaultSurfaceIds.map(id => [id, result.defaults?.default_variant_count ?? 1])),
        selected: defaultSurfaceIds,
        split: result.defaults?.separate_surface_ids ?? [],
        unlocked: defaultUnlocked,
      })));
    }).catch(reason => !cancelled && setError(reason instanceof Error ? reason.message : String(reason)));
    return () => { cancelled = true; };
  }, [params, sources]);

  function updateDraft(assetId: string, change: (draft: SourceDraft) => SourceDraft) {
    setDrafts(current => current.map(draft => draft.assetId === assetId ? change(draft) : draft));
    setPreview(null);
    setError('');
  }

  function updateSurfaceCount(draft: SourceDraft, surfaceId: string, count: number): SourceDraft {
    if (!settings || draft.split.includes(surfaceId)) {
      return { ...draft, counts: { ...draft.counts, [surfaceId]: count } };
    }
    const surface = settings.registry.surfaces.find(item => item.id === surfaceId);
    const sharedGeometryIds = settings.registry.surfaces
      .filter(item =>
        item.geometry_profile_id === surface?.geometry_profile_id
        && item.geometry_profile_version === surface.geometry_profile_version
        && draft.selected.includes(item.id)
        && !draft.split.includes(item.id),
      )
      .map(item => item.id);
    return {
      ...draft,
      counts: { ...draft.counts, ...Object.fromEntries(sharedGeometryIds.map(id => [id, count])) },
    };
  }

  function targetMap(): GenerationTargetMap {
    return {
      schema_version: 'lineage.generation_target_map.v1',
      sources: drafts.map((draft): GenerationSourceTargets => ({
        asset_id: draft.assetId,
        targets: draft.unlocked
          ? [{ kind: 'unlocked', variant_count: draft.counts.unlocked ?? 1 }]
          : draft.selected.map(surfaceId => ({
              kind: 'delivery_surface',
              surface_id: surfaceId,
              surface_version: 1,
              variant_count: draft.counts[surfaceId] ?? 1,
            })),
        separate_surface_ids: draft.unlocked ? [] : draft.split.filter(id => draft.selected.includes(id)),
      })),
    };
  }

  const locallyComplete = Boolean(
    prompt.trim()
    && drafts.length === sources.length
    && drafts.every(draft => draft.unlocked
      ? Number.isInteger(draft.counts.unlocked ?? 1) && (draft.counts.unlocked ?? 1) > 0
      : draft.selected.length > 0 && draft.selected.every(id => Number.isInteger(draft.counts[id] ?? 1) && (draft.counts[id] ?? 1) > 0)),
  );

  async function requestPlan(previewOnly: boolean) {
    setBusy(true);
    setError('');
    try {
      const body = previewOnly
        ? { project, prompt, targetMap: targetMap(), preview: true }
        : { project, prompt, targetMap: preview!.job.target_plan!.map, confirmWrite: true };
      const result = await api<GenerationPlanResponse>('/api/generation/targets/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (previewOnly) setPreview(result);
      else {
        onPlanned?.(result.job);
        onClose();
      }
    } catch (reason) {
      setPreview(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lineage-generation-backdrop" onClick={onClose}>
      <section aria-labelledby="lineage-generation-title" aria-modal="true" className="lineage-generation-sheet" onClick={event => event.stopPropagation()} role="dialog">
        <header><div><h3 id="lineage-generation-title">Plan next branch</h3><p>Map every selected source to locked output targets or mark it explicitly unlocked.</p></div><button onClick={onClose}>Close</button></header>
        <label className="lineage-generation-prompt">Generation prompt<textarea onChange={event => { setPrompt(event.target.value); setPreview(null); }} value={prompt} /></label>
        {error && <p className="output-target-error" role="alert">{error}</p>}
        {!settings && !error && <p>Loading durable target registry…</p>}
        {settings && drafts.map(draft => {
          const source = sources.find(item => item.asset_id === draft.assetId)!;
          return (
            <fieldset className={`lineage-source-targets ${draft.unlocked ? 'is-unlocked' : 'is-locked'}`} key={draft.assetId}>
              <legend>{source.title} <code>{source.asset_id}</code></legend>
              <label className="lineage-explicit-unlock"><input checked={draft.unlocked} onChange={event => updateDraft(draft.assetId, current => ({ ...current, unlocked: event.target.checked }))} type="checkbox" /> Explicitly unlocked</label>
              {!draft.unlocked && settings.registry.surfaces.map(surface => {
                const geometry = settings.registry.geometries.find(item => item.id === surface.geometry_profile_id && item.version === surface.geometry_profile_version)!;
                const chosen = draft.selected.includes(surface.id);
                return (
                  <div className="lineage-target-row" key={surface.id}>
                    <label><input checked={chosen} onChange={() => updateDraft(draft.assetId, current => ({ ...current, selected: chosen ? current.selected.filter(id => id !== surface.id) : [...current.selected, surface.id] }))} type="checkbox" /> {surface.platform} · {surface.surface} <small>{geometry.width} × {geometry.height}</small></label>
                    {chosen && <label>Group count <input aria-label={`${source.title} ${surface.surface} count`} min={1} onChange={event => updateDraft(draft.assetId, current => updateSurfaceCount(current, surface.id, Number(event.target.value)))} type="number" value={draft.counts[surface.id] ?? 1} /></label>}
                    {chosen && <label title="Do not consolidate this surface with another selected surface of the same geometry"><input checked={draft.split.includes(surface.id)} onChange={() => updateDraft(draft.assetId, current => ({ ...current, split: current.split.includes(surface.id) ? current.split.filter(id => id !== surface.id) : [...current.split, surface.id] }))} type="checkbox" /> Split</label>}
                  </div>
                );
              })}
              {draft.unlocked && <label>Unlocked output count <input aria-label={`${source.title} unlocked count`} min={1} onChange={event => updateDraft(draft.assetId, current => ({ ...current, counts: { ...current.counts, unlocked: Number(event.target.value) } }))} type="number" value={draft.counts.unlocked ?? 1} /></label>}
            </fieldset>
          );
        })}
        <section aria-live="polite" className="lineage-plan-summary">
          <h4>Pre-submit summary</h4>
          {!preview && <p>Preview is required. Incomplete, ambiguous, conflicting, or invalid mappings cannot submit.</p>}
          {preview?.job.target_plan && (
            <>
              <p><strong>{preview.job.target_plan.expected_output_count} exact output{preview.job.target_plan.expected_output_count === 1 ? '' : 's'}</strong> in {preview.job.target_plan.groups.length} resolved group{preview.job.target_plan.groups.length === 1 ? '' : 's'}.</p>
              {preview.job.target_plan.groups.map(group => (
                <article className={group.unlocked ? 'is-unlocked' : 'is-locked'} key={group.id}>
                  <strong>{group.unlocked ? 'Explicitly unlocked' : `${group.width} × ${group.height} px`}</strong>
                  <span>{group.parent_asset_id} · {group.variant_count} output{group.variant_count === 1 ? '' : 's'} · {group.grouping_mode === 'explicit_split' ? 'explicit split' : 'shared geometry'}</span>
                  <small>{group.delivery_surfaces.map(surface => `${surface.platform} ${surface.surface}`).join(', ') || 'No delivery destination'}</small>
                </article>
              ))}
              <p className="output-target-guidance">Safe zones are guidance only; exact dimensions above are the enforced contract.</p>
            </>
          )}
        </section>
        <footer>
          <button disabled={busy || !locallyComplete} onClick={() => void requestPlan(true)}>Resolve preview</button>
          <button className="primary-button" disabled={busy || !preview?.job.target_plan} onClick={() => void requestPlan(false)}>Create planned job</button>
        </footer>
      </section>
    </div>
  );
}
