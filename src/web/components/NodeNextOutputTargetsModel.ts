import type {
  EffectiveNodeNextOutputTargets,
  NodeNextOutputTargetSetting,
} from '../../shared/outputTargetTypes';
import { api } from '../api';

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
