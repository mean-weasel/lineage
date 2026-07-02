import { defaultProject, listProjects } from './assetCore';
import { chooseReviewSetLabels, labelsFromPrompt } from './assetSelections';
import { getAssetSelectionAgentHandoff, getContentQueueNextAgentHandoff, getContentTargetAgentHandoff, getLineageWorkspaceAgentHandoff } from './contentAgentHandoff';
import type { ContentAgentHandoff, ContentAgentHandoffNaturalLanguage, ContentAgentResolvedHandoff } from '../shared/types';

const assetSelectionTerms = [
  'my selections',
  'my selected assets',
  'selected assets',
  'selected images',
  'images i picked',
  'assets i picked',
  'keep working on my selections',
  'work on my selections',
  'continue my selections',
];
const variationChoiceTerms = [
  'i like',
  'i choose',
  'choose variation',
  'select variation',
  'pick variation',
  'use variation',
];
const lineageWorkspaceTerms = [
  'active lineage',
  'current lineage',
  'lineage workspace',
  'selected lineage',
  'selected lineage workspace',
  'this lineage',
  'work on my lineage',
  'keep working on my selected lineage workspace',
  'keep working on the selected lineage',
  'continue the lineage workspace',
];
const selectedTerms = [
  'selected',
  'selection',
  'chosen',
  'current target',
  'selected target',
  'target i picked',
  'what i picked',
  'user selected',
  'human selected',
];
const nextTerms = [
  'next actionable',
  'next action',
  'next queue',
  'queue next',
  'continue next',
  'work on next',
  'what should i work on',
  'needs work',
  'ready to work',
];
const blockedTerms = [
  'post externally',
  'publish',
  'schedule on',
  'post to tiktok',
  'post to linkedin',
  'post to instagram',
  'post to facebook',
  'tweet',
  'delete everything',
];
const defaultDoNotModify = [
  'external social platforms',
  'unrelated projects',
  'posted or archived content unless explicitly requested',
];

function normalizePrompt(prompt: string): string {
  return prompt.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function aliasFor(project: string): string[] {
  const compact = project.replace(/-/g, ' ');
  return [
    project,
    compact,
    compact.replace(/\bapp\b/g, '').trim(),
    project.replace(/-that-shit$/, ''),
  ].filter(Boolean);
}

function resolveProject(prompt: string, fallbackProject: string): { alias: string | null; project: string } {
  const normalized = normalizePrompt(prompt);
  for (const item of listProjects()) {
    const aliases = [...aliasFor(item.project), ...aliasFor(item.product)];
    const match = aliases.find(alias => normalized.includes(normalizePrompt(alias)));
    if (match) return { alias: match, project: item.project };
  }
  return { alias: null, project: fallbackProject || defaultProject };
}

function matchedTerms(normalized: string, terms: string[]): string[] {
  return terms.filter(term => normalized.includes(normalizePrompt(term)));
}

function unresolved(
  project: string,
  prompt: string,
  natural: Omit<ContentAgentHandoffNaturalLanguage, 'normalized_prompt' | 'prompt'>,
  status: ContentAgentHandoff['status'],
  level: 'question' | 'error',
  text: string,
): ContentAgentResolvedHandoff {
  return {
    context: { notes: [], related_assets: [], selected_target: null },
    guardrails: { do_not_modify: defaultDoNotModify, requires_confirmation: true, safe_to_start: false, write_scope: [] },
    intent: { project, resolved: 'content.handoff.unresolved', selection_mode: 'unresolved' },
    messages: [{ level, text }],
    natural_language: { ...natural, normalized_prompt: normalizePrompt(prompt), prompt },
    next_action: null,
    schema_version: 'asset_studio.agent_handoff.v1',
    status,
    target: null,
  };
}

function withNatural(handoff: ContentAgentHandoff, natural: ContentAgentHandoffNaturalLanguage): ContentAgentResolvedHandoff {
  return { ...handoff, natural_language: natural };
}

export function resolveContentAgentHandoff(prompt: string, fallbackProject = defaultProject): ContentAgentResolvedHandoff {
  const normalized = normalizePrompt(prompt);
  const { alias, project } = resolveProject(prompt, fallbackProject);
  if (!normalized) {
    return unresolved(project, prompt, { matched_intent: 'empty', matched_terms: [], project_alias: alias }, 'needs_clarification', 'question', 'Describe whether you want the selected target or the next actionable content item.');
  }

  const blocked = matchedTerms(normalized, blockedTerms);
  if (blocked.length > 0) {
    return unresolved(project, prompt, { matched_intent: 'blocked', matched_terms: blocked, project_alias: alias }, 'blocked', 'error', 'This resolver only prepares local Asset Studio handoffs. It will not post, publish, schedule, or modify external platforms.');
  }

  const variationChoice = matchedTerms(normalized, variationChoiceTerms);
  const labels = labelsFromPrompt(prompt);
  if (variationChoice.length > 0 && labels.length > 0) {
    chooseReviewSetLabels(project, { confirmWrite: true, labels, selectedBy: 'human' });
    return withNatural(getAssetSelectionAgentHandoff(project), {
      matched_intent: 'asset.selection.choose_variations',
      matched_terms: [...variationChoice, ...labels],
      normalized_prompt: normalized,
      project_alias: alias,
      prompt,
    });
  }

  const lineageWorkspace = matchedTerms(normalized, lineageWorkspaceTerms);
  if (lineageWorkspace.length > 0) {
    return withNatural(getLineageWorkspaceAgentHandoff(project), {
      matched_intent: 'lineage.workspace.active',
      matched_terms: lineageWorkspace,
      normalized_prompt: normalized,
      project_alias: alias,
      prompt,
    });
  }

  const assetSelection = matchedTerms(normalized, assetSelectionTerms);
  if (assetSelection.length > 0) {
    const lineageHandoff = getLineageWorkspaceAgentHandoff(project);
    if (lineageHandoff.status === 'ok' && lineageHandoff.guardrails.safe_to_start) {
      return withNatural(lineageHandoff, {
        matched_intent: 'lineage.workspace.active',
        matched_terms: assetSelection,
        normalized_prompt: normalized,
        project_alias: alias,
        prompt,
      });
    }
    return withNatural(getAssetSelectionAgentHandoff(project), {
      matched_intent: 'asset.selection.current',
      matched_terms: assetSelection,
      normalized_prompt: normalized,
      project_alias: alias,
      prompt,
    });
  }

  const selected = matchedTerms(normalized, selectedTerms);
  const next = matchedTerms(normalized, nextTerms);
  if (selected.length > 0 && next.length > 0) {
    return unresolved(project, prompt, { matched_intent: 'ambiguous', matched_terms: [...selected, ...next], project_alias: alias }, 'needs_clarification', 'question', 'This prompt mentions both selected-target and next-action work. Ask for one of those explicitly.');
  }
  if (selected.length > 0) {
    return withNatural(getContentTargetAgentHandoff(project), { matched_intent: 'content.target.selected', matched_terms: selected, normalized_prompt: normalized, project_alias: alias, prompt });
  }
  if (next.length > 0 || normalized.includes('continue content')) {
    return withNatural(getContentQueueNextAgentHandoff(project), { matched_intent: 'content.queue.next', matched_terms: next, normalized_prompt: normalized, project_alias: alias, prompt });
  }

  return unresolved(project, prompt, { matched_intent: 'unsupported', matched_terms: [], project_alias: alias }, 'needs_clarification', 'question', 'I could not resolve this prompt. Ask for the selected target or the next actionable content item.');
}
