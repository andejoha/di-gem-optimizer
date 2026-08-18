/**
 * Upgrade optimization for the gem resonance optimizer. Discovers
 * profitable gem upgrades, applies them in-memory, and lets the caller
 * re-run the optimizer to determine whether the upgraded configuration
 * reduces the player's overall gem-power cost.
 *
 * In `buildUpgradeChains`, `groups` (keyed by gem id and star rating) is a
 * Map populated in inventory-scan order. That order determines the order
 * of the returned `chains` array, which in turn determines which chain the
 * caller's downgrade walk peels first -- so it must stay a Map, not a
 * plain object, to preserve insertion order.
 */

import { SOCKET_STAR_TYPE } from './constants';
import { COST_1STAR, COST_2STAR, COST_5STAR } from './data';
import type { InventoryGem, MainGem, SocketAssignment, UpgradeCostEntry, UpgradeDelta } from './models';
import { makeInventoryGem, makeUpgradeDelta } from './models';
import { computeContribution } from './rules';
import { cloneGems } from './util/clone';
import { countOf, gemRankKey, gemTypeKey, increment } from './util/keys';
import { compareTuples } from './util/tupleCompare';

function costTable(starRating: number): ReadonlyMap<string, UpgradeCostEntry> {
  if (starRating === 1) return COST_1STAR;
  if (starRating === 2) return COST_2STAR;
  return COST_5STAR;
}

/**
 * Returns rank strings for the given star rating, ordered from lowest to
 * highest, by (requiredGems, requiredGemPower) rather than lexicographically
 * (which would put "6.10" before "6.9").
 */
export function getSortedRanks(starRating: number): string[] {
  if (starRating !== 1 && starRating !== 2 && starRating !== 5) {
    throw new Error(`Unknown star_rating: ${starRating}. Must be 1, 2, or 5.`);
  }
  const table = costTable(starRating);
  return [...table.keys()].sort((a, b) =>
    compareTuples(
      [table.get(a)!.requiredGems, table.get(a)!.requiredGemPower],
      [table.get(b)!.requiredGems, table.get(b)!.requiredGemPower],
    ),
  );
}

/** Computes the incremental cost and benefit of upgrading a gem one rank step. */
export function computeUpgradeDelta(
  starRating: number,
  fromRank: string,
  toRank: string,
  inventoryIndex: number,
  gemId: number,
): UpgradeDelta {
  const table = costTable(starRating);
  const fromEntry = table.get(fromRank);
  const toEntry = table.get(toRank);
  if (fromEntry === undefined) throw new Error(`Rank '${fromRank}' not found in ${starRating}-star cost table.`);
  if (toEntry === undefined) throw new Error(`Rank '${toRank}' not found in ${starRating}-star cost table.`);

  const fromContribution = computeContribution(starRating, fromRank, table);
  const toContribution = computeContribution(starRating, toRank, table);

  const additionalGemPower = toEntry.requiredGemPower - fromEntry.requiredGemPower;
  const additionalSocketPower = toContribution - fromContribution;
  const netGain = additionalSocketPower - additionalGemPower;

  return makeUpgradeDelta({
    gemId,
    starRating,
    currentRank: fromRank,
    targetRank: toRank,
    additionalGemPower,
    additionalSocketPower,
    netGain,
    inventoryIndex,
  });
}

/**
 * Finds indices of the cheapest spare copies of a gem available for
 * sacrifice (by contribution ascending). Returns null if fewer than
 * neededCopies spares exist.
 */
function findSpareIndices(
  working: readonly InventoryGem[],
  gemIndex: number,
  neededCopies: number,
  excludedIndices: ReadonlySet<number> = new Set(),
  requiredRank: string | null = null,
): number[] | null {
  const gem = working[gemIndex];
  const excluded = new Set(excludedIndices);
  excluded.add(gemIndex);
  const spares: [number, InventoryGem][] = [];
  for (let index = 0; index < working.length; index++) {
    if (excluded.has(index)) continue;
    const candidate = working[index];
    if (candidate.starRating !== gem.starRating) continue;
    if (candidate.gemId !== gem.gemId) continue;
    if (requiredRank !== null && candidate.rank !== requiredRank) continue;
    spares.push([index, candidate]);
  }
  if (spares.length < neededCopies) return null;
  spares.sort((a, b) => a[1].contribution - b[1].contribution);
  return spares.slice(0, neededCopies).map(([index]) => index);
}

/** One upgrade step in a gem's potential upgrade trajectory. */
export interface GemUpgradeStep {
  fromRank: string;
  toRank: string;
  gemPowerCost: number;
  deltas: UpgradeDelta[];
  /** Socketed power of the target gem after this step. */
  contributionAfter: number;
  /** Snapshot of this gem type's sub-inventory after the step is applied. */
  subInventoryAfter: InventoryGem[];
}

/** The complete upgrade trajectory for one (gemId, starRating) type. */
export interface GemUpgradeChain {
  gemId: number;
  starRating: number;
  /** Original copies of this type before any upgrades (highest-ranked first). */
  baseSubInventory: InventoryGem[];
  steps: GemUpgradeStep[];
}

/**
 * Returns the total socket count per inventory gem star rating across all
 * 5-star main gems.
 */
export function computeSocketCounts(mainGems: readonly MainGem[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const mainGem of mainGems) {
    if (mainGem.starRating !== 5) continue;
    for (let socketIndex = 0; socketIndex < mainGem.numSockets; socketIndex++) {
      const starType = SOCKET_STAR_TYPE[5][socketIndex];
      counts.set(starType, (counts.get(starType) ?? 0) + 1);
    }
  }
  return counts;
}

/** Returns which gem star ratings have at least one available socket. */
export function computeSocketableStarRatings(mainGems: readonly MainGem[]): Set<number> {
  return new Set(computeSocketCounts(mainGems).keys());
}

/**
 * Builds upgrade trajectories for the top gem types per star, capped by
 * socket capacity. See the module-level ordering note for why `groups` must
 * be a Map, not a plain object.
 */
export function buildUpgradeChains(
  inventory: readonly InventoryGem[],
  socketCounts: ReadonlyMap<number, number>,
): { chains: GemUpgradeChain[]; leftover: InventoryGem[] } {
  const socketableStarRatings = new Set(socketCounts.keys());
  const leftover: InventoryGem[] = inventory.filter((gem) => !socketableStarRatings.has(gem.starRating));

  // Keyed by gemTypeKey(gemId, starRating); insertion order = first-seen
  // order scanning inventory. This order determines the final `chains`
  // array order -- see module docstring.
  const groups = new Map<string, InventoryGem[]>();
  const groupIdentity = new Map<string, { gemId: number; starRating: number }>();
  for (const gem of inventory) {
    if (!socketableStarRatings.has(gem.starRating)) continue;
    const key = gemTypeKey(gem.gemId, gem.starRating);
    const list = groups.get(key);
    if (list) list.push(gem);
    else {
      groups.set(key, [gem]);
      groupIdentity.set(key, { gemId: gem.gemId, starRating: gem.starRating });
    }
  }

  // For each star rating, rank gem types and select the top socketCounts[star].
  const selectedTypes = new Set<string>();
  const candidatesByStar = new Map<number, string[]>();
  for (const key of groups.keys()) {
    const { starRating } = groupIdentity.get(key)!;
    const list = candidatesByStar.get(starRating);
    if (list) list.push(key);
    else candidatesByStar.set(starRating, [key]);
  }

  for (const [starRating, candidateTypes] of candidatesByStar) {
    const slotCount = socketCounts.get(starRating) ?? 0;
    if (slotCount <= 0) continue;
    candidateTypes.sort((a, b) => {
      const gA = groups.get(a)!;
      const gB = groups.get(b)!;
      const maxContribA = Math.max(...gA.map((g) => g.contribution));
      const maxContribB = Math.max(...gB.map((g) => g.contribution));
      const idA = groupIdentity.get(a)!.gemId;
      const idB = groupIdentity.get(b)!.gemId;
      return compareTuples([-maxContribA, -gA.length, idA], [-maxContribB, -gB.length, idB]);
    });
    for (const key of candidateTypes.slice(0, slotCount)) selectedTypes.add(key);
  }

  const chains: GemUpgradeChain[] = [];

  for (const [key, copies] of groups) {
    const { gemId, starRating } = groupIdentity.get(key)!;
    if (!selectedTypes.has(key)) {
      leftover.push(...copies);
      continue;
    }

    // Highest-contribution copy is the target; rest are spare copies.
    const copiesSorted = copies.slice().sort((a, b) => -compareTuples([a.contribution, a.gemId], [b.contribution, b.gemId]));
    const baseSubInventory = cloneGems(copiesSorted);

    // Working sub-inventory: index 0 is always the upgrade target. Shallow
    // copy suffices -- InventoryGem objects are replaced wholesale, never
    // mutated in place.
    const workingSub: InventoryGem[] = [...copiesSorted];

    const table = costTable(starRating);
    const sortedRanks = getSortedRanks(starRating);
    const rankToPosition = new Map(sortedRanks.map((rank, position) => [rank, position]));
    const steps: GemUpgradeStep[] = [];

    while (true) {
      const target = workingSub[0];
      const currentPosition = rankToPosition.get(target.rank);
      if (currentPosition === undefined) break;

      // Find the next rank that consumes at least one extra copy.
      const currentRequiredGems = table.get(target.rank)!.requiredGems;
      let nextRank: string | null = null;
      for (let i = currentPosition + 1; i < sortedRanks.length; i++) {
        const rank = sortedRanks[i];
        if (table.get(rank)!.requiredGems > currentRequiredGems) {
          nextRank = rank;
          break;
        }
      }
      if (nextRank === null) break;

      const sparesNeeded = table.get(nextRank)!.requiredGems - table.get(target.rank)!.requiredGems;
      const sacrificeIndices = findSpareIndices(workingSub, 0, sparesNeeded, new Set(), '1');
      if (sacrificeIndices === null) break;

      const delta = computeUpgradeDelta(starRating, target.rank, nextRank, 0, gemId);

      const oldGem = workingSub[0];
      const newContribution = computeContribution(starRating, nextRank, table);
      workingSub[0] = makeInventoryGem({
        gemId: oldGem.gemId,
        starRating: oldGem.starRating,
        rank: nextRank,
        quantity: oldGem.quantity,
        activeStars: oldGem.activeStars,
        contribution: newContribution,
      });
      const sacrificedGems = sacrificeIndices.map((index) => workingSub[index]);
      // Remove highest indices first so earlier indices stay valid.
      for (const sacrificeIndex of [...sacrificeIndices].sort((a, b) => b - a)) {
        workingSub.splice(sacrificeIndex, 1);
      }

      steps.push({
        fromRank: oldGem.rank,
        toRank: nextRank,
        gemPowerCost: delta.additionalGemPower,
        deltas: [
          makeUpgradeDelta({
            gemId,
            starRating,
            currentRank: oldGem.rank,
            targetRank: nextRank,
            additionalGemPower: delta.additionalGemPower,
            additionalSocketPower: delta.additionalSocketPower,
            netGain: delta.netGain,
            inventoryIndex: 0,
            copiesSacrificed: sacrificeIndices.length,
            upgradeType: 'partial',
            sacrificedGems,
            preUpgradeGem: oldGem,
          }),
        ],
        contributionAfter: workingSub[0].contribution,
        subInventoryAfter: cloneGems(workingSub),
      });
    }

    chains.push({ gemId, starRating, baseSubInventory, steps });
  }

  return { chains, leftover };
}

/**
 * Realizes a depth vector as a concrete inventory, delta list, and
 * gem-power cost. zip(chains, depths) truncates to the shorter of the two
 * -- mirrored here via Math.min.
 */
export function materializeUpgrades(
  chains: readonly GemUpgradeChain[],
  depths: readonly number[],
  leftover: readonly InventoryGem[],
): { working: InventoryGem[]; appliedDeltas: UpgradeDelta[]; totalCost: number } {
  const working: InventoryGem[] = cloneGems(leftover);
  const appliedDeltas: UpgradeDelta[] = [];
  let totalCost = 0;

  const len = Math.min(chains.length, depths.length);
  for (let i = 0; i < len; i++) {
    const chain = chains[i];
    const depth = depths[i];
    if (depth === 0) {
      working.push(...cloneGems(chain.baseSubInventory));
    } else {
      working.push(...cloneGems(chain.steps[depth - 1].subInventoryAfter));
      for (const step of chain.steps.slice(0, depth)) {
        appliedDeltas.push(...step.deltas);
        totalCost += step.gemPowerCost;
      }
    }
  }

  return { working, appliedDeltas, totalCost };
}

/** Counts each (gemId, starRating, rank) that appears in a socket. */
function countSocketedRanks(gemAssignments: ReadonlyMap<string, readonly SocketAssignment[]>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const assignments of gemAssignments.values()) {
    for (const assignment of assignments) {
      if (assignment.gem !== null) {
        const key = gemRankKey(assignment.gem.gemId, assignment.gem.starRating, assignment.gem.rank);
        increment(counts, key);
      }
    }
  }
  return counts;
}

/**
 * Walks `operations` in reverse against `neededSeed`, tracing each chain
 * backward: if gem X is upgraded 3->4->5 and rank 5 is in `neededSeed`, all
 * steps up to and including that one are marked relevant, and the chain's
 * starting rank is added back to the needed count so an earlier step in the
 * same chain can also match. Returns one boolean per operation, in order.
 */
function computeRelevantOperations(
  operations: ReadonlyArray<[UpgradeDelta[], UpgradeDelta]>,
  neededSeed: ReadonlyMap<string, number>,
): boolean[] {
  const needed = new Map(neededSeed);
  const relevant: boolean[] = operations.map(() => false);
  for (let operationIndex = operations.length - 1; operationIndex >= 0; operationIndex--) {
    const [, mainDelta] = operations[operationIndex];
    const key = gemRankKey(mainDelta.gemId, mainDelta.starRating, mainDelta.targetRank);
    if (countOf(needed, key) > 0) {
      needed.set(key, countOf(needed, key) - 1);
      relevant[operationIndex] = true;
      const preKey = gemRankKey(mainDelta.gemId, mainDelta.starRating, mainDelta.currentRank);
      increment(needed, preKey);
    }
  }
  return relevant;
}

/**
 * Returns filtered upgrades (kept and charged for), dropped operations, and
 * gems to restore. An upgrade's cost is kept only if its resulting rank is
 * socketed in `fiveStarAssignments`. A dropped upgrade's spare copies are
 * withheld from `gemsToRestore` when its resulting rank is socketed
 * anywhere in `allAssignments`.
 */
export function filterUpgradesToSocketed(
  appliedUpgrades: readonly UpgradeDelta[],
  fiveStarAssignments: ReadonlyMap<string, readonly SocketAssignment[]>,
  allAssignments: ReadonlyMap<string, readonly SocketAssignment[]>,
): { filtered: UpgradeDelta[]; droppedOps: Array<[UpgradeDelta[], UpgradeDelta]>; gemsToRestore: InventoryGem[] } {
  // Group upgrades into operations: (preparationSteps, mainDelta).
  const operations: Array<[UpgradeDelta[], UpgradeDelta]> = [];
  let currentPreps: UpgradeDelta[] = [];
  for (const delta of appliedUpgrades) {
    if (delta.upgradeType === 'preparation') {
      currentPreps.push(delta);
    } else {
      operations.push([currentPreps, delta]);
      currentPreps = [];
    }
  }

  const costRelevant = computeRelevantOperations(operations, countSocketedRanks(fiveStarAssignments));
  const stillInUse = computeRelevantOperations(operations, countSocketedRanks(allAssignments));

  const filtered: UpgradeDelta[] = [];
  const droppedOps: Array<[UpgradeDelta[], UpgradeDelta]> = [];
  const gemsToRestore: InventoryGem[] = [];

  operations.forEach(([preps, mainDelta], operationIndex) => {
    if (costRelevant[operationIndex]) {
      filtered.push(...preps, mainDelta);
      return;
    }
    droppedOps.push([preps, mainDelta]);
    if (stillInUse[operationIndex]) return; // still socketed elsewhere -- its spare copies are not restored
    if (preps.length > 0) {
      // Direct upgrade with prep steps: restore material gems at their
      // pre-prep ranks via preUpgradeGem, not their post-prep ranks.
      const preppedKeys = new Set(preps.map((prep) => gemRankKey(prep.gemId, prep.starRating, prep.targetRank)));
      for (const sacrificedGem of mainDelta.sacrificedGems) {
        if (!preppedKeys.has(gemRankKey(sacrificedGem.gemId, sacrificedGem.starRating, sacrificedGem.rank))) {
          gemsToRestore.push(sacrificedGem); // non-prepped material
        }
      }
      for (const prepDelta of preps) {
        if (prepDelta.preUpgradeGem !== null) gemsToRestore.push(prepDelta.preUpgradeGem);
        gemsToRestore.push(...prepDelta.sacrificedGems);
      }
    } else {
      gemsToRestore.push(...mainDelta.sacrificedGems);
    }
  });

  return { filtered, droppedOps, gemsToRestore };
}
