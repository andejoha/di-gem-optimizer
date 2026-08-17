/**
 * Core optimization pipeline for the gem resonance optimizer.
 *
 * Provides `runPipeline`: the in-memory orchestration function that runs
 * all three optimization phases (greedy assignment, empty socket fill,
 * socket materialization) on pre-parsed data structures. Has no dependency
 * on the UI, the worker, or any input/output layer.
 */

import { COST_TABLES, GEM_LIST } from './data';
import type { InventoryGem, MainGem, OptimizationResult, SocketAssignment } from './models';
import { makeGemResult, makeOptimizationResult } from './models';
import { assignSockets, type CopyEntry, computeBonusGemDemand, expandInventory, fillEmptySockets, solveAssignment } from './optimizer';
import { nullReporter, type ProgressReporter } from './progress';
import { computeExtractablePower, computeSlotResonance } from './rules';

export interface RunPipelineOptions {
  progress?: ProgressReporter;
  stagePrefix?: string;
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
  const { progress = nullReporter, stagePrefix = '' } = options;

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
  const totalDemand = computeBonusGemDemand(mainGems, bonusTable);

  const fiveStarGems = mainGems.filter((mainGem) => mainGem.starRating === 5);
  const allCopies = expandInventory(inventory);

  progress.report(`${stagePrefix}assignment`, 'running', { detail: 'Solving gem assignment...' });
  const rawAssignments = solveAssignment(fiveStarGems, inventory, bonusTable, totalDemand);

  // 5-star slots are populated by the greedy result; 1/2-star slots start
  // empty and are filled by fillEmptySockets.
  let perSlotGems = new Map<string, CopyEntry[]>(mainGems.map((mainGem) => [mainGem.slotName, []]));
  for (const [slot, copies] of rawAssignments) {
    perSlotGems.get(slot)!.push(...copies);
  }

  progress.report(`${stagePrefix}fill_empty`, 'running', { detail: 'Filling empty sockets...' });
  perSlotGems = fillEmptySockets(mainGems, perSlotGems, bonusTable, allCopies, totalDemand);

  const gemAssignments = new Map<string, SocketAssignment[]>();
  for (const mainGem of mainGems) {
    gemAssignments.set(mainGem.slotName, assignSockets(mainGem, perSlotGems.get(mainGem.slotName) ?? [], bonusTable));
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
