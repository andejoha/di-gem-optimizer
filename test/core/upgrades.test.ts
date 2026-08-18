/**
 * Tests computeSocketableStarRatings, buildUpgradeChains,
 * materializeUpgrades, and filterUpgradesToSocketed.
 */

import { describe, expect, it } from 'vitest';
import { COST_1STAR, COST_2STAR, COST_5STAR } from '../../src/core/data';
import type { InventoryGem, MainGem, SocketAssignment, UpgradeDelta } from '../../src/core/models';
import { makeInventoryGem, makeSocketAssignment, makeUpgradeDelta } from '../../src/core/models';
import { computeContribution, numSocketsUnlocked } from '../../src/core/rules';
import {
  buildUpgradeChains,
  computeSocketCounts,
  computeSocketableStarRatings,
  filterUpgradesToSocketed,
  materializeUpgrades,
} from '../../src/core/upgrades';

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
  const table = star === 2 ? COST_2STAR : COST_5STAR;
  const tbl = star === 5 ? COST_5STAR : table;
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

// Known 2-star contributions:
//   rank "1" -> 1*4+0  = 4
//   rank "4" -> 2*4+45 = 53
//   rank "5" -> 4*4+65 = 81

describe('computeSocketCounts', () => {
  it('is empty for no main gems', () => {
    expect(computeSocketCounts([])).toEqual(new Map());
  });

  it('single rank-5 main: 3 two-star sockets', () => {
    const mg = main('head', 5001, 5, '5');
    expect(computeSocketCounts([mg])).toEqual(new Map([[2, 3]]));
  });

  it('rank-6 main: 3 two-star + 1 five-star socket', () => {
    const mg = main('head', 5001, 5, '6');
    expect(computeSocketCounts([mg])).toEqual(
      new Map([
        [2, 3],
        [5, 1],
      ]),
    );
  });

  it('multiple main gems accumulate', () => {
    const mg1 = main('head', 5001, 5, '5'); // 3x2-star
    const mg2 = main('chest', 5001, 5, '6'); // 3x2-star + 1x5-star
    expect(computeSocketCounts([mg1, mg2])).toEqual(
      new Map([
        [2, 6],
        [5, 1],
      ]),
    );
  });
});

describe('computeSocketableStarRatings', () => {
  it('is empty for no main gems', () => {
    expect(computeSocketableStarRatings([])).toEqual(new Set());
  });

  it('5-star main below rank 6: only 2-star socketable', () => {
    const mg = main('head', 5001, 5, '5');
    const result = computeSocketableStarRatings([mg]);
    expect(result.has(2)).toBe(true);
    expect(result.has(5)).toBe(false); // sockets 3-4 require rank >= 6
  });

  it('5-star main at rank 6: both 2-star and 5-star socketable', () => {
    const mg = main('head', 5001, 5, '6');
    const result = computeSocketableStarRatings([mg]);
    expect(result.has(2)).toBe(true);
    expect(result.has(5)).toBe(true);
  });

  it('2-star main gems provide no reduction; 5-star sockets never appear', () => {
    const mg: MainGem = {
      slotName: 'head',
      gemId: 2001,
      starRating: 2,
      targetRank: '5',
      requiredPower: COST_2STAR.get('5')!.requiredGemPower,
      numSockets: numSocketsUnlocked('5', 2),
      activeStars: 2,
    };
    expect(computeSocketableStarRatings([mg])).toEqual(new Set());
  });
});

describe('buildUpgradeChains -- step counts and spare-copy logic', () => {
  it('a gem type with exactly 1 copy has no spare copies -> 0 steps', () => {
    const inventory = [inv(2033, 2, '1')];
    const { chains, leftover } = buildUpgradeChains(inventory, new Map([[2, 99]]));
    expect(chains.length).toBe(1);
    expect(chains[0].steps.length).toBe(0);
    expect(leftover).toEqual([]);
  });

  it('2 copies -> 1 step to rank 4', () => {
    const inventory = [inv(2033, 2, '1'), inv(2033, 2, '1')];
    const { chains } = buildUpgradeChains(inventory, new Map([[2, 99]]));
    expect(chains.length).toBe(1);
    const chain = chains[0];
    expect(chain.steps.length).toBe(1);
    expect(chain.steps[0].fromRank).toBe('1');
    expect(chain.steps[0].toRank).toBe('4');
    expect(chain.steps[0].contributionAfter).toBe(53);
  });

  it('4 copies -> 3 sub-rank steps: 1->4, 4->4.1, 4.1->5', () => {
    const inventory = Array.from({ length: 4 }, () => inv(2033, 2, '1'));
    const { chains } = buildUpgradeChains(inventory, new Map([[2, 99]]));
    expect(chains.length).toBe(1);
    const chain = chains[0];
    expect(chain.steps.length).toBe(3);
    expect(chain.steps[0].toRank).toBe('4');
    expect(chain.steps[1].toRank).toBe('4.1');
    expect(chain.steps[2].toRank).toBe('5');
    expect(chain.steps[2].contributionAfter).toBe(81);
  });

  it('the highest-contribution copy is the target', () => {
    const low = inv(2033, 2, '1'); // contribution=4
    const high = inv(2033, 2, '4'); // contribution=53
    const { chains } = buildUpgradeChains([low, high], new Map([[2, 99]]));
    const chain = chains[0];
    expect(chain.baseSubInventory[0].rank).toBe('4'); // highest first
    expect(chain.steps.length).toBe(1);
    expect(chain.steps[0].toRank).toBe('4.1');
  });

  it('1-star and unsocketable 5-star gems go straight to leftover', () => {
    const oneStar = makeInventoryGem({
      gemId: 1001,
      starRating: 1,
      rank: '1',
      quantity: 1,
      activeStars: 1,
      contribution: computeContribution(1, '1', COST_1STAR),
    });
    const twoStar = inv(2033, 2, '1');
    const { chains, leftover } = buildUpgradeChains([oneStar, twoStar], new Map([[2, 99]]));
    expect(leftover.some((g) => g.gemId === 1001)).toBe(true);
    expect(chains.every((c) => c.starRating === 2)).toBe(true);
  });

  it('5-star inventory gems get no chain when star 5 is not socketable', () => {
    const fiveStar = makeInventoryGem({
      gemId: 5001,
      starRating: 5,
      rank: '1',
      quantity: 1,
      activeStars: 2,
      contribution: computeContribution(5, '1', COST_5STAR),
    });
    const { chains, leftover } = buildUpgradeChains([fiveStar, fiveStar], new Map([[2, 99]]));
    expect(chains.length).toBe(0);
    expect(leftover.length).toBe(2);
  });

  it('socket cap limits chain count to the single highest-value type', () => {
    const inventory = [inv(2001, 2, '1'), inv(2001, 2, '1'), inv(2033, 2, '4'), inv(2033, 2, '1')];
    const { chains, leftover } = buildUpgradeChains(inventory, new Map([[2, 1]]));
    expect(chains.length).toBe(1);
    expect(chains[0].gemId).toBe(2033);
    expect(leftover.filter((g) => g.gemId === 2001).length).toBe(2);
  });

  it('on a contribution tie, the type with more copies wins', () => {
    const inventory = [inv(2001, 2, '1'), inv(2033, 2, '1'), inv(2033, 2, '1')];
    const { chains, leftover } = buildUpgradeChains(inventory, new Map([[2, 1]]));
    expect(chains.length).toBe(1);
    expect(chains[0].gemId).toBe(2033);
    expect(leftover.filter((g) => g.gemId === 2001).length).toBe(1);
  });

  it('the target is always the highest-ranked copy; depth 0 preserves its initial rank', () => {
    const high = inv(2033, 2, '4');
    const low = inv(2033, 2, '1');
    const { chains, leftover } = buildUpgradeChains([high, low], new Map([[2, 99]]));
    const chain = chains[0];
    expect(chain.baseSubInventory[0].rank).toBe('4');
    const { working } = materializeUpgrades(chains, [0], leftover);
    const targetRanks = working.filter((g) => g.gemId === 2033).map((g) => g.rank);
    expect(targetRanks).toContain('4');
  });
});

describe('materializeUpgrades', () => {
  it('depth 0 returns the originals', () => {
    const inventory = Array.from({ length: 4 }, () => inv(2033, 2, '1'));
    const { chains, leftover } = buildUpgradeChains(inventory, new Map([[2, 99]]));
    const { working, appliedDeltas, totalCost } = materializeUpgrades(chains, [0], leftover);
    expect(totalCost).toBe(0);
    expect(appliedDeltas).toEqual([]);
    expect(working.length).toBe(4);
    expect(working.every((g) => g.rank === '1')).toBe(true);
  });

  it('depth 1 gives the step-1 snapshot', () => {
    const inventory = Array.from({ length: 4 }, () => inv(2033, 2, '1'));
    const { chains, leftover } = buildUpgradeChains(inventory, new Map([[2, 99]]));
    const { working, appliedDeltas, totalCost } = materializeUpgrades(chains, [1], leftover);
    expect(working.some((g) => g.rank === '4')).toBe(true);
    expect(totalCost).toBe(chains[0].steps[0].gemPowerCost);
    expect(appliedDeltas.length).toBe(chains[0].steps[0].deltas.length);
  });

  it('depth 2 gives the step-2 snapshot', () => {
    const inventory = Array.from({ length: 4 }, () => inv(2033, 2, '1'));
    const { chains, leftover } = buildUpgradeChains(inventory, new Map([[2, 99]]));
    const { working, totalCost } = materializeUpgrades(chains, [2], leftover);
    const ranks = working.map((g) => g.rank);
    expect(ranks).toContain('4.1');
    expect(totalCost).toBe(chains[0].steps.slice(0, 2).reduce((s, step) => s + step.gemPowerCost, 0));
  });

  it('leftover gems always appear in the output regardless of depth', () => {
    const oneStar = makeInventoryGem({
      gemId: 1001,
      starRating: 1,
      rank: '1',
      quantity: 1,
      activeStars: 1,
      contribution: computeContribution(1, '1', COST_1STAR),
    });
    const inventory = [...Array.from({ length: 4 }, () => inv(2033, 2, '1')), oneStar];
    const { chains, leftover } = buildUpgradeChains(inventory, new Map([[2, 99]]));
    const { working } = materializeUpgrades(chains, [0], leftover);
    expect(working.some((g) => g.gemId === 1001)).toBe(true);
  });
});

describe('filterUpgradesToSocketed', () => {
  it('returns empty for empty deltas', () => {
    const { filtered, droppedOps, gemsToRestore } = filterUpgradesToSocketed([], new Map(), new Map());
    expect(filtered).toEqual([]);
    expect(droppedOps).toEqual([]);
    expect(gemsToRestore).toEqual([]);
  });

  it('keeps a delta whose target rank appears in assignments', () => {
    const gem = inv(2033, 2, '4');
    const sa: SocketAssignment = makeSocketAssignment({ socketIndex: 0, gem, copyId: 0, contribution: gem.contribution });
    const delta: UpgradeDelta = makeUpgradeDelta({
      gemId: 2033,
      starRating: 2,
      currentRank: '1',
      targetRank: '4',
      additionalGemPower: 45,
      additionalSocketPower: 49,
      netGain: 4,
      inventoryIndex: 0,
      copiesSacrificed: 1,
      upgradeType: 'partial',
      sacrificedGems: [inv(2033, 2, '1')],
      preUpgradeGem: inv(2033, 2, '1'),
    });
    const assignments = new Map([['head', [sa]]]);
    const { filtered, droppedOps } = filterUpgradesToSocketed([delta], assignments, assignments);
    expect(filtered.length).toBe(1);
    expect(droppedOps.length).toBe(0);
  });

  it('drops an unsocketed upgrade and restores its spare copies', () => {
    const otherGem = inv(2003, 2, '5');
    const sa: SocketAssignment = makeSocketAssignment({ socketIndex: 0, gem: otherGem, copyId: 0, contribution: otherGem.contribution });
    const spareCopy = inv(2033, 2, '1');
    const delta: UpgradeDelta = makeUpgradeDelta({
      gemId: 2033,
      starRating: 2,
      currentRank: '1',
      targetRank: '4',
      additionalGemPower: 45,
      additionalSocketPower: 49,
      netGain: 4,
      inventoryIndex: 0,
      copiesSacrificed: 1,
      upgradeType: 'partial',
      sacrificedGems: [spareCopy],
      preUpgradeGem: inv(2033, 2, '1'),
    });
    const assignments = new Map([['head', [sa]]]);
    const { filtered, droppedOps, gemsToRestore } = filterUpgradesToSocketed([delta], assignments, assignments);
    expect(filtered.length).toBe(0);
    expect(droppedOps.length).toBe(1);
    expect(gemsToRestore.some((g) => g.rank === '1' && g.gemId === 2033)).toBe(true);
  });

  it('drops an upgrade not socketed in a five-star main gem, and withholds its spare copies when the result is socketed elsewhere', () => {
    // The upgraded target (rank 4) is socketed in a 2-star main gem, which
    // never appears in `fiveStarAssignments`.
    const target = inv(2033, 2, '4');
    const twoStarSa: SocketAssignment = makeSocketAssignment({ socketIndex: 1, gem: target, copyId: 0, contribution: target.contribution });
    const spareCopy = inv(2033, 2, '1');
    const delta: UpgradeDelta = makeUpgradeDelta({
      gemId: 2033,
      starRating: 2,
      currentRank: '1',
      targetRank: '4',
      additionalGemPower: 45,
      additionalSocketPower: 49,
      netGain: 4,
      inventoryIndex: 0,
      copiesSacrificed: 1,
      upgradeType: 'partial',
      sacrificedGems: [spareCopy],
      preUpgradeGem: inv(2033, 2, '1'),
    });
    const allAssignments = new Map([['ring', [twoStarSa]]]);
    const { filtered, droppedOps, gemsToRestore } = filterUpgradesToSocketed([delta], new Map(), allAssignments);
    expect(filtered.length).toBe(0);
    expect(droppedOps.length).toBe(1);
    expect(gemsToRestore).toEqual([]);
  });
});

describe('multi-type chain building', () => {
  it('only one copy per type is upgraded; others serve as spare copies', () => {
    const highRank = inv(2033, 2, '4'); // contribution 53
    const lowRank1 = inv(2033, 2, '1');
    const lowRank2 = inv(2033, 2, '1');
    const inventory = [lowRank1, highRank, lowRank2]; // unsorted deliberately

    const { chains } = buildUpgradeChains(inventory, new Map([[2, 99]]));
    expect(chains.length).toBe(1);
    const chain = chains[0];
    expect(chain.baseSubInventory[0].rank).toBe('4');
    expect(chain.baseSubInventory.length).toBe(3);
  });

  it('two different gem types each get their own chain', () => {
    const inventory = [inv(2001, 2, '1'), inv(2001, 2, '1'), inv(2033, 2, '1'), inv(2033, 2, '1')];
    const { chains } = buildUpgradeChains(inventory, new Map([[2, 99]]));
    expect(chains.length).toBe(2);
    const gemIds = new Set(chains.map((c) => c.gemId));
    expect(gemIds).toEqual(new Set([2001, 2033]));
    for (const chain of chains) expect(chain.steps.length).toBe(1);
  });

  it('materializing chains is independent across chains', () => {
    const inventory = [inv(2001, 2, '1'), inv(2001, 2, '1'), inv(2033, 2, '1'), inv(2033, 2, '1')];
    const { chains, leftover } = buildUpgradeChains(inventory, new Map([[2, 99]]));
    const chainsSorted = [...chains].sort((a, b) => a.gemId - b.gemId);
    const depths = [1, 0]; // apply chain 0 step 1, chain 1 unchanged
    const { working } = materializeUpgrades(chainsSorted, depths, leftover);

    const gem2001Ranks = working.filter((g) => g.gemId === 2001).map((g) => g.rank);
    const gem2033Ranks = working.filter((g) => g.gemId === 2033).map((g) => g.rank);

    expect(gem2001Ranks).toContain('4');
    expect(gem2033Ranks.every((r) => r === '1')).toBe(true);
    expect(gem2033Ranks.length).toBe(2);
  });
});
