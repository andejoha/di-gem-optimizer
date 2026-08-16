import { describe, expect, it } from 'vitest';
import { COST_1STAR, COST_2STAR, COST_5STAR } from '../data';
import {
  computeBaseResonance,
  computeContribution,
  computeExtractablePower,
  computeSocketResonanceBonus,
  isSocketUnlocked,
  numSocketsUnlocked,
} from '../rules';

// Expected values below are captured directly from a live run of
// backend/app/core/rules.py against the same tables (see the command in the
// Phase 1 commit message / PR description for exact invocations).

describe('numSocketsUnlocked', () => {
  it('5-star: unlocks at ranks 3,4,5,6,7', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((r) => numSocketsUnlocked(String(r), 5))).toEqual([
      0, 0, 0, 1, 2, 3, 4, 5,
    ]);
  });

  it('2-star: unlocks at ranks 3,5,7', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((r) => numSocketsUnlocked(String(r), 2))).toEqual([
      0, 0, 0, 1, 1, 2, 2, 3,
    ]);
  });

  it('1-star: unlocks at ranks 3,7', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((r) => numSocketsUnlocked(String(r), 1))).toEqual([
      0, 0, 0, 1, 1, 1, 1, 2,
    ]);
  });

  it('truncates sub-ranks to the major rank', () => {
    expect(numSocketsUnlocked('4.9', 5)).toBe(2);
  });

  it('returns 0 for unparseable rank strings (mirrors Python ValueError -> 0)', () => {
    expect(numSocketsUnlocked('not-a-rank', 5)).toBe(0);
    expect(numSocketsUnlocked('', 5)).toBe(0);
  });
});

describe('isSocketUnlocked', () => {
  it('matches numSocketsUnlocked threshold', () => {
    expect(isSocketUnlocked(0, '3', 5)).toBe(true);
    expect(isSocketUnlocked(1, '3', 5)).toBe(false);
    expect(isSocketUnlocked(4, '7', 5)).toBe(true);
  });
});

describe('computeExtractablePower', () => {
  it('returns cumulative required_gem_power for the rank', () => {
    expect(computeExtractablePower('5', COST_5STAR)).toBe(475);
  });

  it('returns 0 for rank 1 (no GP invested yet)', () => {
    expect(computeExtractablePower('1', COST_1STAR)).toBe(0);
  });

  it('returns 0 for an unknown rank', () => {
    expect(computeExtractablePower('99', COST_5STAR)).toBe(0);
  });
});

describe('computeContribution', () => {
  it('5-star rank 5: requiredGems(8) * BASE_POWER(32) + requiredGemPower(475) = 731', () => {
    expect(computeContribution(5, '5', COST_5STAR)).toBe(731);
  });

  it('2-star rank 6.2: requiredGems(11) * BASE_POWER(4) + requiredGemPower(180) = 224', () => {
    expect(computeContribution(2, '6.2', COST_2STAR)).toBe(224);
  });

  it('throws for an unknown rank, matching the Python ValueError message shape', () => {
    expect(() => computeContribution(5, '99', COST_5STAR)).toThrow(
      /Rank '99' not found in upgrade cost table\. Available ranks: \[/,
    );
  });
});

describe('computeBaseResonance', () => {
  it('5-star rank 7 at 4 active stars', () => {
    expect(computeBaseResonance('7', 4, 5)).toBe(630);
  });

  it('1-star rank 5 (active_stars ignored)', () => {
    expect(computeBaseResonance('5', 1, 1)).toBe(75);
  });

  it('returns 0 for an unknown rank', () => {
    expect(computeBaseResonance('99', 5, 5)).toBe(0);
  });
});

describe('computeSocketResonanceBonus', () => {
  it('5-star, 5 active stars: 11 * integerRank', () => {
    expect(computeSocketResonanceBonus(5, 5, '8.3')).toBe(88);
  });

  it('5-star, 4 active stars: 10 * integerRank', () => {
    expect(computeSocketResonanceBonus(5, 4, '8.3')).toBe(80);
  });

  it('2-star: 2 * integerRank', () => {
    expect(computeSocketResonanceBonus(2, 2, '7')).toBe(14);
  });

  it('1-star: 1 * integerRank', () => {
    expect(computeSocketResonanceBonus(1, 1, '9')).toBe(9);
  });
});
