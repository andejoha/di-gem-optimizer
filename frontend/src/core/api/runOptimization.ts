/**
 * Ported from backend/app/api/routes.py `_run_optimization` and
 * `_finalize_r1_conversion` -- the core orchestration shared by the plain
 * and streaming endpoints. This is the most behaviour-dense function in
 * the codebase; ported line-for-line, including the upgrade walk's exact
 * peel/restart logic. Logging statements (logger.debug/.info) are dropped
 * -- they are diagnostic-only and never affect the returned response.
 */

import type { InventoryGem, UpgradeOptimizationResult } from '../models';
import { runPipeline } from '../pipeline';
import { nullReporter, type ProgressReporter } from '../progress';
import {
  buildUpgradeChains,
  computeSocketCounts,
  filterUpgradesToSocketed,
  materializeUpgrades,
  type GemUpgradeChain,
} from '../upgrades';
import { alreadyDormantCounter, domainToResponse, requestToDomain } from './converters';
import type { ConvertedGemItem, OptimizeRequest, OptimizeResponse, RemainingInventoryItem } from './types';
import { ValidationError } from './validate';

/**
 * Reconciles pre-extracted R1 1-star gems with the optimization result.
 * Before optimization, R1 1-star gems were removed from inventory and their
 * count added to availablePower; this determines how many were actually
 * needed, reports them as converted, and returns the rest to
 * remaining_inventory.
 */
function finalizeR1Conversion(response: OptimizeResponse, availablePowerOrig: number, r1Gems: readonly InventoryGem[]): OptimizeResponse {
  if (r1Gems.length === 0) return response;

  const totalResidual = response.summary.total_residual_cost;
  const D = response.summary.dormant_gem_power;
  const gemsUsed = Math.min(r1Gems.length, Math.max(0, totalResidual - availablePowerOrig - D));

  const unused = r1Gems.slice(gemsUsed);
  const restored: RemainingInventoryItem[] = unused.map((g) => ({
    gem_id: g.gemId,
    star_rating: g.starRating,
    rank: g.rank,
    active_stars: g.activeStars,
    contribution: g.contribution,
  }));

  const newAvailable = availablePowerOrig + gemsUsed;
  const newSurplus = newAvailable + D - totalResidual;

  const patchedSummary = {
    ...response.summary,
    available_power: newAvailable,
    status: (newSurplus >= 0 ? 'feasible' : 'shortfall') as 'feasible' | 'shortfall',
    surplus_or_shortfall: newSurplus,
  };

  // Also patch the baseline_summary inside the upgrades block: it was
  // computed with the R1-inflated availablePower and must be reconciled the
  // same way so the "Without upgrades" surplus is not overstated.
  let patchedUpgrades = response.upgrades;
  if (response.upgrades !== null) {
    const blResidual = response.upgrades.baseline_summary.total_residual_cost;
    const blD = response.upgrades.baseline_summary.dormant_gem_power;
    const blGemsUsed = Math.min(r1Gems.length, Math.max(0, blResidual - availablePowerOrig - blD));
    const blNewAvailable = availablePowerOrig + blGemsUsed;
    const blNewSurplus = blNewAvailable + blD - blResidual;
    const patchedBaselineSummary = {
      ...response.upgrades.baseline_summary,
      available_power: blNewAvailable,
      status: (blNewSurplus >= 0 ? 'feasible' : 'shortfall') as 'feasible' | 'shortfall',
      surplus_or_shortfall: blNewSurplus,
    };
    patchedUpgrades = { ...response.upgrades, baseline_summary: patchedBaselineSummary };
  }

  if (gemsUsed === 0) {
    return {
      ...response,
      summary: patchedSummary,
      upgrades: patchedUpgrades,
      remaining_inventory: [...response.remaining_inventory, ...restored],
    };
  }

  // Insertion order matters: converted_gems array order follows first-seen
  // gemId order scanning r1Gems, mirroring Python's dict.get-based counting.
  const idToQty = new Map<number, number>();
  for (const g of r1Gems.slice(0, gemsUsed)) {
    idToQty.set(g.gemId, (idToQty.get(g.gemId) ?? 0) + 1);
  }
  const convertedGems: ConvertedGemItem[] = [...idToQty].map(([gemId, qty]) => ({
    gem_id: gemId,
    quantity: qty,
    gem_power_gained: qty,
  }));

  return {
    ...response,
    summary: patchedSummary,
    upgrades: patchedUpgrades,
    remaining_inventory: [...response.remaining_inventory, ...restored],
    converted_gems: convertedGems,
  };
}

function socketedSet(gemAssignments: ReadonlyMap<string, readonly { gem: InventoryGem | null }[]>): Set<string> {
  const set = new Set<string>();
  for (const assignments of gemAssignments.values()) {
    for (const assignment of assignments) {
      if (assignment.gem !== null) {
        const g = assignment.gem as InventoryGem;
        set.add(`${g.gemId}|${g.starRating}|${g.rank}`);
      }
    }
  }
  return set;
}

/** Returns the index of the highest-contribution socketed chain at depth > 0, or -1. */
function findPeel(chainList: readonly GemUpgradeChain[], depthList: readonly number[], socketed: ReadonlySet<string>): number {
  let bestIndex = -1;
  let bestContribution = -1;
  const len = Math.min(chainList.length, depthList.length);
  for (let index = 0; index < len; index++) {
    const chain = chainList[index];
    const depth = depthList[index];
    if (depth === 0) continue;
    const key = `${chain.gemId}|${chain.starRating}|${chain.steps[depth - 1].toRank}`;
    if (!socketed.has(key)) continue;
    const contribution = chain.steps[depth - 1].contributionAfter;
    if (contribution > bestContribution || (contribution === bestContribution && chain.gemId < chainList[bestIndex].gemId)) {
      bestContribution = contribution;
      bestIndex = index;
    }
  }
  return bestIndex;
}

/** Core optimization logic shared by both the plain and streaming call paths. */
export function runOptimization(
  request: OptimizeRequest,
  enableUpgrades: boolean,
  convert1Star: boolean,
  progress: ProgressReporter = nullReporter,
): OptimizeResponse {
  const { availablePower: parsedAvailablePower, mainGems, skippedSlots, inventory: parsedInventory } = requestToDomain(request);
  const alreadyDormant = alreadyDormantCounter(request);

  if (mainGems.length === 0) {
    throw new ValidationError('No valid main gems found in gem_setup. Provide at least one slot with a valid gem_id and target_rank.');
  }

  // Pre-extract R1 1-star gems so the optimizer (including the upgrade
  // pass) sees their gem-power equivalent in availablePower from the start.
  const availablePowerOrig = parsedAvailablePower;
  let availablePower = parsedAvailablePower;
  let inventory = parsedInventory;
  let r1Gems: InventoryGem[] = [];
  if (convert1Star) {
    r1Gems = inventory.filter((g) => g.starRating === 1 && g.rank === '1');
    inventory = inventory.filter((g) => !(g.starRating === 1 && g.rank === '1'));
    availablePower = availablePower + r1Gems.length;
  }

  const baseline = runPipeline(availablePower, mainGems, skippedSlots, inventory, { progress });

  if (!enableUpgrades) {
    const response = domainToResponse(baseline, null, inventory, alreadyDormant);
    return finalizeR1Conversion(response, availablePowerOrig, r1Gems);
  }

  // Build upgrade chains (one per socketable gem type) and run the
  // max-out -> optimize -> downgrade walk.
  const socketCounts = computeSocketCounts(mainGems);
  const { chains, leftover } = buildUpgradeChains(inventory, socketCounts);

  if (!chains.some((c) => c.steps.length > 0)) {
    const upgradeResult: UpgradeOptimizationResult = {
      baseline,
      upgraded: baseline,
      upgradesApplied: [],
      totalUpgradeCost: 0,
      effectiveResidual: baseline.totalResidualCost,
      improvement: 0,
    };
    const response = domainToResponse(baseline, upgradeResult, inventory, alreadyDormant);
    return finalizeR1Conversion(response, availablePowerOrig, r1Gems);
  }

  progress.report('upgrades', 'running', { detail: 'Evaluating upgrade potential...' });

  // Split chains by star rating. The walk fully exhausts 2-star options
  // before touching any 5-star chain: 5-star gems have a higher
  // gem-power-per-upgrade-cost ratio (~0.64 vs ~0.26 for 2-star) so they
  // are preserved as long as possible.
  const chains2 = chains.filter((c) => c.starRating === 2);
  const chains5 = chains.filter((c) => c.starRating === 5);
  const allChains = [...chains2, ...chains5]; // order matters: 2-star depths first
  const depths5 = chains5.map((c) => c.steps.length);

  interface Candidate {
    result: ReturnType<typeof runPipeline>;
    filtered: ReturnType<typeof filterUpgradesToSocketed>['filtered'];
    dropped: ReturnType<typeof filterUpgradesToSocketed>['droppedOps'];
    restore: InventoryGem[];
    effectiveResidual: number;
    netResidual: number;
    upgradeCost: number;
    working: InventoryGem[];
  }
  let bestCandidate: Candidate | null = null;
  let firstPipelineRun = true;

  // Only sockets in 5-star main gems reduce residual; gems in 2-star main
  // gem sockets must not be counted as "used" for peel/keep decisions.
  const fiveStarSlots = new Set(mainGems.filter((mg) => mg.starRating === 5).map((mg) => mg.slotName));

  function residualAssignments(
    gemAssignments: ReturnType<typeof runPipeline>['gemAssignments'],
  ): Map<string, ReturnType<typeof runPipeline>['gemAssignments'] extends Map<string, infer V> ? V : never> {
    const result = new Map();
    for (const [slot, asgns] of gemAssignments) {
      if (fiveStarSlots.has(slot)) result.set(slot, asgns);
    }
    return result;
  }

  let surplusFound = false;
  let socketed: Set<string> = new Set();
  let netResidual = 0;

  while (!surplusFound) {
    // Restore 2-star chains to their maximum depth for this 5-star configuration.
    const depths2 = chains2.map((c) => c.steps.length);

    while (true) {
      const { working, appliedDeltas } = materializeUpgrades(allChains, [...depths2, ...depths5], leftover);
      if (!firstPipelineRun) {
        progress.report('upgrades_rerun', 'running', { detail: 'Re-optimizing with upgrades...' });
      }
      const result = runPipeline(availablePower, mainGems, skippedSlots, working, {
        progress: firstPipelineRun ? progress : nullReporter,
        skipBonusPhases: true,
      });
      firstPipelineRun = false;
      const relevant = residualAssignments(result.gemAssignments);
      const { filtered, droppedOps: dropped, gemsToRestore: restore } = filterUpgradesToSocketed(appliedDeltas, relevant);
      const upgradeCost = filtered.reduce((s, d) => s + d.additionalGemPower, 0);
      const effectiveResidual = result.totalResidualCost + upgradeCost;
      // Net residual accounts for GP recoverable by making unsocketed gems
      // dormant. Used for walk decisions; effectiveResidual (gross) is used
      // for display in UpgradeOptimizationResult.
      netResidual = effectiveResidual - result.totalDormantPower;

      // Collapse all non-socketed 2-star chains to depth 0 immediately: a
      // non-socketed chain at depth > 0 has its cost refunded but its
      // consumed rank-1 fodder is gone, inflating residual. Restoring
      // always improves the effective residual.
      socketed = socketedSet(relevant);
      const nonSocketedIndices: number[] = [];
      for (let index = 0; index < chains2.length; index++) {
        const chain = chains2[index];
        const depth = depths2[index];
        if (depth > 0 && !socketed.has(`${chain.gemId}|${chain.starRating}|${chain.steps[depth - 1].toRank}`)) {
          nonSocketedIndices.push(index);
        }
      }
      if (nonSocketedIndices.length > 0) {
        for (const index of nonSocketedIndices) depths2[index] = 0;
        continue; // re-evaluate with fodder restored
      }

      // All non-socketed chains are at depth 0 -- this is a clean state.
      if (bestCandidate === null || netResidual < bestCandidate.netResidual) {
        bestCandidate = { result, filtered, dropped, restore, effectiveResidual, netResidual, upgradeCost, working };
      }

      if (netResidual <= availablePowerOrig) {
        surplusFound = true;
        break;
      }

      const peelIndex2 = findPeel(chains2, depths2, socketed);
      if (peelIndex2 < 0) break; // All 2-star at depth 0 -- fall through to peel one 5-star

      depths2[peelIndex2] -= 1;
    }

    if (surplusFound) break;

    // All 2-star are exhausted for this 5-star configuration. Use the
    // socketed set from the last evaluation to pick which 5-star to peel.
    const peelIndex5 = findPeel(chains5, depths5, socketed);
    if (peelIndex5 < 0) break; // no 5-star chains left to peel

    depths5[peelIndex5] -= 1;
    // depths2 will be reset to maximum at the top of the outer loop
  }

  // Unpack the chosen candidate. Re-run the full pipeline (with bonus
  // phases) on the winning inventory so the display result has correct
  // bonus activations and resonance.
  const chosen = bestCandidate!;
  const chosenWorking = chosen.working;
  // committedCost keeps redistributeForBonuses from double-spending the GP
  // already committed to the chosen upgrade plan.
  const chosenResult = runPipeline(availablePower, mainGems, skippedSlots, chosenWorking, { committedCost: chosen.upgradeCost });

  // The walk only tracked whether upgrade targets landed in five-star
  // sockets. The bonus-phase re-run above can place gems differently, so
  // re-check the walk's kept upgrades against the FULL socket assignment
  // and drop any whose target ends up unsocketed entirely.
  const { filtered: filteredUpgrades, droppedOps: droppedOps2, gemsToRestore: gemsToRestore2 } = filterUpgradesToSocketed(
    chosen.filtered,
    chosenResult.gemAssignments,
  );
  // droppedOps2 is chronologically earlier than the walk's own dropped ops
  // -- order it first so reverted-in-reverse unwinds multi-step chains
  // highest-rank-first.
  const droppedOps = [...droppedOps2, ...chosen.dropped];
  const gemsToRestore = [...gemsToRestore2, ...chosen.restore];
  const upgradeCost = filteredUpgrades.reduce((s, d) => s + d.additionalGemPower, 0);
  const effectiveResidual = chosenResult.totalResidualCost + upgradeCost;
  const improvement = baseline.totalResidualCost - effectiveResidual;

  const upgradeResult: UpgradeOptimizationResult = {
    baseline,
    upgraded: chosenResult,
    upgradesApplied: filteredUpgrades,
    totalUpgradeCost: upgradeCost,
    effectiveResidual,
    improvement,
  };

  // Build display inventory: start from the chosen materialized inventory,
  // revert ranks for dropped upgrade targets, append consumed copies.
  const assignedCopyIds = new Set<number>();
  for (const assignments of chosenResult.gemAssignments.values()) {
    for (const assignment of assignments) {
      if (assignment.copyId >= 0) assignedCopyIds.add(assignment.copyId);
    }
  }
  const displayInventory: InventoryGem[] = chosenWorking.map((g) => ({ ...g }));
  // Process dropped operations in reverse so multi-step chains unwind
  // correctly (e.g. rank 1->2->4.2 reverts 4.2->2 first, then 2->1).
  for (let i = droppedOps.length - 1; i >= 0; i--) {
    const [, mainDelta] = droppedOps[i];
    if (mainDelta.preUpgradeGem === null) continue;
    for (let index = 0; index < displayInventory.length; index++) {
      const gem = displayInventory[index];
      if (
        !assignedCopyIds.has(index) &&
        gem.gemId === mainDelta.gemId &&
        gem.starRating === mainDelta.starRating &&
        gem.rank === mainDelta.targetRank
      ) {
        displayInventory[index] = mainDelta.preUpgradeGem;
        break;
      }
    }
  }
  displayInventory.push(...gemsToRestore);

  const response = domainToResponse(chosenResult, upgradeResult, displayInventory, alreadyDormant);
  return finalizeR1Conversion(response, availablePowerOrig, r1Gems);
}
