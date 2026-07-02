import { describe, expect, it } from 'vitest';
import type { ReviewQueueSnapshot } from '../../shared/types';
import { defaultOpenReviewLane } from './reviewQueueModel';

type Lane = ReviewQueueSnapshot['lanes'][number];

describe('defaultOpenReviewLane', () => {
  it('opens the first channel that has local review work', () => {
    expect(defaultOpenReviewLane([
      lane('linkedin', { needsQa: 0, approvedLocal: 0, needsRevision: 0, rejectedLocal: 0 }),
      lane('tiktok', { needsQa: 2, approvedLocal: 0, needsRevision: 0, rejectedLocal: 0 }),
    ])).toBe('tiktok');
  });

  it('falls back to the first channel when no local review work is queued', () => {
    expect(defaultOpenReviewLane([lane('linkedin'), lane('tiktok')])).toBe('linkedin');
  });
});

function lane(channel: string, totals: Partial<Lane['totals']> = {}): Lane {
  return {
    approvedLocal: [],
    channel,
    needsQa: [],
    needsRevision: [],
    posted: [],
    readyToPost: [],
    rejectedLocal: [],
    scheduled: [],
    totals: {
      approvedLocal: totals.approvedLocal || 0,
      needsQa: totals.needsQa || 0,
      needsRevision: totals.needsRevision || 0,
      posted: 0,
      readyToPost: 0,
      rejectedLocal: totals.rejectedLocal || 0,
      scheduled: 0,
    },
  };
}
