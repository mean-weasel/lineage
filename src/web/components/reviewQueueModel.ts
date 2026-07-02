import type { ReviewQueueSnapshot } from '../../shared/types';

export function defaultOpenReviewLane(lanes: ReviewQueueSnapshot['lanes']) {
  return lanes.find(lane => laneReviewTotal(lane) > 0)?.channel || lanes[0]?.channel;
}

function laneReviewTotal(lane: ReviewQueueSnapshot['lanes'][number]) {
  return lane.totals.needsQa + lane.totals.approvedLocal + lane.totals.needsRevision + lane.totals.rejectedLocal;
}
