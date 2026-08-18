/**
 * Tests solveAssignment, fillEmptySockets, assignSockets, and
 * computeBonusGemDemand in core/optimizer.ts directly, with no dependency
 * on any worker/UI layer.
 *
 * In bonus mode 'off' (the default, and what every test below exercises
 * unless noted), bonus activation is a tie-break, never a priority: the
 * optimizer picks a gem by its normal power-fit/resonance criterion, and
 * only when several candidates are numerically indistinguishable (identical
 * contribution and activeStars) does it prefer one that activates a bonus,
 * then one not still needed as a bonus gem by another main gem. See
 * docs/SPEC.md ("Bonus activation"). Bonus mode 'forced' changes this --
 * see the "forced bonus mode" describe block below and docs/SPEC.md ("Bonus
 * activation modes").
 *
 * Known reference values:
 *   5-star rank "1"  contribution = 32
 *   5-star rank "2"  contribution = 82
 *   5-star rank "6"  requiredPower = 850, numSockets = 4
 *   5-star rank "7"  requiredPower = 1575, numSockets = 5
 *   2-star rank "7"  contribution = 291, resonance = 14, numSockets = 3
 *   2-star rank "7.5" contribution = 386, resonance = 14 (rank truncated)
 */

import { describe, expect, it } from 'vitest';
import { COST_2STAR, COST_5STAR } from '../../src/core/data';
import type { InventoryGem, MainGem } from '../../src/core/models';
import { makeInventoryGem } from '../../src/core/models';
import { assignSockets, type CopyEntry, computeBonusGemDemand, fillEmptySockets, solveAssignment } from '../../src/core/optimizer';
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

function bonusMap(entries: Record<number, number[]>): Map<number, number[]> {
  return new Map(Object.entries(entries).map(([k, v]) => [Number(k), v]));
}

function bagGemIds(bags: Map<string, CopyEntry[]>, slot: string): number[] {
  return (bags.get(slot) ?? []).map(([, gem]) => gem.gemId);
}

describe('solveAssignment -- bonus tie-break', () => {
  it('a numeric tie is broken in favor of the gem that activates the socket bonus', () => {
    const mg = main('head', 5001, 5, '6'); // one 5-star socket (index 3)
    const bonusTable = bonusMap({ 5001: [0, 0, 0, 9002, 0] });
    const bonusGem = inv(9002, 5, '1'); // contribution 32
    const otherGem = inv(9001, 5, '1'); // contribution 32 -- identical signature
    const demand = computeBonusGemDemand([mg], bonusTable);

    const bags = solveAssignment([mg], [otherGem, bonusGem], bonusTable, demand);

    expect(bagGemIds(bags, 'head')).toEqual([9002]);
  });

  it('a non-tie is decided by contribution alone -- the bonus is never worth a worse power fit', () => {
    const mg = main('head', 5001, 5, '6');
    const bonusTable = bonusMap({ 5001: [0, 0, 0, 9002, 0] });
    const bonusGem = inv(9002, 5, '1'); // contribution 32 -- activates the bonus, but a worse fit
    const closerGem = inv(9001, 5, '2'); // contribution 82 -- closer to the 850 residual
    const demand = computeBonusGemDemand([mg], bonusTable);

    const bags = solveAssignment([mg], [bonusGem, closerGem], bonusTable, demand);

    expect(bagGemIds(bags, 'head')).toEqual([9001]);
  });

  it('conserves a bonus gem needed by another main gem when a tied alternative exists', () => {
    // "head" (processed first: same residual, lower index) has no use for
    // either candidate; "chest" needs gem A to activate its own bonus. A
    // and B tie exactly. head must spend B, leaving A free for chest.
    const head = main('head', 5001, 5, '6');
    const chest = main('chest', 5002, 5, '6');
    const bonusTable = bonusMap({
      5001: [0, 0, 0, 9099, 0], // head's requirement matches neither A nor B
      5002: [0, 0, 0, 9002, 0], // chest requires A (gemId 9002)
    });
    const gemA = inv(9002, 5, '1'); // contribution 32
    const gemB = inv(9001, 5, '1'); // contribution 32 -- identical signature, needed nowhere
    const demand = computeBonusGemDemand([head, chest], bonusTable);

    const bags = solveAssignment([head, chest], [gemA, gemB], bonusTable, demand);

    expect(bagGemIds(bags, 'head')).toEqual([9001]); // B
    expect(bagGemIds(bags, 'chest')).toEqual([9002]); // A, conserved for chest

    const headSockets = assignSockets(head, bags.get('head') ?? [], bonusTable);
    const chestSockets = assignSockets(chest, bags.get('chest') ?? [], bonusTable);
    const totalBonuses = [...headSockets, ...chestSockets].filter((a) => a.bonusActivated).length;
    expect(totalBonuses).toBe(1); // only chest activates; conservation makes this possible at all
  });

  it('produces the same numeric outputs regardless of which of two tied gems is chosen', () => {
    const mg = main('head', 5001, 5, '6');
    const bonusTable = bonusMap({ 5001: [0, 0, 0, 9099, 0] }); // matches neither candidate
    const gemA = inv(9001, 5, '1');
    const gemB = inv(9002, 5, '1');
    const demand = computeBonusGemDemand([mg], bonusTable);

    const sigOf = (bags: Map<string, CopyEntry[]>) =>
      (bags.get('head') ?? []).map(([, gem]) => [gem.contribution, gem.activeStars, gem.rank]);

    const forward = solveAssignment([mg], [gemA, gemB], bonusTable, demand);
    const reversed = solveAssignment([mg], [gemB, gemA], bonusTable, demand);

    expect(sigOf(forward)).toEqual(sigOf(reversed));
  });
});

describe('fillEmptySockets -- bonus tie-break', () => {
  it('a numeric tie on a 2-star main gem (never touched by solveAssignment) is broken by bonus activation', () => {
    const mg = main('ring', 2001, 2, '5'); // 2 sockets: {0:1-star, 1:2-star} -- exactly one 2-star socket
    const bonusTable = bonusMap({ 2001: [0, 7002] });
    const bonusGem = inv(7002, 2, '7'); // contribution 291
    const otherGem = inv(7001, 2, '7'); // contribution 291 -- identical signature
    const demand = computeBonusGemDemand([mg], bonusTable);
    const allCopies: CopyEntry[] = [
      [0, otherGem],
      [1, bonusGem],
    ];
    const empty = new Map<string, CopyEntry[]>([['ring', []]]);

    const bags = fillEmptySockets([mg], empty, bonusTable, allCopies, demand);

    expect(bagGemIds(bags, 'ring')).toEqual([7002]);
  });

  it('a resonance tie is not a numeric tie -- contribution still decides, never the bonus', () => {
    // Ranks "7" and "7.5" truncate to the same resonance bonus (2 x 7 = 14)
    // but have different contribution (291 vs 386), so they never enter the
    // same tie-break pool. The higher-contribution, non-bonus copy (given
    // the lower copyId, matching today's stable-sort tie-break) must win.
    // Rank "5" leaves exactly one 2-star socket unlocked, so only one of
    // the two candidates below can be placed.
    const mg = main('ring', 2001, 2, '5');
    const bonusTable = bonusMap({ 2001: [0, 7002] });
    const higherContribution = inv(7001, 2, '7.5'); // contribution 386, no bonus, copyId 0
    const bonusMatch = inv(7002, 2, '7'); // contribution 291, activates the bonus, copyId 1
    const demand = computeBonusGemDemand([mg], bonusTable);
    const allCopies: CopyEntry[] = [
      [0, higherContribution],
      [1, bonusMatch],
    ];
    const empty = new Map<string, CopyEntry[]>([['ring', []]]);

    const bags = fillEmptySockets([mg], empty, bonusTable, allCopies, demand);

    expect(bagGemIds(bags, 'ring')).toEqual([7001]);
  });
});

describe('forced bonus mode', () => {
  it('solveAssignment always prefers a bonus-activating copy over a strictly better power fit', () => {
    const mg = main('head', 5001, 5, '6'); // residual 850
    const bonusTable = bonusMap({ 5001: [0, 0, 0, 9002, 0] });
    const bonusGem = inv(9002, 5, '1'); // contribution 32 -- activates the bonus, but a much worse fit
    const closerGem = inv(9001, 5, '2'); // contribution 82 -- closer to the 850 residual
    const demand = computeBonusGemDemand([mg], bonusTable);

    const bags = solveAssignment([mg], [bonusGem, closerGem], bonusTable, demand, true);

    expect(bagGemIds(bags, 'head')).toEqual([9002]);
  });

  it('solveAssignment falls back to a non-activating copy once no activating copy remains available', () => {
    const mg = main('head', 5001, 5, '6');
    const bonusTable = bonusMap({ 5001: [0, 0, 0, 9099, 0] }); // requirement absent from inventory
    const onlyGem = inv(9001, 5, '2');
    const demand = computeBonusGemDemand([mg], bonusTable);

    const bags = solveAssignment([mg], [onlyGem], bonusTable, demand, true);

    expect(bagGemIds(bags, 'head')).toEqual([9001]);
  });

  it('fillEmptySockets always prefers a bonus-activating copy over higher resonance', () => {
    const mg = main('ring', 2001, 2, '5'); // one 2-star socket
    const bonusTable = bonusMap({ 2001: [0, 7002] });
    const higherResonance = inv(7001, 2, '7.5'); // resonance 14, no bonus
    const bonusMatch = inv(7002, 2, '3'); // lower resonance, activates the bonus
    const demand = computeBonusGemDemand([mg], bonusTable);
    const allCopies: CopyEntry[] = [
      [0, higherResonance],
      [1, bonusMatch],
    ];
    const empty = new Map<string, CopyEntry[]>([['ring', []]]);

    const bags = fillEmptySockets([mg], empty, bonusTable, allCopies, demand, true);

    expect(bagGemIds(bags, 'ring')).toEqual([7002]);
  });
});

describe('assignSockets -- socket materialization', () => {
  it('places the matching gem into the socket it activates, not the lowest free socket', () => {
    // 2-star main, sockets 1 and 2 share star type 2. Socket 2 requires
    // gemId 7002; socket 1's requirement (7099) is absent from the bag.
    const mg = main('ring', 2001, 2, '7');
    const bonusTable = bonusMap({ 2001: [0, 7099, 7002] });
    const matching: CopyEntry = [0, inv(7002, 2, '7')];
    const nonMatching: CopyEntry = [1, inv(7003, 2, '7')]; // identical signature to `matching`

    const sockets = assignSockets(mg, [nonMatching, matching], bonusTable);

    expect(sockets[2].gem?.gemId).toBe(7002);
    expect(sockets[2].bonusActivated).toBe(true);
    expect(sockets[1].gem?.gemId).toBe(7003);
    expect(sockets[1].bonusActivated).toBe(false);
  });

  it('activates a bonus in each of two socket-star-type groups independently', () => {
    const mg = main('head', 5001, 5, '7'); // 5 sockets: {0,1,2: 2-star; 3,4: 5-star}
    const bonusTable = bonusMap({ 5001: [0, 0, 7002, 0, 9002] });
    const bag: CopyEntry[] = [
      [0, inv(7002, 2, '7')],
      [1, inv(9002, 5, '1')],
    ];

    const sockets = assignSockets(mg, bag, bonusTable);

    expect(sockets.filter((s) => s.bonusActivated)).toHaveLength(2);
  });

  it('leaves unfilled unlocked sockets as empty placeholders', () => {
    const mg = main('head', 5001, 5, '6'); // 4 sockets, none filled
    const bonusTable = bonusMap({ 5001: [0, 0, 0, 9002, 0] });

    const sockets = assignSockets(mg, [], bonusTable);

    expect(sockets).toHaveLength(4);
    expect(sockets.every((s) => s.gem === null && s.copyId === -1 && !s.bonusActivated)).toBe(true);
  });
});
