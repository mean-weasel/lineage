import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { LineageBriefResponse, LineageNode } from '../../shared/types';
import { LineageHandoffPanel } from './LineageHandoffPanel';

function flattenText(node: ReactNode): string {
  if (!node || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join('');
  const element = node as ReactElement<{ children?: ReactNode }>;
  return flattenText(element.props?.children);
}

const nextBase = {
  asset_id: 'local-selected-base',
  channel: 'tiktok',
  is_latest: true,
  media_type: 'image',
  project: 'bleep-that-shit',
  review_state: 'approved',
  source: 'local',
  status: 'working',
  title: 'Chosen asset',
  user_selected: true,
} satisfies LineageNode;

const branchBase = {
  ...nextBase,
  asset_id: 'local-branch-base',
  is_latest: false,
  title: 'Branch base',
} satisfies LineageNode;

const brief = {
  brief: {
    objective: 'Create a stronger vertical variation.',
    prompt: 'Keep working from Chosen asset.',
    reference_asset_id: 'local-selected-base',
    reference_asset_ids: ['local-selected-base'],
    title: 'Continue from chosen asset',
  },
  fetchedAt: '2026-06-27T00:00:00.000Z',
  handoff: {
    inspect_command: 'npm run studio:cli -- lineage inspect local-root',
    link_child_command: 'npm run studio:cli -- lineage link-child local-root',
    next_command: 'npm run studio:cli -- lineage next --project bleep-that-shit --root local-root --json',
  },
  latest: ['local-selected-base'],
  next_asset: nextBase,
  next_assets: [nextBase],
  project: 'bleep-that-shit',
  reason: 'user_selected',
  recommended_action: 'evolve_variations',
  root_asset_id: 'local-root',
  selection: {
    asset_id: 'local-selected-base',
    notes: 'Best direction',
    position: 0,
    selected_at: '2026-06-27T00:00:00.000Z',
  },
  selection_mode: 'single',
  selections: [{
    asset_id: 'local-selected-base',
    notes: 'Best direction',
    position: 0,
    selected_at: '2026-06-27T00:00:00.000Z',
  }],
  strategy: 'selected',
  warnings: [],
} satisfies LineageBriefResponse;

describe('LineageHandoffPanel', () => {
  it('names the chosen variation source and exposes the exact CLI handoff', () => {
    const panel = LineageHandoffPanel({
      brief,
      nextBase,
      onRefreshBrief: () => undefined,
      onToast: () => undefined,
      project: 'bleep-that-shit',
      rootAssetId: 'local-root',
    });
    const text = flattenText(panel);

    expect(text).toContain('Agent will evolve');
    expect(text).toContain('Chosen asset (local-selected-base)');
    expect(text).toContain('npm run studio:cli -- lineage next --project bleep-that-shit --root local-root --json');
    expect(text).toContain('Generated brief');
    expect(text).toContain('Keep working from Chosen asset.');
  });

  it('warns when the chosen asset branches from an older lineage node', () => {
    const panel = LineageHandoffPanel({
      brief: null,
      nextBase: branchBase,
      onRefreshBrief: () => undefined,
      onToast: () => undefined,
      project: 'bleep-that-shit',
      rootAssetId: 'local-root',
    });

    expect(flattenText(panel)).toContain('Branch from here: this asset is not a latest leaf.');
  });
});
