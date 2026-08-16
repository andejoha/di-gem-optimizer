import { describe, expect, it } from 'vitest';
import { getMaxSubRank } from './rankUtils';

// Pins the cost-table-derived MAX_SUB_RANK against the original hand-written
// literal it replaced, so a future cost-table change can't silently drift
// the rank/sub-rank UI without a test noticing.
const EXPECTED: Record<number, Record<number, number>> = {
  2: { 4: 1, 5: 4, 6: 4, 7: 5, 8: 8, 9: 11 },
  5: { 4: 4, 5: 5, 6: 11, 7: 11, 8: 17, 9: 17 },
};

describe('getMaxSubRank', () => {
  it('matches the original hand-written literal for every known (star, rank) pair', () => {
    for (const [star, byRank] of Object.entries(EXPECTED)) {
      for (const [rank, expected] of Object.entries(byRank)) {
        expect(getMaxSubRank(Number(star), Number(rank))).toBe(expected);
      }
    }
  });

  it('returns 0 for ranks with no sub-ranks', () => {
    expect(getMaxSubRank(5, 10)).toBe(0);
    expect(getMaxSubRank(2, 1)).toBe(0);
  });
});
