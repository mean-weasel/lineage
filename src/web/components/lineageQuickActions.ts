import type { LineageNode, LineageTask } from '../../shared/types';

export function quickActionState(node: LineageNode, selectionFull: boolean) {
  const branchLocked = taskIsLocked(node.lineage_tasks?.iterate);
  const rerollLocked = taskIsLocked(node.lineage_tasks?.reroll);
  const rerollSelected = node.reroll_request?.status === 'pending';
  return {
    branchDisabled: branchLocked || (!node.user_selected && selectionFull),
    branchLocked,
    branchTitle: branchLocked
      ? 'An agent is working on this branch task. Manage it in the task queue.'
      : !node.user_selected && selectionFull
        ? 'The branch selection is full.'
        : node.user_selected ? 'Remove from the next branch (B)' : 'Use as a base for the next branch (B)',
    rerollDisabled: rerollLocked,
    rerollLocked,
    rerollSelected,
    rerollTitle: rerollLocked
      ? 'An agent is working on this re-roll. Manage it in the task queue.'
      : rerollSelected ? 'Remove from the re-roll queue (R)' : 'Add to the re-roll queue (R)',
  };
}

function taskIsLocked(task?: LineageTask): boolean {
  return task?.status === 'claimed' || task?.status === 'in_progress';
}
