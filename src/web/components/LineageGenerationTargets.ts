import type { GenerationJob } from '../../shared/generationTypes';
import type { LineageSnapshot } from '../../shared/types';
import {
  nodeTargetStateLabel,
  type NodeNextOutputTargetsResponse,
} from './NodeNextOutputTargetsModel';

export function decorateSnapshotWithGenerationTargets(
  snapshot: LineageSnapshot,
  jobs: GenerationJob[],
  nodeTargets: Record<string, NodeNextOutputTargetsResponse> = {},
): LineageSnapshot {
  return {
    ...snapshot,
    nodes: snapshot.nodes.map(node => {
      const job = jobs.find(item =>
        item.inputs.some(input => input.asset_id === node.asset_id)
        || item.outputs.some(output => output.imported_asset_id === node.asset_id),
      );
      const plan = job?.target_plan;
      const nextTarget = nodeTargets[node.asset_id];
      const nextOutputTarget = nextTarget ? {
        dimensions: nextTarget.effective.resolved_targets.map(target => `${target.width}×${target.height}`),
        label: nodeTargetStateLabel(nextTarget.effective),
        origin: nextTarget.effective.origin,
      } : undefined;
      if (!job || !plan) return nextOutputTarget ? { ...node, next_output_target: nextOutputTarget } : node;
      const importedOutput = job.outputs.find(output => output.imported_asset_id === node.asset_id);
      const slot = importedOutput ? plan.slots.find(item => item.output_index === importedOutput.output_index) : undefined;
      const group = slot
        ? plan.groups.find(item => item.id === slot.group_id)
        : plan.groups.find(item => item.parent_asset_id === node.asset_id);
      if (!group) return nextOutputTarget ? { ...node, next_output_target: nextOutputTarget } : node;
      return {
        ...node,
        generation_target: {
          destinations: group.delivery_surfaces.map(surface => `${surface.platform} ${surface.surface}`),
          ...(group.unlocked ? {} : { dimensions: `${group.width}×${group.height}` }),
          imported: Boolean(importedOutput),
          locked: !group.unlocked,
        },
        ...(nextOutputTarget ? { next_output_target: nextOutputTarget } : {}),
      };
    }),
  };
}
