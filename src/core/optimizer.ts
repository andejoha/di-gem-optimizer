/**
 * Greedy power-assignment and socket-materialization for the gem resonance
 * optimizer. This is a documented heuristic, not a provably optimal
 * assignment -- the setups involved are tiny (at most 8 main gems, 5
 * sockets each), so it converges quickly without needing to be exact.
 *
 * The optimization pipeline has three phases:
 *
 * 1. Greedy assignment (solveAssignment): Assigns inventory gem copies to
 *    main-gem sockets using a closest-fit heuristic.
 * 2. Fill empty sockets (fillEmptySockets): Fills sockets left empty by the
 *    greedy phase with resonance-maximising gems.
 * 3. Socket materialization (assignSockets): Distributes each main gem's
 *    already-decided set of copies across its own sockets to maximize
 *    activated bonuses, without changing which copies were assigned.
 *
 * Bonus activation is not a separate optimization objective -- it is folded
 * into phases 1-2 as a tie-break (see `pickWithBonusTieBreak`) and resolved
 * for free within a main gem by phase 3. See docs/SPEC.md ("Bonus
 * activation") for the rule this encodes.
 */

import { SOCKET_STAR_TYPE } from './constants';
import type { InventoryGem, MainGem, SocketAssignment } from './models';
import { makeSocketAssignment } from './models';
import { computeSocketResonanceBonus } from './rules';
import { compareTuples } from './util/tupleCompare';

/** One physical gem copy paired with its unique copy id. */
export type CopyEntry = [copyId: number, gem: InventoryGem];

/**
 * Expands an inventory list into individual (copyId, gem) pairs. Gems with
 * quantity > 1 are expanded into multiple entries with distinct sequential
 * copyIds.
 */
export function expandInventory(inventory: readonly InventoryGem[]): CopyEntry[] {
  const copies: CopyEntry[] = [];
  let copyId = 0;
  for (const gem of inventory) {
    for (let i = 0; i < gem.quantity; i++) {
      copies.push([copyId, gem]);
      copyId++;
    }
  }
  return copies;
}

// ---------------------------------------------------------------------------
// Bonus-gem demand tracking, shared by solveAssignment and fillEmptySockets
// ---------------------------------------------------------------------------

/**
 * Returns gemId -> how many unlocked sockets across all of `mainGems`
 * require that gem, ignoring current assignment state. Used to conserve a
 * scarce bonus gem: when several candidate copies are numerically tied,
 * prefer spending one that no main gem still needs over one that does.
 */
export function computeBonusGemDemand(
  mainGems: readonly MainGem[],
  bonusTable: ReadonlyMap<number, readonly number[]>,
): Map<number, number> {
  const demand = new Map<number, number>();
  for (const mainGem of mainGems) {
    const requirements = bonusTable.get(mainGem.gemId) ?? [];
    for (let socketIndex = 0; socketIndex < mainGem.numSockets; socketIndex++) {
      const requirement = socketIndex < requirements.length ? requirements[socketIndex] : 0;
      if (requirement) demand.set(requirement, (demand.get(requirement) ?? 0) + 1);
    }
  }
  return demand;
}

/**
 * Returns `totalDemand` minus what current `perSlotGems` bags already
 * satisfy (one unit of demand per occurrence of that gem in any bag).
 */
function outstandingBonusDemand(
  perSlotGems: ReadonlyMap<string, readonly CopyEntry[]>,
  totalDemand: ReadonlyMap<number, number>,
): Map<number, number> {
  const outstanding = new Map(totalDemand);
  for (const bag of perSlotGems.values()) {
    for (const [, gem] of bag) {
      const remaining = outstanding.get(gem.gemId);
      if (remaining) outstanding.set(gem.gemId, remaining - 1);
    }
  }
  for (const [gemId, count] of outstanding) {
    if (count <= 0) outstanding.delete(gemId);
  }
  return outstanding;
}

/**
 * Returns the multiset of `mainGem`'s `starType` socket-group requirements
 * not yet satisfied by `bag` (a greedy multiset match of already-assigned
 * gemIds against requirements). Only present, positive-count entries remain
 * -- `.has(gemId)` reflects whether a socket in this group could still be
 * activated by that gem.
 */
function unclaimedRequirements(
  mainGem: MainGem,
  starType: number,
  bag: readonly CopyEntry[],
  bonusTable: ReadonlyMap<number, readonly number[]>,
): Map<number, number> {
  const socketTypeMap = SOCKET_STAR_TYPE[mainGem.starRating];
  const bonusRequirements = bonusTable.get(mainGem.gemId) ?? [];
  const requirements = new Map<number, number>();
  for (let socketIndex = 0; socketIndex < mainGem.numSockets; socketIndex++) {
    if (socketTypeMap[socketIndex] !== starType) continue;
    const requirement = socketIndex < bonusRequirements.length ? bonusRequirements[socketIndex] : 0;
    if (requirement) requirements.set(requirement, (requirements.get(requirement) ?? 0) + 1);
  }
  for (const [, gem] of bag) {
    if (gem.starRating !== starType) continue;
    const remaining = requirements.get(gem.gemId);
    if (remaining) requirements.set(gem.gemId, remaining - 1);
  }
  for (const [gemId, count] of requirements) {
    if (count <= 0) requirements.delete(gemId);
  }
  return requirements;
}

/**
 * Picks the best CopyEntry from `candidates` by `primaryKey` (ascending).
 * When multiple candidates share the winner's exact `(contribution,
 * activeStars)` signature -- a numeric tie, since neither field depends on
 * gem identity -- re-picks among only that pool to prefer, in order: a copy
 * that activates a bonus per `unclaimed`, else a copy not still needed
 * elsewhere per `outstanding`. `copyId` breaks all remaining ties for
 * determinism.
 *
 * The tie-break only ever chooses among candidates matching the winner's
 * exact signature, so every numeric field of the result stays governed by
 * `primaryKey` alone -- only which specific gem id lands in the socket can
 * change. This distinction matters for `fillEmptySockets`, whose
 * `primaryKey` ranks by resonance: resonance truncates rank, so e.g. 5-star
 * ranks 6, 6.1, ... 6.11 all tie on resonance despite having different
 * contribution and extractable power. A resonance tie is not necessarily a
 * signature tie.
 */
function pickWithBonusTieBreak(
  candidates: readonly CopyEntry[],
  primaryKey: (entry: CopyEntry) => readonly (number | string)[],
  unclaimed: ReadonlyMap<number, number>,
  outstanding: ReadonlyMap<number, number>,
): CopyEntry {
  let winner = candidates[0];
  let winnerKey = primaryKey(winner);
  for (let i = 1; i < candidates.length; i++) {
    const key = primaryKey(candidates[i]);
    if (compareTuples(key, winnerKey) < 0) {
      winner = candidates[i];
      winnerKey = key;
    }
  }

  const winnerGem = winner[1];
  const pool = candidates.filter(([, gem]) => gem.contribution === winnerGem.contribution && gem.activeStars === winnerGem.activeStars);
  if (pool.length <= 1) return winner;

  const tieBreakKey = ([copyId, gem]: CopyEntry): readonly (number | string)[] => [
    unclaimed.has(gem.gemId) ? 0 : 1,
    outstanding.has(gem.gemId) ? 1 : 0,
    copyId,
  ];

  let best = pool[0];
  let bestKey = tieBreakKey(best);
  for (let i = 1; i < pool.length; i++) {
    const key = tieBreakKey(pool[i]);
    if (compareTuples(key, bestKey) < 0) {
      best = pool[i];
      bestKey = key;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Phase 1: greedy assignment
// ---------------------------------------------------------------------------

/**
 * Assigns inventory gem copies to main-gem sockets via a greedy closest-fit
 * heuristic. Two sequential passes -- 5-star inventory gems first, then
 * 2-star. Only 5-star main gems participate. On a numeric tie, prefers a
 * copy that activates the target main gem's bonus, else one not still
 * needed as a bonus gem elsewhere (see `pickWithBonusTieBreak`).
 */
export function solveAssignment(
  mainGems: readonly MainGem[],
  inventory: readonly InventoryGem[],
  bonusTable: ReadonlyMap<number, readonly number[]>,
  totalDemand: ReadonlyMap<number, number>,
): Map<string, CopyEntry[]> {
  const fiveStarGems = mainGems.filter((mainGem) => mainGem.starRating === 5);
  if (fiveStarGems.length === 0 || inventory.length === 0) {
    return new Map();
  }

  // Free socket count per main gem per accepted star type, restricted to
  // unlocked sockets. SOCKET_STAR_TYPE[5] = {0:2, 1:2, 2:2, 3:5, 4:5}.
  const freeSocketCount: Map<number, number>[] = fiveStarGems.map((mainGem) => {
    const socketCapacity = new Map<number, number>();
    for (let socketIndex = 0; socketIndex < mainGem.numSockets; socketIndex++) {
      const starType = SOCKET_STAR_TYPE[5][socketIndex];
      socketCapacity.set(starType, (socketCapacity.get(starType) ?? 0) + 1);
    }
    return socketCapacity;
  });

  const residuals = fiveStarGems.map((mainGem) => mainGem.requiredPower);
  const result = new Map<string, CopyEntry[]>(fiveStarGems.map((mainGem) => [mainGem.slotName, []]));

  // All candidate copies, excluding zero-contribution gems. Each copy may be
  // used in at most one socket globally; usedCopyIds tracks assignments
  // across both star-type passes.
  const allCopies = expandInventory(inventory).filter(([, gem]) => gem.contribution > 0);
  const usedCopyIds = new Set<number>();

  for (const starPass of [5, 2]) {
    const availableCopies = allCopies.filter(([copyId, gem]) => gem.starRating === starPass && !usedCopyIds.has(copyId));

    while (availableCopies.length > 0) {
      // Find the main gem with the highest current residual that still has
      // a free socket of this star type.
      let targetIndex = -1;
      let targetKey: readonly (number | string)[] | null = null;
      for (let gemIndex = 0; gemIndex < fiveStarGems.length; gemIndex++) {
        if (residuals[gemIndex] <= 0) continue;
        if ((freeSocketCount[gemIndex].get(starPass) ?? 0) <= 0) continue;
        const key = [residuals[gemIndex], -gemIndex];
        if (targetKey === null || compareTuples(key, targetKey) > 0) {
          targetKey = key;
          targetIndex = gemIndex;
        }
      }
      if (targetIndex < 0) break;

      // Pick the gem whose power is closest to the current residual. On a
      // numeric tie, prefer one that activates this main gem's bonus, else
      // one not needed elsewhere; copyId breaks remaining ties.
      const targetMainGem = fiveStarGems[targetIndex];
      const targetResidual = residuals[targetIndex];
      const unclaimed = unclaimedRequirements(targetMainGem, starPass, result.get(targetMainGem.slotName) ?? [], bonusTable);
      const outstanding = outstandingBonusDemand(result, totalDemand);
      const chosen = pickWithBonusTieBreak(
        availableCopies,
        ([copyId, gem]) => [Math.abs(gem.contribution - targetResidual), -gem.contribution, copyId],
        unclaimed,
        outstanding,
      );
      const chosenIndex = availableCopies.findIndex(([copyId]) => copyId === chosen[0]);

      const [copyId, gem] = availableCopies.splice(chosenIndex, 1)[0];
      usedCopyIds.add(copyId);
      result.get(targetMainGem.slotName)!.push([copyId, gem]);
      const freeMap = freeSocketCount[targetIndex];
      freeMap.set(gem.starRating, (freeMap.get(gem.starRating) ?? 0) - 1);
      residuals[targetIndex] = Math.max(0, residuals[targetIndex] - gem.contribution);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Phase 2: fill empty sockets
// ---------------------------------------------------------------------------

/**
 * Fills sockets left empty by the greedy phase with the highest-resonance
 * compatible gem, per main gem, per accepted star type. On a numeric tie,
 * prefers a copy that activates that main gem's bonus, else one not still
 * needed as a bonus gem elsewhere (see `pickWithBonusTieBreak`).
 */
export function fillEmptySockets(
  mainGems: readonly MainGem[],
  perSlotGems: ReadonlyMap<string, readonly CopyEntry[]>,
  bonusTable: ReadonlyMap<number, readonly number[]>,
  allCopies: readonly CopyEntry[],
  totalDemand: ReadonlyMap<number, number>,
): Map<string, CopyEntry[]> {
  const current = new Map<string, CopyEntry[]>();
  for (const [slot, gems] of perSlotGems) current.set(slot, [...gems]);
  const usedCopyIds = new Set<number>();
  for (const gems of current.values()) for (const [copyId] of gems) usedCopyIds.add(copyId);

  const getUnassigned = (): CopyEntry[] => allCopies.filter(([copyId]) => !usedCopyIds.has(copyId));

  /** Returns {starType: emptyCount} for each socket type of this gem. */
  const emptySlotCountByStarType = (mainGem: MainGem): Map<number, number> => {
    const socketTypeMap = SOCKET_STAR_TYPE[mainGem.starRating];
    const socketCapacity = new Map<number, number>();
    for (let socketIndex = 0; socketIndex < mainGem.numSockets; socketIndex++) {
      const starType = socketTypeMap[socketIndex];
      socketCapacity.set(starType, (socketCapacity.get(starType) ?? 0) + 1);
    }
    const assignedByStarType = new Map<number, number>();
    for (const [, gem] of current.get(mainGem.slotName) ?? []) {
      assignedByStarType.set(gem.starRating, (assignedByStarType.get(gem.starRating) ?? 0) + 1);
    }
    const result = new Map<number, number>();
    for (const [starType, capacity] of socketCapacity) {
      result.set(starType, Math.max(0, capacity - (assignedByStarType.get(starType) ?? 0)));
    }
    return result;
  };

  for (const mainGem of mainGems) {
    const emptyCounts = emptySlotCountByStarType(mainGem);
    for (const [starType, initialEmptyCount] of emptyCounts) {
      let emptyCount = initialEmptyCount;
      while (emptyCount > 0) {
        const compatible = getUnassigned().filter(([, gem]) => gem.starRating === starType);
        if (compatible.length === 0) break;

        const unclaimed = unclaimedRequirements(mainGem, starType, current.get(mainGem.slotName) ?? [], bonusTable);
        const outstanding = outstandingBonusDemand(current, totalDemand);
        const chosen = pickWithBonusTieBreak(
          compatible,
          ([copyId, gem]) => [-computeSocketResonanceBonus(gem.starRating, gem.activeStars, gem.rank), copyId],
          unclaimed,
          outstanding,
        );

        current.get(mainGem.slotName)!.push(chosen);
        usedCopyIds.add(chosen[0]);
        emptyCount -= 1;
      }
    }
  }

  return current;
}

// ---------------------------------------------------------------------------
// Phase 3: socket materialization
// ---------------------------------------------------------------------------

/**
 * Distributes `bag` -- the copies already decided (by solveAssignment /
 * fillEmptySockets) to belong to `mainGem` -- across its own sockets to
 * maximize activated bonuses, without changing which copies are assigned.
 * Resolved independently per star-type group.
 *
 * This reduces to trivial bipartite matching: no two sockets of the same
 * star type on the same main gem ever require the same gem id (verified in
 * `test/core/data.test.ts` against the shipped catalog), so a copy can
 * satisfy at most one socket's requirement in a group. Pass 1 places every
 * exact match; pass 2 fills whatever sockets remain with whatever copies
 * remain, in ascending socket-index / copyId order.
 */
export function assignSockets(
  mainGem: MainGem,
  bag: readonly CopyEntry[],
  bonusTable: ReadonlyMap<number, readonly number[]>,
): SocketAssignment[] {
  const socketTypeMap = SOCKET_STAR_TYPE[mainGem.starRating];
  const bonusRequirements = bonusTable.get(mainGem.gemId) ?? [];
  const requirementAt = (socketIndex: number): number => (socketIndex < bonusRequirements.length ? bonusRequirements[socketIndex] : 0);

  const acceptedStarTypes = [...new Set(Object.values(socketTypeMap))].sort((a, b) => a - b);
  const placements = new Map<number, CopyEntry>();

  for (const starType of acceptedStarTypes) {
    const sockets: number[] = [];
    for (let socketIndex = 0; socketIndex < mainGem.numSockets; socketIndex++) {
      if (socketTypeMap[socketIndex] === starType) sockets.push(socketIndex);
    }
    const pool = bag.filter(([, gem]) => gem.starRating === starType);
    const used = new Set<number>();

    // Pass 1: exact requirement match. Lowest copyId wins if more than one
    // copy of the required gem is present.
    for (const socketIndex of sockets) {
      const requirement = requirementAt(socketIndex);
      if (!requirement) continue; // Defensive: the shipped catalog never omits a requirement.
      let match: CopyEntry | null = null;
      for (const entry of pool) {
        const [copyId, gem] = entry;
        if (used.has(copyId) || gem.gemId !== requirement) continue;
        if (match === null || copyId < match[0]) match = entry;
      }
      if (match !== null) {
        used.add(match[0]);
        placements.set(socketIndex, match);
      }
    }

    // Pass 2: fill remaining sockets with remaining copies, ascending
    // socket index and copyId.
    const leftover = pool.filter(([copyId]) => !used.has(copyId)).sort((a, b) => a[0] - b[0]);
    let cursor = 0;
    for (const socketIndex of sockets) {
      if (placements.has(socketIndex) || cursor >= leftover.length) continue;
      placements.set(socketIndex, leftover[cursor++]);
    }
  }

  const result: SocketAssignment[] = [];
  for (let socketIndex = 0; socketIndex < mainGem.numSockets; socketIndex++) {
    const placed = placements.get(socketIndex);
    if (placed === undefined) {
      result.push(makeSocketAssignment({ socketIndex }));
      continue;
    }
    const [copyId, gem] = placed;
    const requirement = requirementAt(socketIndex);
    result.push(
      makeSocketAssignment({
        socketIndex,
        gem,
        copyId,
        contribution: gem.contribution,
        bonusActivated: Boolean(requirement && gem.gemId === requirement),
      }),
    );
  }
  return result;
}
