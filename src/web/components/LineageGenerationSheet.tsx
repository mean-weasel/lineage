import { useEffect, useMemo, useRef, useState } from 'react';
import type { GenerationJob, GenerationPlanResponse } from '../../shared/generationTypes';
import type { GenerationSourceTargets, GenerationTargetMap } from '../../shared/outputTargetTypes';
import type { LineageNode } from '../../shared/types';
import { api } from '../api';
import { type CanvasTargetSettingsResponse } from './OutputTargetPreferencesDialog';
import './LineageGenerationSheet.css';

type SourceDraft = {
  assetId: string;
  customTargets: Array<{ id: string; height: string; width: string }>;
  counts: Record<string, number>;
  defaultCount: number;
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
  const [surfaceSearch, setSurfaceSearch] = useState('');
  const params = useMemo(() => new URLSearchParams({ project, rootAssetId }).toString(), [project, rootAssetId]);
  const sourceAssetIds = sources.map(source => source.asset_id).join('\0');
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  useEffect(() => {
    let cancelled = false;
    api<CanvasTargetSettingsResponse>(`/api/generation/targets?${params}`).then(result => {
      if (cancelled) return;
      setSettings(result);
      const defaultCount = result.defaults?.default_variant_count ?? 1;
      const defaultSurfaceIds = result.defaults?.targets.flatMap(target => target.kind === 'delivery_surface' ? [`${target.surface_id}@${target.surface_version}`] : []) ?? [];
      const defaultCustomTargets = result.defaults?.targets.flatMap((target, index) => target.kind === 'custom' ? [{
        id: `custom-${index}`,
        width: String(target.width),
        height: String(target.height),
      }] : []) ?? [];
      const defaultUnlocked = result.defaults?.targets.some(target => target.kind === 'unlocked') ?? false;
      setDrafts(sourcesRef.current.map(source => ({
        assetId: source.asset_id,
        customTargets: defaultCustomTargets.map(target => ({ ...target, id: `${source.asset_id}-${target.id}` })),
        counts: Object.fromEntries([
          ...defaultSurfaceIds.map(reference => {
            const target = result.defaults?.targets.find(item => item.kind === 'delivery_surface' && `${item.surface_id}@${item.surface_version}` === reference);
            return [reference, target?.variant_count ?? defaultCount] as const;
          }),
          ...defaultCustomTargets.map((target, index) => {
            const stored = result.defaults?.targets.filter(item => item.kind === 'custom')[index];
            return [`${source.asset_id}-${target.id}`, stored?.variant_count ?? defaultCount] as const;
          }),
          ['unlocked', result.defaults?.targets.find(item => item.kind === 'unlocked')?.variant_count ?? defaultCount],
        ]),
        defaultCount,
        selected: defaultSurfaceIds,
        split: result.defaults?.separate_surface_ids ?? [],
        unlocked: defaultUnlocked,
      })));
    }).catch(reason => !cancelled && setError(reason instanceof Error ? reason.message : String(reason)));
    return () => { cancelled = true; };
  }, [params, sourceAssetIds]);

  function updateDraft(assetId: string, change: (draft: SourceDraft) => SourceDraft) {
    setDrafts(current => current.map(draft => draft.assetId === assetId ? change(draft) : draft));
    setPreview(null);
    setError('');
  }

  function updateSurfaceCount(draft: SourceDraft, surfaceId: string, count: number): SourceDraft {
    if (!settings) return { ...draft, counts: { ...draft.counts, [surfaceId]: count } };
    const [surfaceRecordId, version] = surfaceId.split('@');
    if (draft.split.includes(surfaceRecordId)) {
      return { ...draft, counts: { ...draft.counts, [surfaceId]: count } };
    }
    const surface = settings.registry.surfaces.find(item => item.id === surfaceRecordId && item.version === Number(version));
    const sharedGeometryIds = settings.registry.surfaces
      .filter(item =>
        item.geometry_profile_id === surface?.geometry_profile_id
        && item.geometry_profile_version === surface.geometry_profile_version
        && draft.selected.includes(`${item.id}@${item.version}`)
        && !draft.split.includes(item.id),
      )
      .map(item => `${item.id}@${item.version}`);
    const geometry = settings.registry.geometries.find(item => item.id === surface?.geometry_profile_id && item.version === surface?.geometry_profile_version);
    const sharedCustomIds = draft.customTargets
      .filter(target => Number(target.width) === geometry?.width && Number(target.height) === geometry.height)
      .map(target => target.id);
    return {
      ...draft,
      counts: { ...draft.counts, ...Object.fromEntries([...sharedGeometryIds, ...sharedCustomIds].map(id => [id, count])) },
    };
  }

  function updateDefaultCount(draft: SourceDraft, count: number): SourceDraft {
    const counts = Object.fromEntries(Object.entries(draft.counts).map(([key, value]) => [key, value === draft.defaultCount ? count : value]));
    return { ...draft, counts, defaultCount: count };
  }

  function addCustomTarget(draft: SourceDraft): SourceDraft {
    const id = `${draft.assetId}-custom-${Date.now()}-${draft.customTargets.length}`;
    return {
      ...draft,
      customTargets: [...draft.customTargets, { id, width: '', height: '' }],
      counts: { ...draft.counts, [id]: draft.defaultCount },
    };
  }

  function updateCustomTarget(draft: SourceDraft, id: string, field: 'height' | 'width', value: string): SourceDraft {
    return { ...draft, customTargets: draft.customTargets.map(target => target.id === id ? { ...target, [field]: value } : target) };
  }

  function updateCustomCount(draft: SourceDraft, customId: string, count: number): SourceDraft {
    if (!settings) return { ...draft, counts: { ...draft.counts, [customId]: count } };
    const target = draft.customTargets.find(item => item.id === customId);
    const width = Number(target?.width);
    const height = Number(target?.height);
    const sharedSurfaceIds = draft.selected.filter(reference => {
      const [id, version] = reference.split('@');
      if (draft.split.includes(id)) return false;
      const surface = settings.registry.surfaces.find(item => item.id === id && item.version === Number(version));
      const geometry = settings.registry.geometries.find(item => item.id === surface?.geometry_profile_id && item.version === surface?.geometry_profile_version);
      return geometry?.width === width && geometry.height === height;
    });
    const sharedCustomIds = draft.customTargets.filter(item => Number(item.width) === width && Number(item.height) === height).map(item => item.id);
    return { ...draft, counts: { ...draft.counts, ...Object.fromEntries([...sharedSurfaceIds, ...sharedCustomIds].map(id => [id, count])) } };
  }

  function targetMap(): GenerationTargetMap {
    return {
      schema_version: 'lineage.generation_target_map.v1',
      sources: drafts.map((draft): GenerationSourceTargets => ({
        asset_id: draft.assetId,
        default_variant_count: draft.defaultCount,
        targets: draft.unlocked
          ? [{ kind: 'unlocked', ...(draft.counts.unlocked === draft.defaultCount ? {} : { variant_count: draft.counts.unlocked }) }]
          : [
              ...draft.selected.map(reference => {
                const [surfaceId, version] = reference.split('@');
                const count = draft.counts[reference] ?? draft.defaultCount;
                return {
                  kind: 'delivery_surface' as const,
                  surface_id: surfaceId,
                  surface_version: Number(version),
                  ...(count === draft.defaultCount ? {} : { variant_count: count }),
                };
              }),
              ...draft.customTargets.map(target => {
                const count = draft.counts[target.id] ?? draft.defaultCount;
                return {
                  kind: 'custom' as const,
                  width: Number(target.width),
                  height: Number(target.height),
                  ...(count === draft.defaultCount ? {} : { variant_count: count }),
                };
              }),
            ],
        separate_surface_ids: draft.unlocked ? [] : draft.split.filter(id => draft.selected.some(reference => reference.startsWith(`${id}@`))),
      })),
    };
  }

  const locallyComplete = Boolean(
    prompt.trim()
    && drafts.length === sources.length
    && drafts.every(draft => draft.unlocked
      ? Number.isInteger(draft.counts.unlocked ?? 1) && (draft.counts.unlocked ?? 1) > 0
      : (draft.selected.length > 0 || draft.customTargets.length > 0)
        && Number.isInteger(draft.defaultCount) && draft.defaultCount > 0
        && [...draft.selected, ...draft.customTargets.map(target => target.id)].every(id => Number.isInteger(draft.counts[id] ?? draft.defaultCount) && (draft.counts[id] ?? draft.defaultCount) > 0)
        && draft.customTargets.every(target => target.width !== '' && target.height !== '' && Number.isInteger(Number(target.width)) && Number.isInteger(Number(target.height)))),
  );
  const surfaceGroups = useMemo(() => {
    if (!settings) return [];
    const query = surfaceSearch.trim().toLocaleLowerCase();
    const filtered = settings.registry.surfaces.filter(surface =>
      !query || `${surface.platform} ${surface.surface}`.toLocaleLowerCase().includes(query),
    );
    return [...new Set(filtered.map(surface => surface.platform))].map(platform => ({
      platform,
      surfaces: filtered.filter(surface => surface.platform === platform),
    }));
  }, [settings, surfaceSearch]);

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
        {settings && <label className="lineage-target-search">Search platform or surface<input onChange={event => setSurfaceSearch(event.target.value)} placeholder="Instagram Story" type="search" value={surfaceSearch} /></label>}
        {settings && drafts.map(draft => {
          const source = sources.find(item => item.asset_id === draft.assetId)!;
          return (
            <fieldset className={`lineage-source-targets ${draft.unlocked ? 'is-unlocked' : 'is-locked'}`} key={draft.assetId}>
              <legend>{source.title} <code>{source.asset_id}</code></legend>
              <label className="lineage-explicit-unlock"><input checked={draft.unlocked} onChange={event => updateDraft(draft.assetId, current => ({ ...current, unlocked: event.target.checked }))} type="checkbox" /> Explicitly unlocked</label>
              <label className="lineage-source-default-count">Variants per format<input aria-label={`${source.title} Variants per format`} min={1} onChange={event => updateDraft(draft.assetId, current => updateDefaultCount(current, Number(event.target.value)))} type="number" value={draft.defaultCount} /></label>
              {!draft.unlocked && surfaceGroups.map(group => (
                <section className="lineage-target-platform" key={group.platform}>
                  <h4>{group.platform}</h4>
                  {group.surfaces.map(surface => {
                    const geometry = settings.registry.geometries.find(item => item.id === surface.geometry_profile_id && item.version === surface.geometry_profile_version)!;
                    const reference = `${surface.id}@${surface.version}`;
                    const chosen = draft.selected.includes(reference);
                    const replacement = surface.replacement
                      ? settings.registry.surfaces.find(item => item.id === surface.replacement?.surface_id && item.version === surface.replacement.surface_version)
                      : undefined;
                    return (
                      <div className={`lineage-target-row lifecycle-${surface.lifecycle}`} key={reference}>
                        <label>
                          <input checked={chosen} disabled={surface.lifecycle === 'removed'} onChange={() => updateDraft(draft.assetId, current => ({ ...current, selected: chosen ? current.selected.filter(id => id !== reference) : [...current.selected, reference], counts: chosen ? current.counts : { ...current.counts, [reference]: current.defaultCount } }))} type="checkbox" />
                          {surface.platform} · {surface.surface} <small>{geometry.width} × {geometry.height} · {surface.lifecycle}</small>
                          {surface.lifecycle !== 'active' && <small className="output-target-lifecycle-warning">{replacement ? `Preferred replacement: ${replacement.platform} · ${replacement.surface}` : surface.replacement ? `Replacement: ${surface.replacement.surface_id}@${surface.replacement.surface_version}` : `Historical target is ${surface.lifecycle}`}</small>}
                        </label>
                        {chosen && <label title="Do not consolidate this surface with another selected surface of the same geometry"><input checked={draft.split.includes(surface.id)} onChange={() => updateDraft(draft.assetId, current => ({ ...current, split: current.split.includes(surface.id) ? current.split.filter(id => id !== surface.id) : [...current.split, surface.id] }))} type="checkbox" /> Create separate variants</label>}
                      </div>
                    );
                  })}
                </section>
              ))}
              {!draft.unlocked && surfaceGroups.length === 0 && <p>No platform surfaces match “{surfaceSearch}”.</p>}
              {!draft.unlocked && (
                <section className="lineage-custom-targets">
                  <div><h4>Custom dimensions</h4><button onClick={() => updateDraft(draft.assetId, addCustomTarget)} type="button">Add custom size</button></div>
                  {draft.customTargets.map((target, index) => (
                    <div className="lineage-custom-target-row" key={target.id}>
                      <label>Width<input aria-label={`${source.title} custom size ${index + 1} width`} onChange={event => updateDraft(draft.assetId, current => updateCustomTarget(current, target.id, 'width', event.target.value))} type="number" value={target.width} /></label>
                      <span>×</span>
                      <label>Height<input aria-label={`${source.title} custom size ${index + 1} height`} onChange={event => updateDraft(draft.assetId, current => updateCustomTarget(current, target.id, 'height', event.target.value))} type="number" value={target.height} /></label>
                      <button aria-label={`Remove ${source.title} custom size ${index + 1}`} onClick={() => updateDraft(draft.assetId, current => ({ ...current, customTargets: current.customTargets.filter(item => item.id !== target.id) }))} type="button">Remove</button>
                    </div>
                  ))}
                </section>
              )}
              <details className="lineage-advanced-counts">
                <summary>Advanced per-group counts</summary>
                {draft.unlocked && <label>Unlocked output count <input aria-label={`${source.title} unlocked count`} min={1} onChange={event => updateDraft(draft.assetId, current => ({ ...current, counts: { ...current.counts, unlocked: Number(event.target.value) } }))} type="number" value={draft.counts.unlocked ?? draft.defaultCount} /></label>}
                {!draft.unlocked && draft.selected.map(reference => {
                  const [id, version] = reference.split('@');
                  const surface = settings.registry.surfaces.find(item => item.id === id && item.version === Number(version))!;
                  return <label key={reference}>{surface.platform} · {surface.surface}<input aria-label={`${source.title} ${surface.surface} count`} min={1} onChange={event => updateDraft(draft.assetId, current => updateSurfaceCount(current, reference, Number(event.target.value)))} type="number" value={draft.counts[reference] ?? draft.defaultCount} /></label>;
                })}
                {!draft.unlocked && draft.customTargets.map((target, index) => <label key={target.id}>Custom {target.width || '?'} × {target.height || '?'}<input aria-label={`${source.title} custom size ${index + 1} count`} min={1} onChange={event => updateDraft(draft.assetId, current => updateCustomCount(current, target.id, Number(event.target.value)))} type="number" value={draft.counts[target.id] ?? draft.defaultCount} /></label>)}
              </details>
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
