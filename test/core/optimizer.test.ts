/**
 * Tests redistributeForBonuses and its helpers (totalResidualFor,
 * maxBonusesForOwned) in core/optimizer.ts directly, with no dependency on
 * any worker/UI layer.
 *
 * Known reference values:
 *   5-star rank "1"  contribution = 32
 *   5-star rank "3"  contribution = 189
 *   5-star rank "5"  contribution = 731
 *   5-star rank "6"  requiredPower = 850, numSockets = 4
 *   5-star rank "7"  requiredPower = 1575, numSockets = 5
 *   2-star rank "1"  contribution = 4
 *   2-star rank "7"  requiredPower = 235, numSockets = 3
 */

import { describe, expect, it } from 'vitest';
import { COST_2STAR, COST_5STAR } from '../../src/core/data';
import type { InventoryGem, MainGem } from '../../src/core/models';
import { makeInventoryGem } from '../../src/core/models';
import { type CopyEntry, dormantPowerFor, maxBonusesForOwned, redistributeForBonuses, totalResidualFor } from '../../src/core/optimizer';
import { runPipeline } from '../../src/core/pipeline';
import { computeContribution, numSocketsUnlocked } from '../../src/core/rules';

function inv(gemId: number, star: number, rank: string, activeStars = 2): InventoryGem {
  const table = star === 2 ? COST_2STAR : COST_5STAR;
  return makeInventoryGem({
    gemId,
    starRating: star,
    rank,
    quantity: 1,
    activeStars,
    contribution: computeContribution(star, rank, table),
  });
}

function main(slot: string, gemId: number, star: number, rank: string, activeStars = 2): MainGem {
  const tbl = star === 5 ? COST_5STAR : star === 2 ? COST_2STAR : COST_2STAR;
  return {
    slotName: slot,
    gemId,
    starRating: star,
    targetRank: rank,
    requiredPower: tbl.get(rank)!.requiredGemPower,
    numSockets: numSocketsUnlocked(rank, star),
    activeStars,
  };
}

function perSlot(entries: Record<string, CopyEntry[]>): Map<string, CopyEntry[]> {
  return new Map(Object.entries(entries));
}

function bonusMap(entries: Record<number, number[]>): Map<number, number[]> {
  return new Map(Object.entries(entries).map(([k, v]) => [Number(k), v]));
}

describe('totalResidualFor', () => {
  it('5-star main residual is offset by socketed contribution', () => {
    const mg = main('head', 5001, 5, '6'); // requiredPower=850
    const gem = inv(5002, 5, '1'); // contribution=32
    expect(totalResidualFor([mg], perSlot({ head: [[0, gem]] }))).toBe(Math.max(0, 850 - 32));
  });

  it('2-star main residual is always requiredPower regardless of socketed gems', () => {
    const mg = main('head', 2001, 2, '7'); // requiredPower=235
    const gem = inv(2003, 2, '7'); // contribution=291
    expect(totalResidualFor([mg], perSlot({ head: [[0, gem]] }))).toBe(235);
  });

  it('5-star main with no gems has residual equal to requiredPower', () => {
    const mg = main('head', 5001, 5, '6');
    expect(totalResidualFor([mg], perSlot({ head: [] }))).toBe(850);
  });

  it('5-star main residual floors at zero when contribution exceeds requiredPower', () => {
    const mg = main('head', 5001, 5, '6'); // requiredPower=850
    const gem = inv(5002, 5, '7'); // contribution=2407 >> 850
    expect(totalResidualFor([mg], perSlot({ head: [[0, gem]] }))).toBe(0);
  });
});

describe('dormantPowerFor', () => {
  it('only copies absent from ownedCopyIds contribute extractable gem power', () => {
    const owned = inv(5002, 5, '1'); // requiredGemPower=0 -> extractable 0
    const unownedA = inv(9999, 5, '5'); // requiredGemPower=475
    const unownedB = inv(9998, 5, '6'); // requiredGemPower=850
    const allCopies: CopyEntry[] = [
      [0, owned],
      [1, unownedA],
      [2, unownedB],
    ];
    expect(dormantPowerFor(allCopies, new Set([0]))).toBe(475 + 850);
  });

  it('is zero when all copies are owned', () => {
    const gem = inv(5002, 5, '6');
    expect(dormantPowerFor([[0, gem]], new Set([0]))).toBe(0);
  });
});

describe('maxBonusesForOwned', () => {
  it('gem with no bonus requirements yields 0 regardless of owned gems', () => {
    const mg = main('head', 5001, 5, '6');
    const bonusTable = bonusMap({ 5001: [0, 0, 0, 0, 0] });
    const gem = inv(5002, 5, '1');
    expect(maxBonusesForOwned(mg, [[0, gem]], bonusTable)).toBe(0);
  });

  it('a single exact gemId match activates one bonus', () => {
    const mg = main('head', 5001, 5, '6'); // 4 sockets; socket 3 is 5-star
    const bonusTable = bonusMap({ 5001: [0, 0, 0, 5002, 0] });
    const gem = inv(5002, 5, '1');
    expect(maxBonusesForOwned(mg, [[0, gem]], bonusTable)).toBe(1);
  });

  it('requirement present but no owned gem with that gemId -> 0 bonuses', () => {
    const mg = main('head', 5001, 5, '6');
    const bonusTable = bonusMap({ 5001: [0, 0, 0, 5002, 0] });
    const gem = inv(5003, 5, '1'); // gemId=5003, not 5002
    expect(maxBonusesForOwned(mg, [[0, gem]], bonusTable)).toBe(0);
  });

  it('two sockets require the same gemId; owning one copy -> only 1 bonus', () => {
    const mg = main('head', 5001, 5, '7'); // 5 sockets
    const bonusTable = bonusMap({ 5001: [0, 0, 0, 5002, 5002] });
    const gem = inv(5002, 5, '1');
    expect(maxBonusesForOwned(mg, [[0, gem]], bonusTable)).toBe(1);
  });

  it('two sockets require the same gemId; owning two copies -> 2 bonuses', () => {
    const mg = main('head', 5001, 5, '7');
    const bonusTable = bonusMap({ 5001: [0, 0, 0, 5002, 5002] });
    const gemA = inv(5002, 5, '1');
    const gemB = inv(5002, 5, '3'); // different rank, same gemId
    expect(
      maxBonusesForOwned(
        mg,
        [
          [0, gemA],
          [1, gemB],
        ],
        bonusTable,
      ),
    ).toBe(2);
  });
});

describe('redistributeForBonuses -- swap activates more bonuses (feasible)', () => {
  it('cross-main swap of equal-contribution 5-star gems unlocks 2 new bonuses', () => {
    const mgA = main('head', 5001, 5, '6');
    const mgB = main('chest', 5002, 5, '6');

    const inv5001Type = inv(5001, 5, '1'); // contribution=32
    const inv5002Type = inv(5002, 5, '1'); // contribution=32

    const per = perSlot({
      head: [[0, inv5001Type]], // mg_a holds the 5001-type -> no bonus (needs 5002)
      chest: [[1, inv5002Type]], // mg_b holds the 5002-type -> no bonus (needs 5001)
    });
    const bonusTable = bonusMap({ 5001: [0, 0, 0, 5002, 0], 5002: [0, 0, 0, 5001, 0] });
    const availablePower = 5000;
    const allCopies: CopyEntry[] = [
      [0, inv5001Type],
      [1, inv5002Type],
    ];

    const result = redistributeForBonuses([mgA, mgB], per, bonusTable, availablePower, allCopies);

    const ownedHead = new Set(result.get('head')!.map(([, g]) => g.gemId));
    const ownedChest = new Set(result.get('chest')!.map(([, g]) => g.gemId));
    expect(ownedHead.has(5002)).toBe(true);
    expect(ownedChest.has(5001)).toBe(true);

    const bonuses = maxBonusesForOwned(mgA, result.get('head')!, bonusTable) + maxBonusesForOwned(mgB, result.get('chest')!, bonusTable);
    expect(bonuses).toBe(2);
  });
});

describe('redistributeForBonuses -- swap blocked by feasibility', () => {
  it('a swap that activates a bonus is rejected when it makes the plan infeasible', () => {
    const mgA = main('head', 5001, 5, '6'); // requiredPower=850, 4 sockets

    const invOwned = inv(9999, 5, '5'); // gemId=9999 (non-bonus), contribution=731
    const invBonus = inv(5002, 5, '1'); // matches socket-3 req, contribution=32

    const per = perSlot({ head: [[0, invOwned]] });
    const bonusTable = bonusMap({ 5001: [0, 0, 0, 5002, 0] });

    // Starting residual: max(0, 850-731)=119, feasible w/ available=200.
    // After swap: max(0, 850-32)=818 > 200 -> infeasible; must be blocked.
    const availablePower = 200;
    const allCopies: CopyEntry[] = [
      [0, invOwned],
      [1, invBonus],
    ];

    const result = redistributeForBonuses([mgA], per, bonusTable, availablePower, allCopies);

    const ownedIds = new Set(result.get('head')!.map(([, g]) => g.gemId));
    expect(ownedIds.has(9999)).toBe(true);
    expect(ownedIds.has(5002)).toBe(false);
  });

  it('allows the swap when outgoing dormant gem power covers the net-cost gap', () => {
    const mgA = main('head', 5001, 5, '7'); // requiredPower=1575, 5 sockets

    const invOwned = inv(9999, 5, '6'); // non-bonus, contribution=1298
    const invBonus = inv(5002, 5, '1'); // matches socket-3 req, contribution=32

    const per = perSlot({ head: [[0, invOwned]] });
    const bonusTable = bonusMap({ 5001: [0, 0, 0, 5002, 0] });

    const budget = 700;
    const allCopies: CopyEntry[] = [
      [0, invOwned],
      [1, invBonus],
    ];

    const result = redistributeForBonuses([mgA], per, bonusTable, budget, allCopies);

    const ownedIds = new Set(result.get('head')!.map(([, g]) => g.gemId));
    expect(ownedIds.has(5002)).toBe(true);
    expect(ownedIds.has(9999)).toBe(false);
  });
});

describe('redistributeForBonuses -- pull in unassigned gem', () => {
  it('swapping a socketed non-bonus gem for an unassigned bonus gem gains 1 bonus', () => {
    const mgA = main('head', 5001, 5, '6');

    const invNonBonus = inv(9998, 5, '1'); // no bonus
    const invBonus = inv(5002, 5, '1'); // activates bonus

    const per = perSlot({ head: [[0, invNonBonus]] });
    const bonusTable = bonusMap({ 5001: [0, 0, 0, 5002, 0] });
    const availablePower = 5000;
    const allCopies: CopyEntry[] = [
      [0, invNonBonus],
      [1, invBonus],
    ];

    const result = redistributeForBonuses([mgA], per, bonusTable, availablePower, allCopies);

    const ownedIds = new Set(result.get('head')!.map(([, g]) => g.gemId));
    expect(ownedIds.has(5002)).toBe(true);
    expect(ownedIds.has(9998)).toBe(false);

    expect(maxBonusesForOwned(mgA, result.get('head')!, bonusTable)).toBe(1);
  });
});

describe('redistributeForBonuses -- star-type constraint respected', () => {
  it('a 2-star gem matching a 5-star socket requirement is never swapped into that group', () => {
    const mgA = main('head', 5001, 5, '6'); // sockets 0-2: 2-star, socket 3: 5-star

    const invOwned5star = inv(9998, 5, '1');
    const invWrongStar = inv(5002, 2, '1'); // 2-star gemId=5002; star mismatch for socket 3

    const per = perSlot({ head: [[0, invOwned5star]] });
    const bonusTable = bonusMap({ 5001: [0, 0, 0, 5002, 0] });
    const availablePower = 5000;
    const allCopies: CopyEntry[] = [
      [0, invOwned5star],
      [1, invWrongStar],
    ];

    const result = redistributeForBonuses([mgA], per, bonusTable, availablePower, allCopies);

    const owned = result.get('head')!;
    const starRatingsOwned = owned.map(([, g]) => g.starRating);
    expect(starRatingsOwned).not.toContain(2);
    expect(owned.length).toBe(1);
    expect(owned[0][1].starRating).toBe(5);
  });
});

describe('redistributeForBonuses -- no-op and idempotence', () => {
  it('equals the input when no swap can increase total bonuses', () => {
    const mgA = main('head', 5001, 5, '6');
    const invBonus = inv(5002, 5, '1');
    const per = perSlot({ head: [[0, invBonus]] });
    const bonusTable = bonusMap({ 5001: [0, 0, 0, 5002, 0] });
    const availablePower = 5000;
    const allCopies: CopyEntry[] = [[0, invBonus]];

    const result = redistributeForBonuses([mgA], per, bonusTable, availablePower, allCopies);
    expect(result).toEqual(perSlot({ head: [[0, invBonus]] }));
  });

  it('running twice gives the same result as running once', () => {
    const mgA = main('head', 5001, 5, '6');
    const mgB = main('chest', 5002, 5, '6');
    const inv5001Type = inv(5001, 5, '1');
    const inv5002Type = inv(5002, 5, '1');
    const per = perSlot({
      head: [[0, inv5001Type]],
      chest: [[1, inv5002Type]],
    });
    const bonusTable = bonusMap({ 5001: [0, 0, 0, 5002, 0], 5002: [0, 0, 0, 5001, 0] });
    const availablePower = 5000;
    const allCopies: CopyEntry[] = [
      [0, inv5001Type],
      [1, inv5002Type],
    ];

    const once = redistributeForBonuses([mgA, mgB], per, bonusTable, availablePower, allCopies);
    const twice = redistributeForBonuses([mgA, mgB], once, bonusTable, availablePower, allCopies);
    expect(once).toEqual(twice);
  });
});

describe('redistributeForBonuses -- 2-star swaps always feasible', () => {
  it('swapping 2-star gems between two 2-star main gems never changes residual', () => {
    const mgA = main('a', 2001, 2, '7'); // requiredPower=235; socket 1 needs 2003
    const mgB = main('b', 2002, 2, '7'); // requiredPower=235; socket 1 needs 2001

    const inv2001 = inv(2001, 2, '1');
    const inv2003 = inv(2003, 2, '1');

    const per = perSlot({
      a: [[0, inv2001]],
      b: [[1, inv2003]],
    });
    const bonusTable = bonusMap({ 2001: [1007, 2003, 2004], 2002: [1017, 2001, 2005] });

    const availablePower = 0; // 2-star mains are immune to residual changes
    const allCopies: CopyEntry[] = [
      [0, inv2001],
      [1, inv2003],
    ];

    const result = redistributeForBonuses([mgA, mgB], per, bonusTable, availablePower, allCopies);

    const ownedA = new Set(result.get('a')!.map(([, g]) => g.gemId));
    const ownedB = new Set(result.get('b')!.map(([, g]) => g.gemId));
    expect(ownedA.has(2003)).toBe(true);
    expect(ownedB.has(2001)).toBe(true);

    const bonusesA = maxBonusesForOwned(mgA, result.get('a')!, bonusTable);
    const bonusesB = maxBonusesForOwned(mgB, result.get('b')!, bonusTable);
    expect(bonusesA + bonusesB).toBe(2);
  });
});

describe('end-to-end via runPipeline', () => {
  it('produces correct bonuses after cross-gem redistribution', () => {
    const mainGems = [main('head', 5001, 5, '6'), main('chest', 5002, 5, '6')];

    const inv5001Type = makeInventoryGem({ gemId: 5001, starRating: 5, rank: '1', quantity: 1, activeStars: 2, contribution: 32 });
    const inv5002Type = makeInventoryGem({ gemId: 5002, starRating: 5, rank: '1', quantity: 1, activeStars: 2, contribution: 32 });
    const inventory = [inv5001Type, inv5002Type];

    const availablePower = 5000;
    const result = runPipeline(availablePower, mainGems, [], inventory);

    const totalBonuses = result.gemResults.reduce((sum, gr) => sum + gr.bonusesActivated, 0);
    expect(totalBonuses).toBe(2);
    expect(result.totalResidualCost).toBeLessThanOrEqual(availablePower);
  });
});
