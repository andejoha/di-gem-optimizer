/**
 * Greedy power-assignment and bonus optimization for the gem resonance optimizer.
 *
 * Ported line-for-line from backend/app/core/optimizer.py. This is the
 * highest tie-break-risk module in the port -- see the module-level
 * comments below for the specific Python semantics each function relies on.
 *
 * The optimization pipeline has four phases:
 *
 * 1. Greedy assignment (solveAssignment): Assigns inventory gem copies to
 *    main-gem sockets using a closest-fit heuristic.
 * 2. Fill empty sockets (fillEmptySockets): Fills sockets left empty by the
 *    greedy phase with bonus-targeting or resonance-maximising gems.
 * 3. Cross-gem redistribution (redistributeForBonuses): Swaps gem ownership
 *    between main gems to activate more resonance bonuses.
 * 4. Intra-gem reordering (reorderForBonuses): Brute-force permutation
 *    within each star-type group to place the right gem in the right socket.
 *
 * NOTE ON DELIBERATE INEFFICIENCY: `totalResidualFor(mainGems, current)` is
 * recomputed inside the innermost candidate loops of redistributeForBonuses,
 * exactly as in the Python source, even though it is loop-invariant within a
 * sweep. This is a known, documented inefficiency in the original -- do not
 * "fix" it here. Hoisting it changes nothing numerically (current is not
 * mutated during candidate generation) so it is a safe follow-up, but it
 * must land as a separate, individually-verified change after the
 * differential harness is green, per the migration plan.
 */

import { MAX_SOCKETS, SOCKET_STAR_TYPE } from './constants';
import { COST_TABLES } from './data';
import type { InventoryGem, MainGem, SocketAssignment } from './models';
import { makeSocketAssignment } from './models';
import { computeExtractablePower, computeSocketResonanceBonus } from './rules';
import { cmpTuple } from './util/tupleCompare';
import { permutations } from './util/permutations';

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

/**
 * Assigns inventory gem copies to main-gem sockets via a greedy closest-fit
 * heuristic. Two sequential passes -- 5-star inventory gems first, then
 * 2-star. Only 5-star main gems participate.
 */
export function solveAssignment(
  mainGems: readonly MainGem[],
  inventory: readonly InventoryGem[],
): Map<string, CopyEntry[]> {
  const fiveStarGems = mainGems.filter((mg) => mg.starRating === 5);
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

  const residuals = fiveStarGems.map((mg) => mg.requiredPower);
  const result = new Map<string, CopyEntry[]>(fiveStarGems.map((mg) => [mg.slotName, []]));

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
        if (targetKey === null || cmpTuple(key, targetKey) > 0) {
          targetKey = key;
          targetIndex = gemIndex;
        }
      }
      if (targetIndex < 0) break;

      // Pick the gem whose power is closest to the current residual. On
      // equal distance the larger gem wins; copyId breaks remaining ties.
      let bestCopyIndex = -1;
      let bestSelectionKey: readonly (number | string)[] | null = null;
      for (let copyIndex = 0; copyIndex < availableCopies.length; copyIndex++) {
        const [copyId, gem] = availableCopies[copyIndex];
        const selectionKey = [Math.abs(gem.contribution - residuals[targetIndex]), -gem.contribution, copyId];
        if (bestSelectionKey === null || cmpTuple(selectionKey, bestSelectionKey) < 0) {
          bestSelectionKey = selectionKey;
          bestCopyIndex = copyIndex;
        }
      }

      const [copyId, gem] = availableCopies.splice(bestCopyIndex, 1)[0];
      usedCopyIds.add(copyId);
      result.get(fiveStarGems[targetIndex].slotName)!.push([copyId, gem]);
      const freeMap = freeSocketCount[targetIndex];
      freeMap.set(gem.starRating, (freeMap.get(gem.starRating) ?? 0) - 1);
      residuals[targetIndex] = Math.max(0, residuals[targetIndex] - gem.contribution);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Post-assignment phases
// ---------------------------------------------------------------------------

/**
 * Fills empty sockets with leftover inventory gems using a two-pass
 * strategy: (1) satisfy scarce bonus requirements across ALL main gems
 * before (2) filling remaining positions with the highest-resonance
 * compatible gem.
 */
export function fillEmptySockets(
  mainGems: readonly MainGem[],
  perSlotGems: ReadonlyMap<string, readonly CopyEntry[]>,
  bonusTable: ReadonlyMap<number, readonly number[]>,
  allCopies: readonly CopyEntry[],
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

  /** Returns bonus gemIds for starType sockets not yet satisfiable. */
  const unsatisfiedBonusRequirements = (mainGem: MainGem, starType: number): number[] => {
    const socketTypeMap = SOCKET_STAR_TYPE[mainGem.starRating];
    const bonusReqs = bonusTable.get(mainGem.gemId) ?? [];
    const requirements: number[] = [];
    for (let socketIndex = 0; socketIndex < mainGem.numSockets; socketIndex++) {
      if (socketTypeMap[socketIndex] === starType) {
        requirements.push(socketIndex < bonusReqs.length ? bonusReqs[socketIndex] : 0);
      }
    }
    const alreadyAssigned = (current.get(mainGem.slotName) ?? [])
      .filter(([, gem]) => gem.starRating === starType)
      .map(([, gem]) => gem.gemId);
    const alreadyMatched = alreadyAssigned.map(() => false);
    const unsatisfied: number[] = [];
    for (const requirement of requirements) {
      if (!requirement) continue;
      let matched = false;
      for (let matchIndex = 0; matchIndex < alreadyAssigned.length; matchIndex++) {
        if (!alreadyMatched[matchIndex] && alreadyAssigned[matchIndex] === requirement) {
          alreadyMatched[matchIndex] = true;
          matched = true;
          break;
        }
      }
      if (!matched) unsatisfied.push(requirement);
    }
    return unsatisfied;
  };

  // Pass 1: fill sockets where a bonus gem is needed but not yet present.
  let unassigned = getUnassigned();
  for (const mainGem of mainGems) {
    const emptyCounts = emptySlotCountByStarType(mainGem);
    for (const [starType, initialEmptyCount] of emptyCounts) {
      let emptyCount = initialEmptyCount;
      if (emptyCount <= 0) continue;
      for (const requiredGemId of unsatisfiedBonusRequirements(mainGem, starType)) {
        if (emptyCount <= 0) break;
        for (let position = 0; position < unassigned.length; position++) {
          const [copyId, gem] = unassigned[position];
          if (gem.starRating === starType && gem.gemId === requiredGemId) {
            current.get(mainGem.slotName)!.push([copyId, gem]);
            usedCopyIds.add(copyId);
            unassigned.splice(position, 1);
            emptyCount -= 1;
            break;
          }
        }
      }
    }
  }

  // Pass 2: fill remaining empty sockets with the highest-resonance compatible gem.
  unassigned = getUnassigned();
  for (const mainGem of mainGems) {
    const emptyCounts = emptySlotCountByStarType(mainGem);
    for (const [starType, initialEmptyCount] of emptyCounts) {
      let emptyCount = initialEmptyCount;
      if (emptyCount <= 0) continue;
      // sorted(..., reverse=True) -- stable descending sort by resonance bonus.
      const compatible = unassigned
        .filter(([, gem]) => gem.starRating === starType)
        .slice()
        .sort(
          (a, b) =>
            computeSocketResonanceBonus(b[1].starRating, b[1].activeStars, b[1].rank) -
            computeSocketResonanceBonus(a[1].starRating, a[1].activeStars, a[1].rank),
        );
      for (const [copyId, gem] of compatible) {
        if (emptyCount <= 0) break;
        current.get(mainGem.slotName)!.push([copyId, gem]);
        usedCopyIds.add(copyId);
        emptyCount -= 1;
      }
    }
    unassigned = unassigned.filter(([copyId]) => !usedCopyIds.has(copyId));
  }

  return current;
}

/**
 * Computes total residual power cost across all main gems. 5-star mains
 * have their residual reduced by socketed gem contributions; 1/2-star mains
 * always carry their full requiredPower.
 */
export function totalResidualFor(mainGems: readonly MainGem[], perSlotGems: ReadonlyMap<string, readonly CopyEntry[]>): number {
  let total = 0;
  for (const mg of mainGems) {
    const socketed = (perSlotGems.get(mg.slotName) ?? []).reduce((sum, [, gem]) => sum + gem.contribution, 0);
    if (mg.starRating === 5) {
      total += Math.max(0, mg.requiredPower - socketed);
    } else {
      total += mg.requiredPower;
    }
  }
  return total;
}

/** Computes GP recoverable by making every unowned copy in allCopies dormant. */
export function dormantPowerFor(allCopies: readonly CopyEntry[], ownedCopyIds: ReadonlySet<number>): number {
  let total = 0;
  for (const [copyId, gem] of allCopies) {
    if (!ownedCopyIds.has(copyId)) {
      total += computeExtractablePower(gem.rank, COST_TABLES.get(gem.starRating)!);
    }
  }
  return total;
}

/**
 * Counts the maximum bonuses activatable for a main gem given an owned set,
 * via a per-socket-star-type greedy multiset match on gemId.
 */
export function maxBonusesForOwned(
  mainGem: MainGem,
  owned: readonly CopyEntry[],
  bonusTable: ReadonlyMap<number, readonly number[]>,
): number {
  const socketTypeMap = SOCKET_STAR_TYPE[mainGem.starRating];
  const bonusRequirements = bonusTable.get(mainGem.gemId) ?? new Array(MAX_SOCKETS[mainGem.starRating]).fill(0);
  const acceptedStarTypes = new Set(Object.values(socketTypeMap));
  let total = 0;
  for (const starType of acceptedStarTypes) {
    const requirements: number[] = [];
    for (let socketIndex = 0; socketIndex < mainGem.numSockets; socketIndex++) {
      if (
        socketTypeMap[socketIndex] === starType &&
        socketIndex < bonusRequirements.length &&
        bonusRequirements[socketIndex]
      ) {
        requirements.push(bonusRequirements[socketIndex]);
      }
    }
    if (requirements.length === 0) continue;
    const available = owned.filter(([, gem]) => gem.starRating === starType).map(([, gem]) => gem.gemId);
    const used = available.map(() => false);
    for (const req of requirements) {
      for (let idx = 0; idx < available.length; idx++) {
        if (!used[idx] && available[idx] === req) {
          used[idx] = true;
          total += 1;
          break;
        }
      }
    }
  }
  return total;
}

type Move =
  | { kind: 'swap'; mgA: MainGem; copyIdA: number; gemA: InventoryGem; mgB: MainGem; copyIdB: number; gemB: InventoryGem }
  | { kind: 'transfer'; mgA: MainGem; copyIdA: number; gemA: InventoryGem; mgB: MainGem }
  | { kind: 'unassigned'; mgA: MainGem; copyIdA: number; gemA: InventoryGem; copyIdB: number; gemB: InventoryGem };

/**
 * Swaps gem ownership between main gems to activate more resonance bonuses
 * via best-improvement hill-climbing to a fixpoint. See the module docstring
 * for why the loop-invariant totalResidualFor recomputation inside the
 * candidate loops is intentional and must not be hoisted here.
 */
export function redistributeForBonuses(
  mainGems: readonly MainGem[],
  perSlotGems: ReadonlyMap<string, readonly CopyEntry[]>,
  bonusTable: ReadonlyMap<number, readonly number[]>,
  budget: number,
  allCopies: readonly CopyEntry[],
): Map<string, CopyEntry[]> {
  const current = new Map<string, CopyEntry[]>();
  for (const [slot, gems] of perSlotGems) current.set(slot, [...gems]);

  const ownedCopyIds = new Set<number>();
  for (const gems of current.values()) for (const [copyId] of gems) ownedCopyIds.add(copyId);

  const startingResidual = totalResidualFor(mainGems, current);
  const startingDormant = dormantPowerFor(allCopies, ownedCopyIds);
  const startingCost = startingResidual - startingDormant;
  const costCeiling = Math.max(budget, startingCost);
  // Dormant power only changes for swap-with-unassigned moves; tracked
  // incrementally.
  let currentDormant = startingDormant;

  const socketCapacityByStarType = (mainGem: MainGem): Map<number, number> => {
    const socketTypeMap = SOCKET_STAR_TYPE[mainGem.starRating];
    const capacity = new Map<number, number>();
    for (let socketIndex = 0; socketIndex < mainGem.numSockets; socketIndex++) {
      const st = socketTypeMap[socketIndex];
      capacity.set(st, (capacity.get(st) ?? 0) + 1);
    }
    return capacity;
  };

  const freeSocketCountOf = (mainGem: MainGem, starType: number): number => {
    const capacity = socketCapacityByStarType(mainGem).get(starType) ?? 0;
    const assigned = (current.get(mainGem.slotName) ?? []).filter(([, gem]) => gem.starRating === starType).length;
    return Math.max(0, capacity - assigned);
  };

  const gemResidual = (mainGem: MainGem): number => {
    if (mainGem.starRating !== 5) return mainGem.requiredPower;
    const socketed = (current.get(mainGem.slotName) ?? []).reduce((sum, [, gem]) => sum + gem.contribution, 0);
    return Math.max(0, mainGem.requiredPower - socketed);
  };

  // Pre-compute per-main-gem bonus counts from current state.
  const bonusCounts = new Map<string, number>(
    mainGems.map((mg) => [mg.slotName, maxBonusesForOwned(mg, current.get(mg.slotName) ?? [], bonusTable)]),
  );

  let improved = true;
  while (improved) {
    improved = false;
    let bestKey: readonly (number | string)[] | null = null;
    let bestMove: Move | null = null;

    // ------------------------------------------------------------------
    // Candidate A: swaps / transfers between two already-owned gems
    // ------------------------------------------------------------------
    for (let i = 0; i < mainGems.length; i++) {
      for (let j = 0; j < mainGems.length; j++) {
        if (j <= i) continue;
        const mgA = mainGems[i];
        const mgB = mainGems[j];
        const slotA = mgA.slotName;
        const slotB = mgB.slotName;

        // Star types present in BOTH gems' sockets. Sorted ascending: a
        // provable no-op vs the Python `set & set` iteration order for the
        // small int star-type universe {2, 5} used here, and it removes any
        // dependency on JS Set iteration order matching CPython's.
        const starTypesA = new Set(socketCapacityByStarType(mgA).keys());
        const starTypesB = new Set(socketCapacityByStarType(mgB).keys());
        const sharedStarTypes = [...starTypesA].filter((st) => starTypesB.has(st)).sort((a, b) => a - b);

        for (const starType of sharedStarTypes) {
          const gemsA = (current.get(slotA) ?? []).filter(([, gem]) => gem.starRating === starType);
          const gemsB = (current.get(slotB) ?? []).filter(([, gem]) => gem.starRating === starType);

          for (const [copyIdA, gemA] of gemsA) {
            // Swap gemA with each gemB.
            for (const [copyIdB, gemB] of gemsB) {
              if (gemA.gemId === gemB.gemId && gemA.contribution === gemB.contribution) continue;
              const newA: CopyEntry[] = [...(current.get(slotA) ?? []).filter(([id]) => id !== copyIdA), [copyIdB, gemB]];
              const newB: CopyEntry[] = [...(current.get(slotB) ?? []).filter(([id]) => id !== copyIdB), [copyIdA, gemA]];
              const bonusANew = maxBonusesForOwned(mgA, newA, bonusTable);
              const bonusBNew = maxBonusesForOwned(mgB, newB, bonusTable);
              const bonusGain = bonusANew + bonusBNew - ((bonusCounts.get(slotA) ?? 0) + (bonusCounts.get(slotB) ?? 0));
              if (bonusGain <= 0) continue;
              const oldResA = gemResidual(mgA);
              const oldResB = gemResidual(mgB);
              const newResA =
                mgA.starRating === 5 ? Math.max(0, mgA.requiredPower - newA.reduce((s, [, g]) => s + g.contribution, 0)) : mgA.requiredPower;
              const newResB =
                mgB.starRating === 5 ? Math.max(0, mgB.requiredPower - newB.reduce((s, [, g]) => s + g.contribution, 0)) : mgB.requiredPower;
              const newTotalResidual = totalResidualFor(mainGems, current) - oldResA - oldResB + newResA + newResB;
              const newCost = newTotalResidual - currentDormant;
              if (newCost > costCeiling) continue;
              const key = [bonusGain, -newCost, slotA, copyIdA, slotB, copyIdB];
              if (bestKey === null || cmpTuple(key, bestKey) > 0) {
                bestKey = key;
                bestMove = { kind: 'swap', mgA, copyIdA, gemA, mgB, copyIdB, gemB };
              }
            }

            // Transfer gemA into a free socket of mgB (no gem returned).
            if (freeSocketCountOf(mgB, starType) > 0) {
              const newA: CopyEntry[] = (current.get(slotA) ?? []).filter(([id]) => id !== copyIdA);
              const newB: CopyEntry[] = [...(current.get(slotB) ?? []), [copyIdA, gemA]];
              const bonusANew = maxBonusesForOwned(mgA, newA, bonusTable);
              const bonusBNew = maxBonusesForOwned(mgB, newB, bonusTable);
              const bonusGain = bonusANew + bonusBNew - ((bonusCounts.get(slotA) ?? 0) + (bonusCounts.get(slotB) ?? 0));
              if (bonusGain <= 0) continue;
              const oldResA = gemResidual(mgA);
              const oldResB = gemResidual(mgB);
              const newResA =
                mgA.starRating === 5 ? Math.max(0, mgA.requiredPower - newA.reduce((s, [, g]) => s + g.contribution, 0)) : mgA.requiredPower;
              const newResB =
                mgB.starRating === 5 ? Math.max(0, mgB.requiredPower - newB.reduce((s, [, g]) => s + g.contribution, 0)) : mgB.requiredPower;
              const newTotalResidual = totalResidualFor(mainGems, current) - oldResA - oldResB + newResA + newResB;
              const newCost = newTotalResidual - currentDormant;
              if (newCost > costCeiling) continue;
              const key = [bonusGain, -newCost, slotA, copyIdA, slotB, -1];
              if (bestKey === null || cmpTuple(key, bestKey) > 0) {
                bestKey = key;
                bestMove = { kind: 'transfer', mgA, copyIdA, gemA, mgB };
              }
            }
          }
        }
      }
    }

    // ------------------------------------------------------------------
    // Candidate B: swap an owned gem with an unassigned inventory copy
    // ------------------------------------------------------------------
    const unassigned = allCopies.filter(([copyId]) => !ownedCopyIds.has(copyId));
    for (const mgA of mainGems) {
      const slotA = mgA.slotName;
      const starTypesA = [...socketCapacityByStarType(mgA).keys()].sort((a, b) => a - b);
      for (const starType of starTypesA) {
        const gemsA = (current.get(slotA) ?? []).filter(([, gem]) => gem.starRating === starType);
        for (const [copyIdA, gemA] of gemsA) {
          for (const [copyIdB, gemB] of unassigned) {
            if (gemB.starRating !== starType) continue;
            if (gemA.gemId === gemB.gemId && gemA.contribution === gemB.contribution) continue;
            const newA: CopyEntry[] = [...(current.get(slotA) ?? []).filter(([id]) => id !== copyIdA), [copyIdB, gemB]];
            const bonusANew = maxBonusesForOwned(mgA, newA, bonusTable);
            const bonusGain = bonusANew - (bonusCounts.get(slotA) ?? 0);
            if (bonusGain <= 0) continue;
            const oldResA = gemResidual(mgA);
            const newResA =
              mgA.starRating === 5 ? Math.max(0, mgA.requiredPower - newA.reduce((s, [, g]) => s + g.contribution, 0)) : mgA.requiredPower;
            const newTotalResidual = totalResidualFor(mainGems, current) - oldResA + newResA;
            // gemA leaves ownership (becomes dormant-eligible); gemB enters it.
            const newDormant =
              currentDormant +
              computeExtractablePower(gemA.rank, COST_TABLES.get(gemA.starRating)!) -
              computeExtractablePower(gemB.rank, COST_TABLES.get(gemB.starRating)!);
            const newCost = newTotalResidual - newDormant;
            if (newCost > costCeiling) continue;
            const key = [bonusGain, -newCost, slotA, copyIdA, '', copyIdB];
            if (bestKey === null || cmpTuple(key, bestKey) > 0) {
              bestKey = key;
              bestMove = { kind: 'unassigned', mgA, copyIdA, gemA, copyIdB, gemB };
            }
          }
        }
      }
    }

    if (bestMove === null) break;

    // Apply the best move found this sweep.
    if (bestMove.kind === 'swap') {
      const { mgA, copyIdA, gemA, mgB, copyIdB, gemB } = bestMove;
      current.set(mgA.slotName, [...(current.get(mgA.slotName) ?? []).filter(([id]) => id !== copyIdA), [copyIdB, gemB]]);
      current.set(mgB.slotName, [...(current.get(mgB.slotName) ?? []).filter(([id]) => id !== copyIdB), [copyIdA, gemA]]);
      bonusCounts.set(mgA.slotName, maxBonusesForOwned(mgA, current.get(mgA.slotName) ?? [], bonusTable));
      bonusCounts.set(mgB.slotName, maxBonusesForOwned(mgB, current.get(mgB.slotName) ?? [], bonusTable));
    } else if (bestMove.kind === 'transfer') {
      const { mgA, copyIdA, gemA, mgB } = bestMove;
      current.set(mgA.slotName, (current.get(mgA.slotName) ?? []).filter(([id]) => id !== copyIdA));
      current.set(mgB.slotName, [...(current.get(mgB.slotName) ?? []), [copyIdA, gemA]]);
      // copyIdA is still owned (now by mgB), so ownedCopyIds is unchanged.
      bonusCounts.set(mgA.slotName, maxBonusesForOwned(mgA, current.get(mgA.slotName) ?? [], bonusTable));
      bonusCounts.set(mgB.slotName, maxBonusesForOwned(mgB, current.get(mgB.slotName) ?? [], bonusTable));
    } else {
      const { mgA, copyIdA, gemA, copyIdB, gemB } = bestMove;
      current.set(mgA.slotName, [...(current.get(mgA.slotName) ?? []).filter(([id]) => id !== copyIdA), [copyIdB, gemB]]);
      ownedCopyIds.delete(copyIdA);
      ownedCopyIds.add(copyIdB);
      currentDormant +=
        computeExtractablePower(gemA.rank, COST_TABLES.get(gemA.starRating)!) -
        computeExtractablePower(gemB.rank, COST_TABLES.get(gemB.starRating)!);
      bonusCounts.set(mgA.slotName, maxBonusesForOwned(mgA, current.get(mgA.slotName) ?? [], bonusTable));
    }

    improved = true;
  }

  return current;
}

/**
 * Assigns gem copies to specific sockets to maximize activated bonuses.
 * Independently permutes gems within each star-type group (worst case 3!x2!
 * = 12 permutations per main gem).
 */
export function reorderForBonuses(
  mainGem: MainGem,
  gemCopies: readonly CopyEntry[],
  bonusTable: ReadonlyMap<number, readonly number[]>,
): SocketAssignment[] {
  const socketTypeMap = SOCKET_STAR_TYPE[mainGem.starRating];
  const bonusRequirements = bonusTable.get(mainGem.gemId) ?? new Array(MAX_SOCKETS[mainGem.starRating]).fill(0);

  const acceptedStarTypes = [...new Set(Object.values(socketTypeMap))].sort((a, b) => a - b);
  const gemsByStarType = new Map<number, CopyEntry[]>(
    acceptedStarTypes.map((starType) => [starType, gemCopies.filter(([, gem]) => gem.starRating === starType)]),
  );
  const socketsByStarType = new Map<number, number[]>(
    acceptedStarTypes.map((starType) => {
      const sockets: number[] = [];
      for (let socketIndex = 0; socketIndex < mainGem.numSockets; socketIndex++) {
        if (socketTypeMap[socketIndex] === starType) sockets.push(socketIndex);
      }
      return [starType, sockets];
    }),
  );

  /** Counts bonuses activated by pairing socketPositions[i] with gems[i] (zip truncates to shorter). */
  const countActivatedBonuses = (socketPositions: readonly number[], gems: readonly CopyEntry[]): number => {
    let count = 0;
    const len = Math.min(socketPositions.length, gems.length);
    for (let i = 0; i < len; i++) {
      const socketPosition = socketPositions[i];
      const [, gem] = gems[i];
      const bonusRequirement = socketPosition < bonusRequirements.length ? bonusRequirements[socketPosition] : 0;
      if (bonusRequirement && gem.gemId === bonusRequirement) count++;
    }
    return count;
  };

  /** Returns the permutation of gems that maximizes activated bonuses. */
  const bestPermutation = (socketPositions: readonly number[], gems: readonly CopyEntry[]): CopyEntry[] => {
    let bestOrdering = [...gems];
    let bestBonusCount = countActivatedBonuses(socketPositions, gems);
    for (const permutation of permutations(gems)) {
      const bonusCount = countActivatedBonuses(socketPositions, permutation);
      if (bonusCount > bestBonusCount) {
        bestBonusCount = bonusCount;
        bestOrdering = permutation;
      }
    }
    return bestOrdering;
  };

  const bestOrderingByStarType = new Map<number, CopyEntry[]>(
    acceptedStarTypes.map((starType) => [
      starType,
      bestPermutation(socketsByStarType.get(starType) ?? [], gemsByStarType.get(starType) ?? []),
    ]),
  );
  // Per-star-type stateful cursor, matching Python's iter()/next() usage --
  // NOT indexable by socket position directly, since sockets of a given star
  // type may be non-contiguous (see e.g. 5-star sockets 3,4).
  const cursors = new Map<number, { items: CopyEntry[]; i: number }>(
    acceptedStarTypes.map((starType) => [starType, { items: bestOrderingByStarType.get(starType) ?? [], i: 0 }]),
  );
  const takeNext = (starType: number): CopyEntry | null => {
    const cursor = cursors.get(starType);
    if (!cursor || cursor.i >= cursor.items.length) return null;
    return cursor.items[cursor.i++];
  };

  const result: SocketAssignment[] = [];
  for (let socketIndex = 0; socketIndex < mainGem.numSockets; socketIndex++) {
    const acceptedStarType = socketTypeMap[socketIndex];
    const nextGem = takeNext(acceptedStarType);
    if (nextGem === null) {
      result.push(makeSocketAssignment({ socketIndex }));
    } else {
      const [copyId, gem] = nextGem;
      const bonusRequirement = socketIndex < bonusRequirements.length ? bonusRequirements[socketIndex] : 0;
      result.push(
        makeSocketAssignment({
          socketIndex,
          gem,
          copyId,
          contribution: gem.contribution,
          bonusActivated: Boolean(bonusRequirement && gem.gemId === bonusRequirement),
        }),
      );
    }
  }

  return result;
}
