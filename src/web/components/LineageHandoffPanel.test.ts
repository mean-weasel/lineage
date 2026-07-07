import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LineageBriefResponse, LineageNode } from '../../shared/types';
import { LineageHandoffPanel } from './LineageHandoffPanel';

function flattenText(node: ReactNode): string {
  if (!node || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join('');
  const element = node as ReactElement<{ children?: ReactNode }>;
  return flattenText(element.props?.children);
}

function collectButtons(node: ReactNode): ReactElement[] {
  if (!node || typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return [];
  if (Array.isArray(node)) return node.flatMap(collectButtons);
  const element = node as ReactElement<{ children?: ReactNode; type?: string }>;
  const children = collectButtons(element.props?.children);
  return element.type === 'button' ? [element, ...children] : children;
}

function clickButton(node: ReactNode, label: string): Promise<void> | void {
  const button = collectButtons(node).find(item => flattenText(item).includes(label));
  expect(button, `Missing button ${label}`).toBeTruthy();
  return button?.props.onClick?.();
}

const nextBase = {
  asset_id: 'local-selected-base',
  channel: 'tiktok',
  is_latest: true,
  media_type: 'image',
  project: 'demo-project',
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
    inspect_command: 'npx @mean-weasel/lineage inspect --project demo-project --asset-id local-selected-base --db /tmp/lineage.sqlite --json',
    link_child_command: 'npx @mean-weasel/lineage link-child --project demo-project --root local-root --child <asset-id> --confirm-write --db /tmp/lineage.sqlite --json',
    next_command: 'npx @mean-weasel/lineage next --project demo-project --root local-root --db /tmp/lineage.sqlite --json',
  },
  latest: ['local-selected-base'],
  next_asset: nextBase,
  next_assets: [nextBase],
  project: 'demo-project',
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('LineageHandoffPanel', () => {
  it('names the chosen variation source and exposes the exact CLI handoff', () => {
    const panel = LineageHandoffPanel({
      brief,
      nextBase,
      onRefreshBrief: () => undefined,
      onToast: () => undefined,
      project: 'demo-project',
      rootAssetId: 'local-root',
    });
    const text = flattenText(panel);

    expect(text).toContain('Agent will evolve');
    expect(text).toContain('Chosen asset (local-selected-base)');
    expect(text).toContain('npx @mean-weasel/lineage next --project demo-project --root local-root --db /tmp/lineage.sqlite --json');
    expect(text).toContain('Generated brief');
    expect(text).toContain('Keep working from Chosen asset.');
  });

  it('warns when the chosen asset branches from an older lineage node', () => {
    const panel = LineageHandoffPanel({
      brief: null,
      nextBase: branchBase,
      onRefreshBrief: () => undefined,
      onToast: () => undefined,
      project: 'demo-project',
      rootAssetId: 'local-root',
    });

    expect(flattenText(panel)).toContain('Branch from here: this asset is not a latest leaf.');
  });

  it('exposes re-roll queue handoff without child-link language', async () => {
    const copied: string[] = [];
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async (text: string) => { copied.push(text); }) } });
    const rerollTarget = {
      ...nextBase,
      asset_id: 'local-reroll-target',
      reroll_request: {
        id: 'reroll-1',
        project_id: 'demo-project',
        root_asset_id: 'local-root',
        node_asset_id: 'local-reroll-target',
        status: 'pending',
        requested_by: 'human',
        notes: 'Fix warped text',
        created_at: '2026-07-07T00:00:00.000Z',
      },
    } satisfies LineageNode;
    const panel = LineageHandoffPanel({
      brief: null,
      nextBase,
      onRefreshBrief: () => undefined,
      onToast: () => undefined,
      project: 'demo-project',
      rerollTargets: [rerollTarget],
      rootAssetId: 'local-root',
    });

    const text = flattenText(panel);
    expect(text).toContain('Re-roll queue');
    expect(text).toContain('npx @mean-weasel/lineage reroll list --project demo-project --root local-root --json');
    expect(text).toContain('do not link them as lineage children');
    await clickButton(panel, 'Copy queue');
    expect(copied[0]).toContain('Do not use link-child for re-roll outputs.');
    expect(copied[0]).toContain('local-reroll-target');
  });

  it('creates a lineage workspace claim only when copying the claim-aware handoff', async () => {
    const copied: string[] = [];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        claim: {
          expires_at: '2026-06-27T00:20:00.000Z',
          id: 'claim_test',
          target_id: 'demo-project:lineage-workspace:local-root',
        },
        claim_token: 'claim_test.secret_123',
      }),
    });
    const writeText = vi.fn(async (text: string) => { copied.push(text); });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const toasts: string[] = [];
    const panel = LineageHandoffPanel({
      brief,
      nextBase,
      onRefreshBrief: () => undefined,
      onToast: (_type, message) => { toasts.push(message); },
      project: 'demo-project',
      rootAssetId: 'local-root',
    });

    expect(flattenText(panel)).not.toContain('claim_test.secret_123');
    await clickButton(panel, 'Copy claim handoff');

    expect(fetchMock).toHaveBeenCalledWith('/api/agent-claims', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        agentName: 'Copied Lineage handoff',
        channel: 'tiktok',
        project: 'demo-project',
        scopeType: 'lineage_workspace',
        targetId: 'demo-project:lineage-workspace:local-root',
        targetTitle: 'Chosen asset lineage',
        ttl: '20m',
      }),
    }));
    expect(copied).toHaveLength(1);
    expect(copied[0]).toContain("export LINEAGE_CLAIM_TOKEN='claim_test.secret_123'");
    expect(copied[0]).toContain('npx @mean-weasel/lineage agent heartbeat --claim-token "$LINEAGE_CLAIM_TOKEN" --db /tmp/lineage.sqlite --json');
    expect(copied[0]).toContain('npx @mean-weasel/lineage link-child --project demo-project --root local-root --child <asset-id> --confirm-write --db /tmp/lineage.sqlite --claim-token "$LINEAGE_CLAIM_TOKEN" --json');
    expect(toasts).toContain('Copied claim-aware handoff for claim_test');
  });
});
