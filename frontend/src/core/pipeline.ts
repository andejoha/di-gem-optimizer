/**
 * Core optimization pipeline for the gem resonance optimizer.
 *
 * Provides `runPipeline`: the in-memory orchestration function that runs
 * all four optimization phases (greedy assignment, empty socket fill,
 * cross-gem bonus redistribution, intra-gem socket reordering) on
 * pre-parsed data structures. Has no dependency on the UI, the worker, or
 * any input/output layer.
 */

import { SOCKET_STAR_TYPE } from './constants';
import { COST_TABLES, GEM_LIST } from './data';
import type { InventoryGem, MainGem, OptimizationResult, SocketAssignment } from './models';
import { makeGemResult, makeOptimizationResult, makeSocketAssignment } from './models';
import { type CopyEntry, expandInventory, fillEmptySockets, redistributeForBonuses, reorderForBonuses, solveAssignment } from './optimizer';
import { nullReporter, type ProgressReporter } from './progress';
import { computeExtractablePower, computeSlotResonance } from './rules';

export interface RunPipelineOptions {
  progress?: ProgressReporter;
  stagePrefix?: string;
  /**
   * When true, skip redistributeForBonuses and reorderForBonuses and instead
   * produce a flat socket assignment (gems placed in socket order without
   * permutation or bonus scoring). Use for upgrade-walk iterations where
   * only residual cost matters.
   */
  skipBonusPhases?: boolean;
  /**
   * gem power already committed elsewhere (e.g. an applied upgrade plan) and
   * therefore unavailable to redistributeForBonuses. Subtracted from
   * availablePower before that phase; no effect when skipBonusPhases is set.
   */
  committedCost?: number;
}

/**
 * Executes the core optimization pipeline with pre-parsed data. Returns a
 * zero-value result if mainGems is empty.
 */
export function runPipeline(
  availablePower: number,
  mainGems: readonly MainGem[],
  skippedSlots: readonly string[],
  inventory: readonly InventoryGem[],
  options: RunPipelineOptions = {},
): OptimizationResult {
  const { progress = nullReporter, stagePrefix = '', skipBonusPhases = false, committedCost = 0 } = options;

  if (mainGems.length === 0) {
    return makeOptimizationResult({
      gemResults: [],
      totalSocketedPower: 0,
      totalRequiredPower: 0,
      totalResidualCost: 0,
      availablePower,
      skippedSlots: [...skippedSlots],
      gemAssignments: new Map(),
      bonusTable: new Map(),
      mainGems: [],
      totalResonance: 0,
    });
  }

  const bonusTable = new Map<number, number[]>(GEM_LIST.map((gemDef) => [gemDef.id, gemDef.bonusGemIds]));

  const fiveStarGems = mainGems.filter((mainGem) => mainGem.starRating === 5);
  const allCopies = expandInventory(inventory);

  progress.report(`${stagePrefix}assignment`, 'running', { detail: 'Solving gem assignment...' });
  const rawAssignments = solveAssignment(fiveStarGems, inventory);

  // 5-star slots are populated by the greedy result; 1/2-star slots start
  // empty and are filled by fillEmptySockets.
  let perSlotGems = new Map<string, CopyEntry[]>(mainGems.map((mainGem) => [mainGem.slotName, []]));
  for (const [slot, copies] of rawAssignments) {
    perSlotGems.get(slot)!.push(...copies);
  }

  progress.report(`${stagePrefix}fill_empty`, 'running', { detail: 'Filling empty sockets...' });
  perSlotGems = fillEmptySockets(mainGems, perSlotGems, bonusTable, allCopies);

  const gemAssignments = new Map<string, SocketAssignment[]>();
  if (skipBonusPhases) {
    // Flat assignment: place gems into compatible sockets in their existing
    // order without permutation or bonus scoring. Contribution and gem
    // identity are correct for residual/upgrade-filter purposes; bonus
    // fields are left at their zero defaults.
    for (const mainGem of mainGems) {
      const socketTypeMap = SOCKET_STAR_TYPE[mainGem.starRating];
      const gemsByStar = new Map<number, CopyEntry[]>();
      for (const [copyId, gem] of perSlotGems.get(mainGem.slotName) ?? []) {
        const list = gemsByStar.get(gem.starRating);
        if (list) list.push([copyId, gem]);
        else gemsByStar.set(gem.starRating, [[copyId, gem]]);
      }
      // One cursor per star type, consumed in order as sockets fill below.
      const cursors = new Map<number, { items: CopyEntry[]; i: number }>(
        [...gemsByStar].map(([st, copies]) => [st, { items: copies, i: 0 }]),
      );
      const sockets: SocketAssignment[] = [];
      for (let socketIndex = 0; socketIndex < mainGem.numSockets; socketIndex++) {
        const st = socketTypeMap[socketIndex];
        const cursor = cursors.get(st);
        const next = cursor && cursor.i < cursor.items.length ? cursor.items[cursor.i++] : null;
        if (next === null) {
          sockets.push(makeSocketAssignment({ socketIndex }));
        } else {
          const [copyId, gem] = next;
          sockets.push(makeSocketAssignment({ socketIndex, gem, copyId, contribution: gem.contribution }));
        }
      }
      gemAssignments.set(mainGem.slotName, sockets);
    }
  } else {
    progress.report(`${stagePrefix}redistribute`, 'running', { detail: 'Redistributing for bonuses...' });
    perSlotGems = redistributeForBonuses(mainGems, perSlotGems, bonusTable, availablePower - committedCost, allCopies);

    progress.report(`${stagePrefix}reorder`, 'running', { detail: 'Reordering sockets...' });
    for (const mainGem of mainGems) {
      gemAssignments.set(mainGem.slotName, reorderForBonuses(mainGem, perSlotGems.get(mainGem.slotName) ?? [], bonusTable));
    }
  }

  // Dormant gem power: the power recoverable by making every unsocketed
  // inventory copy dormant. "Unsocketed" means not assigned to any main
  // gem socket.
  const assignedCopyIds = new Set<number>();
  for (const assignments of gemAssignments.values()) {
    for (const a of assignments) {
      if (a.copyId >= 0) assignedCopyIds.add(a.copyId);
    }
  }
  let totalDormantPower = 0;
  for (const [copyId, gem] of allCopies) {
    if (!assignedCopyIds.has(copyId)) {
      totalDormantPower += computeExtractablePower(gem.rank, COST_TABLES.get(gem.starRating)!);
    }
  }

  const gemResults = [];
  let totalSocketed = 0;
  let totalRequired = 0;
  let totalResidual = 0;
  let totalResonance = 0;

  for (const mainGem of mainGems) {
    const assignments = gemAssignments.get(mainGem.slotName) ?? [];
    const socketedPower = assignments.reduce((sum, a) => sum + a.contribution, 0);
    // For 1/2-star main gems, socketed gem power does NOT offset awakening cost.
    const residual = mainGem.starRating === 5 ? Math.max(0, mainGem.requiredPower - socketedPower) : mainGem.requiredPower;
    const bonusesActivated = assignments.filter((a) => a.bonusActivated).length;
    const [baseResonance, socketResonance, slotResonance] = computeSlotResonance(mainGem, assignments);

    totalSocketed += socketedPower;
    totalRequired += mainGem.requiredPower;
    totalResidual += residual;
    totalResonance += slotResonance;

    gemResults.push(
      makeGemResult({
        slotName: mainGem.slotName,
        gemId: mainGem.gemId,
        targetRank: mainGem.targetRank,
        socketsUnlocked: mainGem.numSockets,
        totalSocketedPower: socketedPower,
        requiredPower: mainGem.requiredPower,
        residualCost: residual,
        bonusesActivated,
        bonusesPossible: mainGem.numSockets,
        assignments,
        baseResonance,
        socketResonanceBonus: socketResonance,
        totalResonance: slotResonance,
      }),
    );
  }

  return makeOptimizationResult({
    gemResults,
    totalSocketedPower: totalSocketed,
    totalRequiredPower: totalRequired,
    totalResidualCost: totalResidual,
    availablePower,
    skippedSlots: [...skippedSlots],
    gemAssignments,
    bonusTable,
    mainGems: [...mainGems],
    totalResonance,
    totalDormantPower,
  });
}
