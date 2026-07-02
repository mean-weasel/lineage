import type { AssetReviewState, LineageNode } from '../../shared/types';

export function lineageReviewConflict(node: LineageNode | undefined, reviewState: AssetReviewState) {
  if (!node?.user_selected || (reviewState !== 'rejected' && reviewState !== 'ignored')) return null;
  return {
    confirmation: `${node.title} is being used for next variation. Marking it ${reviewState} will remove it from next variation.`,
    clearsSelection: true,
  };
}
