/**
 * Bonus mode 'budget': a post-pipeline swap search that spends leftover gem
 * power surplus activating bonuses without ever making a feasible setup
 * infeasible. See docs/SPEC.md ("Bonus activation modes") for the rule this
 * module implements.
 *
 * The search operates on per-slot bags -- the same (copyId, gem) multisets
 * `solveAssignment`/`fillEmptySockets` produce -- rather than on socket
 * indices directly. Phase 3 (`assignSockets`, invoked by the caller-supplied
 * `evaluate`) always places an inserted copy in the socket matching its gem
 * id, so a bag-level swap realizes the intended socket-level swap.
 */

import type { CopyEntry } from './optimizer';
import type { MainGem, OptimizationResult, SocketAssignment } from './models';
import { SOCKET_STAR_TYPE } from './constants';

/** One trial's full evaluation. See `BudgetEvaluator`. */
export interface BudgetEvaluation {
  /** `availablePower + dormantPower - effectiveResidual`, matching the surplus the final response reports. */
  surplus: number;
  result: OptimizationResult;
  /** Total activated bonuses across all main gems (sum of `gemResults[].bonusesActivated`). */
  bonuses: number;
}

/** Materializes a candidate per-slot bag assignment into its full evaluation. Provided by `runOptimization.ts`. */
export type BudgetEvaluator = (perSlotGems: ReadonlyMap<string, readonly CopyEntry[]>) => BudgetEvaluation;

/** One socket to visit in the round-robin schedule built by `buildSocketSchedule`. */
export interface SocketTarget {
  slotName: string;
  socketIndex: number;
  starType: number;
}

/** Reconstructs per-slot bags from a materialized result's `gemAssignments`. */
export function bagsFromAssignments(result: OptimizationResult): Map<string, CopyEntry[]> {
  const bags = new Map<string, CopyEntry[]>();
  for (const mainGem of result.mainGems) bags.set(mainGem.slotName, []);
  for (const [slotName, assignments] of result.gemAssignments) {
    const bag = bags.get(slotName) ?? [];
    for (const a of assignments) {
      if (a.copyId >= 0 && a.gem !== null) bag.push([a.copyId, a.gem]);
    }
    bags.set(slotName, bag);
  }
  return bags;
}

/**
 * Builds the round-robin socket visit order: star type descending (5-star
 * sockets first, then 2-star, then 1-star), and within a star type, the
 * k-th unlocked socket of that type (k = 0, 1, 2, ...) visited across every
 * main gem that has one, in equipment slot order (`mainGems` array order).
 *
 * Example: main gem A has 2 unlocked 5-star and 3 unlocked 2-star sockets, B
 * has 1 unlocked 5-star and 3 unlocked 2-star sockets. Visit order: A-5star#1,
 * B-5star#1, A-5star#2, A-2star#1, B-2star#1, A-2star#2, B-2star#2,
 * A-2star#3, B-2star#3.
 */
export function buildSocketSchedule(mainGems: readonly MainGem[]): SocketTarget[] {
  const perGem = mainGems.map((mainGem) => {
    const socketTypeMap = SOCKET_STAR_TYPE[mainGem.starRating];
    const byStarType = new Map<number, number[]>();
    for (let socketIndex = 0; socketIndex < mainGem.numSockets; socketIndex++) {
      const starType = socketTypeMap[socketIndex];
      const indices = byStarType.get(starType);
      if (indices) indices.push(socketIndex);
      else byStarType.set(starType, [socketIndex]);
    }
    return { mainGem, byStarType };
  });

  const starTypes = [...new Set(perGem.flatMap(({ byStarType }) => [...byStarType.keys()]))].sort((a, b) => b - a);

  const schedule: SocketTarget[] = [];
  for (const starType of starTypes) {
    const maxK = Math.max(...perGem.map(({ byStarType }) => byStarType.get(starType)?.length ?? 0));
    for (let k = 0; k < maxK; k++) {
      for (const { mainGem, byStarType } of perGem) {
        const indices = byStarType.get(starType);
        if (indices !== undefined && k < indices.length) {
          schedule.push({ slotName: mainGem.slotName, socketIndex: indices[k], starType });
        }
      }
    }
  }
  return schedule;
}

/**
 * Returns every copy eligible to activate `target`'s socket, ordered
 * highest rank first (then lowest copyId for determinism): dormant copies
 * plus copies socketed in a different main gem. Copies already in the
 * target's own bag are excluded via `holderOf`.
 *
 * Rank order is derived from contribution: every candidate shares the same
 * gem id and star tier, and contribution increases strictly with rank for a
 * fixed gem id and tier.
 */
function candidatesFor(
  requirement: number,
  starType: number,
  targetSlotName: string,
  holderOf: ReadonlyMap<number, string>,
  allCopies: readonly CopyEntry[],
): CopyEntry[] {
  return allCopies
    .filter(([copyId, gem]) => gem.gemId === requirement && gem.starRating === starType && holderOf.get(copyId) !== targetSlotName)
    .sort(([copyIdA, gemA], [copyIdB, gemB]) => gemB.contribution - gemA.contribution || copyIdA - copyIdB);
}

/**
 * Returns `bags` with `candidate` moved into `targetSlotName`'s bag and
 * `displaced` (the socket's prior occupant, or an empty placeholder) removed
 * from it. When `candidate` came from another main gem's bag (`donorSlotName`
 * defined), `displaced` is pushed into that bag in its place. When
 * `candidate` came from the dormant pool (`donorSlotName` undefined), the
 * displaced copy becomes dormant.
 */
function applySwap(
  bags: ReadonlyMap<string, readonly CopyEntry[]>,
  targetSlotName: string,
  displaced: SocketAssignment,
  candidate: CopyEntry,
  donorSlotName: string | undefined,
): Map<string, CopyEntry[]> {
  const next = new Map<string, CopyEntry[]>();
  for (const [slotName, gems] of bags) next.set(slotName, [...gems]);

  if (donorSlotName !== undefined) {
    const donorBag = next.get(donorSlotName)!;
    const donorIndex = donorBag.findIndex(([copyId]) => copyId === candidate[0]);
    if (donorIndex < 0) {
      throw new Error(`applySwap: copy ${candidate[0]} not found in donor bag '${donorSlotName}'.`);
    }
    donorBag.splice(donorIndex, 1);
  }

  if (displaced.gem !== null) {
    const targetBag = next.get(targetSlotName)!;
    const targetIndex = targetBag.findIndex(([copyId]) => copyId === displaced.copyId);
    if (targetIndex < 0) {
      throw new Error(`applySwap: displaced copy ${displaced.copyId} not found in target bag '${targetSlotName}'.`);
    }
    targetBag.splice(targetIndex, 1);
    if (donorSlotName !== undefined) {
      next.get(donorSlotName)!.push([displaced.copyId, displaced.gem]);
    }
    // donorSlotName undefined: the displaced copy is dropped from every bag, i.e. made dormant.
  }

  next.get(targetSlotName)!.push(candidate);
  return next;
}

/**
 * Walks every unactivated socket in `buildSocketSchedule` order, trying each
 * eligible candidate (highest rank first) until one is found whose swap
 * keeps `surplus >= 0` and strictly increases the total activated bonus
 * count. The first such candidate is kept and the search moves to the next
 * socket; if none qualify, the socket is left as-is. Returns `initial`
 * unchanged when `initial.surplus < 0`.
 */
export function budgetActivateBonuses(
  mainGems: readonly MainGem[],
  bonusTable: ReadonlyMap<number, readonly number[]>,
  allCopies: readonly CopyEntry[],
  initial: BudgetEvaluation,
  evaluate: BudgetEvaluator,
): BudgetEvaluation {
  if (initial.surplus < 0) return initial;

  const mainGemBySlot = new Map(mainGems.map((mainGem) => [mainGem.slotName, mainGem]));
  const schedule = buildSocketSchedule(mainGems);

  let best = initial;
  let bags: ReadonlyMap<string, readonly CopyEntry[]> = bagsFromAssignments(best.result);

  for (const target of schedule) {
    const mainGem = mainGemBySlot.get(target.slotName);
    if (mainGem === undefined) continue; // Defensive: schedule is built from mainGems itself.
    const requirement = bonusTable.get(mainGem.gemId)?.[target.socketIndex] ?? 0;
    if (!requirement) continue;

    const currentSocket = (best.result.gemAssignments.get(target.slotName) ?? []).find((a) => a.socketIndex === target.socketIndex);
    if (currentSocket === undefined || currentSocket.bonusActivated) continue;

    const holderOf = new Map<number, string>();
    for (const [slotName, assignments] of best.result.gemAssignments) {
      for (const a of assignments) {
        if (a.copyId >= 0) holderOf.set(a.copyId, slotName);
      }
    }

    const candidates = candidatesFor(requirement, target.starType, target.slotName, holderOf, allCopies);
    for (const candidate of candidates) {
      const donorSlotName = holderOf.get(candidate[0]);
      const trialBags = applySwap(bags, target.slotName, currentSocket, candidate, donorSlotName);
      const trial = evaluate(trialBags);
      if (trial.surplus >= 0 && trial.bonuses > best.bonuses) {
        best = trial;
        bags = trialBags;
        break;
      }
    }
  }

  return best;
}
