/**
 * Tests bonus mode 'budget' (core/bonusBudget.ts) in isolation, with no
 * dependency on runOptimization/upgrades/rank-1 conversion -- `evaluate` is
 * a small local helper mirroring what `runOptimization.ts`'s
 * `deriveFromBags` computes (materialize + surplus + bonus count), so this
 * file only ever asserts what `bonusBudget.ts` itself is responsible for.
 * See docs/SPEC.md ("Bonus activation modes").
 *
 * Reference values (COST_5STAR): rank "1" contribution = 32; rank "6"
 * requiredPower = 850, numSockets = 4 (1 five-star socket, index 3); rank
 * "7" requiredPower = 1575, numSockets = 5 (2 five-star sockets, index
 * 3-4); rank "6.9" contribution = 23*32+1390 = 2126; rank "6.10"
 * contribution = 24*32+1450 = 2218 (i.e. "6.10" > "6.9", despite sorting
 * before it lexicographically).
 */

import { describe, expect, it } from 'vitest';
import { COST_TABLES } from '../../src/core/data';
import type { InventoryGem, MainGem } from '../../src/core/models';
import { makeInventoryGem } from '../../src/core/models';
import { type CopyEntry } from '../../src/core/optimizer';
import { materializeResult } from '../../src/core/pipeline';
import { computeContribution, computeExtractablePower, numSocketsUnlocked } from '../../src/core/rules';
import {
  bagsFromAssignments,
  budgetActivateBonuses,
  buildSocketSchedule,
  type BudgetEvaluation,
  type BudgetEvaluator,
} from '../../src/core/bonusBudget';

function inv(gemId: number, star: number, rank: string, activeStars = 2): InventoryGem {
  return makeInventoryGem({
    gemId,
    starRating: star,
    rank,
    quantity: 1,
    activeStars,
    contribution: computeContribution(star, rank, COST_TABLES.get(star)!),
  });
}

function main(slot: string, gemId: number, star: number, rank: string, activeStars = 2): MainGem {
  return {
    slotName: slot,
    gemId,
    starRating: star,
    targetRank: rank,
    requiredPower: COST_TABLES.get(star)!.get(rank)!.requiredGemPower,
    numSockets: numSocketsUnlocked(rank, star),
    activeStars,
  };
}

function bonusMap(entries: Record<number, number[]>): Map<number, number[]> {
  return new Map(Object.entries(entries).map(([k, v]) => [Number(k), v]));
}

function bagGemIds(bags: ReadonlyMap<string, readonly CopyEntry[]>, slot: string): number[] {
  return (bags.get(slot) ?? []).map(([, gem]) => gem.gemId);
}

/** Mirrors runOptimization.ts's deriveFromBags for a no-upgrades, no-R1-conversion case. */
function evaluatorFor(
  mainGems: readonly MainGem[],
  bonusTable: Map<number, number[]>,
  allCopies: readonly CopyEntry[],
  availablePower: number,
): BudgetEvaluator {
  return (perSlotGems) => {
    const result = materializeResult(availablePower, mainGems, [], allCopies, perSlotGems, bonusTable);
    const assignedCopyIds = new Set<number>();
    for (const assignments of result.gemAssignments.values()) {
      for (const a of assignments) if (a.copyId >= 0) assignedCopyIds.add(a.copyId);
    }
    let dormant = 0;
    for (const [copyId, gem] of allCopies) {
      if (!assignedCopyIds.has(copyId)) dormant += computeExtractablePower(gem.rank, COST_TABLES.get(gem.starRating)!);
    }
    const surplus = availablePower + dormant - result.totalResidualCost;
    const bonuses = result.gemResults.reduce((sum, gemResult) => sum + gemResult.bonusesActivated, 0);
    return { result, surplus, bonuses };
  };
}

describe('buildSocketSchedule', () => {
  it('visits 5-star sockets before 2-star, round-robin across main gems in slot order', () => {
    // A: rank "7" -> 5 sockets (2-star 0,1,2; 5-star 3,4).
    // B: rank "6" -> 4 sockets (2-star 0,1,2; 5-star 3).
    const a = main('head', 5001, 5, '7');
    const b = main('chest', 5002, 5, '6');

    const schedule = buildSocketSchedule([a, b]);

    expect(schedule).toEqual([
      { slotName: 'head', socketIndex: 3, starType: 5 },
      { slotName: 'chest', socketIndex: 3, starType: 5 },
      { slotName: 'head', socketIndex: 4, starType: 5 },
      { slotName: 'head', socketIndex: 0, starType: 2 },
      { slotName: 'chest', socketIndex: 0, starType: 2 },
      { slotName: 'head', socketIndex: 1, starType: 2 },
      { slotName: 'chest', socketIndex: 1, starType: 2 },
      { slotName: 'head', socketIndex: 2, starType: 2 },
      { slotName: 'chest', socketIndex: 2, starType: 2 },
    ]);
  });
});

describe('budgetActivateBonuses', () => {
  it('fills an empty socket from a dormant copy when surplus allows, strictly increasing bonuses', () => {
    const mg = main('head', 5001, 5, '6'); // 1 five-star socket, index 3
    const bonusTable = bonusMap({ 5001: [0, 0, 0, 9002, 0] });
    const bonusCopy = inv(9002, 5, '1'); // contribution 32
    const allCopies: CopyEntry[] = [[0, bonusCopy]];
    const evaluate = evaluatorFor([mg], bonusTable, allCopies, 10_000);
    const initialBags = new Map<string, CopyEntry[]>([['head', []]]);
    const initial = evaluate(initialBags);
    expect(initial.bonuses).toBe(0);

    const winner = budgetActivateBonuses([mg], bonusTable, allCopies, initial, evaluate);

    expect(winner.bonuses).toBe(1);
    expect(bagGemIds(bagsFromAssignments(winner.result), 'head')).toEqual([9002]);
  });

  it('reverts a swap that would drive surplus negative, even though bonuses would increase', () => {
    const mg = main('head', 5001, 5, '6'); // requiredPower 850
    const bonusTable = bonusMap({ 5001: [0, 0, 0, 9002, 0] });
    const strongGem = inv(9001, 5, '5'); // contribution 731 (8*32+475) -- socketed, non-activating
    const weakBonusGem = inv(9002, 5, '1'); // contribution 32 -- dormant, activates the bonus
    const allCopies: CopyEntry[] = [
      [0, strongGem],
      [1, weakBonusGem],
    ];
    // A small positive surplus with strongGem socketed. Swapping strongGem
    // out costs its full contribution (731) in residual but only refunds
    // its requiredGemPower (475) as dormant power -- a net loss of
    // requiredGems * BASE_POWER (8*32=256) that a small surplus can't absorb.
    const residualWithStrong = Math.max(0, mg.requiredPower - strongGem.contribution);
    const availablePower = residualWithStrong + 5;
    const evaluate = evaluatorFor([mg], bonusTable, allCopies, availablePower);
    const initialBags = new Map<string, CopyEntry[]>([['head', [[0, strongGem]]]]);
    const initial = evaluate(initialBags);
    expect(initial.surplus).toBeGreaterThanOrEqual(0);
    expect(initial.bonuses).toBe(0);

    const winner = budgetActivateBonuses([mg], bonusTable, allCopies, initial, evaluate);

    expect(winner.bonuses).toBe(0);
    expect(bagGemIds(bagsFromAssignments(winner.result), 'head')).toEqual([9001]);
  });

  it('rejects a same-tier steal from another main gem when net activated bonuses do not increase', () => {
    // "head" wants gem X for its only 5-star socket; "chest" already holds
    // X there, activating its own identical requirement. Stealing X for
    // head deactivates chest's socket with nothing to compensate -- net
    // bonus count is unchanged (0 -> 1 at head, 1 -> 0 at chest), so the
    // swap must be rejected.
    const head = main('head', 5001, 5, '6');
    const chest = main('chest', 5002, 5, '6');
    const bonusTable = bonusMap({
      5001: [0, 0, 0, 9002, 0],
      5002: [0, 0, 0, 9002, 0],
    });
    const gemX = inv(9002, 5, '1');
    const allCopies: CopyEntry[] = [[0, gemX]];
    const evaluate = evaluatorFor([head, chest], bonusTable, allCopies, 10_000);
    const initialBags = new Map<string, CopyEntry[]>([
      ['head', []],
      ['chest', [[0, gemX]]],
    ]);
    const initial = evaluate(initialBags);
    expect(initial.bonuses).toBe(1);

    const winner = budgetActivateBonuses([head, chest], bonusTable, allCopies, initial, evaluate);

    expect(winner.bonuses).toBe(1);
    expect(bagGemIds(bagsFromAssignments(winner.result), 'chest')).toEqual([9002]);
    expect(bagGemIds(bagsFromAssignments(winner.result), 'head')).toEqual([]);
  });

  it('accepts a steal that displaces a compensating activation elsewhere, net +1', () => {
    // "head" (rank 6, 1 five-star socket) wants gem X at its only 5-star
    // socket, currently occupied by non-matching gem Y. "chest" (rank 7, 2
    // five-star sockets) holds X in its own X-requiring socket (activated)
    // and has a second, currently-empty socket that requires Y. Moving X to
    // head and the displaced Y to chest's Y socket nets +1 overall: head
    // gains one activation, chest trades one activation for another.
    const head = main('head', 5001, 5, '6');
    const chest = main('chest', 5002, 5, '7');
    const bonusTable = bonusMap({
      5001: [0, 0, 0, 9002, 0],
      5002: [0, 0, 0, 9002, 9003],
    });
    const gemX = inv(9002, 5, '1');
    const gemY = inv(9003, 5, '1');
    const allCopies: CopyEntry[] = [
      [0, gemY],
      [1, gemX],
    ];
    const evaluate = evaluatorFor([head, chest], bonusTable, allCopies, 10_000);
    const initialBags = new Map<string, CopyEntry[]>([
      ['head', [[0, gemY]]],
      ['chest', [[1, gemX]]],
    ]);
    const initial = evaluate(initialBags);
    expect(initial.bonuses).toBe(1); // only chest's socket 3 (X) is activated

    const winner = budgetActivateBonuses([head, chest], bonusTable, allCopies, initial, evaluate);

    expect(winner.bonuses).toBe(2);
    expect(bagGemIds(bagsFromAssignments(winner.result), 'head')).toEqual([9002]);
    expect(bagGemIds(bagsFromAssignments(winner.result), 'chest')).toEqual([9003]);
  });

  it('prefers the higher-rank candidate first, leaving the lower-rank copy dormant', () => {
    const mg = main('head', 5001, 5, '6');
    const bonusTable = bonusMap({ 5001: [0, 0, 0, 9002, 0] });
    const lowerRank = inv(9002, 5, '6.9'); // contribution 2126
    const higherRank = inv(9002, 5, '6.10'); // contribution 2218
    const allCopies: CopyEntry[] = [
      [0, lowerRank],
      [1, higherRank],
    ];
    const evaluate = evaluatorFor([mg], bonusTable, allCopies, 10_000);
    const initialBags = new Map<string, CopyEntry[]>([['head', []]]);
    const initial = evaluate(initialBags);

    const winner = budgetActivateBonuses([mg], bonusTable, allCopies, initial, evaluate);

    const winnerAssignment = winner.result.gemAssignments.get('head')!.find((a) => a.socketIndex === 3);
    expect(winnerAssignment?.copyId).toBe(1); // the rank "6.10" copy, not "6.9"
  });

  it('is a no-op when the initial surplus is already negative', () => {
    const mg = main('head', 5001, 5, '6');
    const bonusTable = bonusMap({ 5001: [0, 0, 0, 9002, 0] });
    const bonusCopy = inv(9002, 5, '1');
    const allCopies: CopyEntry[] = [[0, bonusCopy]];
    const evaluate = evaluatorFor([mg], bonusTable, allCopies, -100);
    const initialBags = new Map<string, CopyEntry[]>([['head', []]]);
    const initial: BudgetEvaluation = evaluate(initialBags);
    expect(initial.surplus).toBeLessThan(0);

    const winner = budgetActivateBonuses([mg], bonusTable, allCopies, initial, evaluate);

    expect(winner).toBe(initial);
  });
});
