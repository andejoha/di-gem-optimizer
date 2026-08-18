/**
 * Core orchestration for running the optimizer end to end: parses the
 * request, runs the baseline pipeline, and -- when upgrades are enabled --
 * searches for the most cost-effective set of gem upgrades before producing
 * the final response. When bonus mode 'budget' is selected, a post-pipeline
 * swap pass (see `bonusBudget.ts`) then spends any remaining surplus
 * activating bonuses, and the upgrade bookkeeping and display inventory are
 * re-derived from its result. See docs/SPEC.md ("Bonus activation modes").
 */

import { bagsFromAssignments, budgetActivateBonuses, type BudgetEvaluation, type BudgetEvaluator } from '../bonusBudget';
import type { BonusMode, InventoryGem, MainGem, SocketAssignment, UpgradeDelta, UpgradeOptimizationResult } from '../models';
import { type CopyEntry, expandInventory } from '../optimizer';
import { materializeResult, runPipeline } from '../pipeline';
import { nullReporter, type ProgressReporter } from '../progress';
import { sumDormantPower } from '../rules';
import { buildUpgradeChains, computeSocketCounts, filterUpgradesToSocketed, materializeUpgrades, type GemUpgradeChain } from '../upgrades';
import { alreadyDormantCounter, domainToResponse, requestToDomain } from './converters';
import type { ConvertedGemItem, OptimizeRequest, OptimizeResponse, RemainingInventoryItem } from './types';
import { ValidationError } from './validate';

/**
 * Reconciles pre-extracted rank-1 1-star gems with the optimization
 * result. Before optimization, rank-1 1-star gems were removed from the
 * inventory and their count added to the available power pool; this
 * determines how many were actually needed, reports them as converted,
 * and returns the rest to the remaining inventory.
 */
function finalizeRankOneConversion(
  response: OptimizeResponse,
  originalAvailablePower: number,
  rankOneGems: readonly InventoryGem[],
): OptimizeResponse {
  if (rankOneGems.length === 0) return response;

  const totalResidual = response.summary.total_residual_cost;
  const dormantPower = response.summary.dormant_gem_power;
  const gemsUsed = Math.min(rankOneGems.length, Math.max(0, totalResidual - originalAvailablePower - dormantPower));

  const unused = rankOneGems.slice(gemsUsed);
  const restored: RemainingInventoryItem[] = unused.map((gem) => ({
    gem_id: gem.gemId,
    star_rating: gem.starRating,
    rank: gem.rank,
    active_stars: gem.activeStars,
    contribution: gem.contribution,
  }));

  const newAvailable = originalAvailablePower + gemsUsed;
  const newSurplus = newAvailable + dormantPower - totalResidual;

  const patchedSummary = {
    ...response.summary,
    available_power: newAvailable,
    status: (newSurplus >= 0 ? 'feasible' : 'shortfall') as 'feasible' | 'shortfall',
    surplus_or_shortfall: newSurplus,
  };

  // The upgrades block's baseline summary was computed with the same
  // rank-1-inflated available power and needs the same reconciliation, so
  // the "without upgrades" surplus isn't overstated.
  let patchedUpgrades = response.upgrades;
  if (response.upgrades !== null) {
    const baselineResidual = response.upgrades.baseline_summary.total_residual_cost;
    const baselineDormantPower = response.upgrades.baseline_summary.dormant_gem_power;
    const baselineGemsUsed = Math.min(rankOneGems.length, Math.max(0, baselineResidual - originalAvailablePower - baselineDormantPower));
    const baselineNewAvailable = originalAvailablePower + baselineGemsUsed;
    const baselineNewSurplus = baselineNewAvailable + baselineDormantPower - baselineResidual;
    const patchedBaselineSummary = {
      ...response.upgrades.baseline_summary,
      available_power: baselineNewAvailable,
      status: (baselineNewSurplus >= 0 ? 'feasible' : 'shortfall') as 'feasible' | 'shortfall',
      surplus_or_shortfall: baselineNewSurplus,
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

  const countByGemId = new Map<number, number>();
  for (const gem of rankOneGems.slice(0, gemsUsed)) {
    countByGemId.set(gem.gemId, (countByGemId.get(gem.gemId) ?? 0) + 1);
  }
  const convertedGems: ConvertedGemItem[] = [...countByGemId].map(([gemId, quantity]) => ({
    gem_id: gemId,
    quantity,
    gem_power_gained: quantity,
  }));

  return {
    ...response,
    summary: patchedSummary,
    upgrades: patchedUpgrades,
    remaining_inventory: [...response.remaining_inventory, ...restored],
    converted_gems: convertedGems,
  };
}

/** Returns the set of (gemId, starRating, rank) identities currently occupying a socket. */
function socketedIdentities(gemAssignments: ReadonlyMap<string, readonly { gem: InventoryGem | null }[]>): Set<string> {
  const identities = new Set<string>();
  for (const assignments of gemAssignments.values()) {
    for (const assignment of assignments) {
      if (assignment.gem !== null) {
        identities.add(`${assignment.gem.gemId}|${assignment.gem.starRating}|${assignment.gem.rank}`);
      }
    }
  }
  return identities;
}

/** Returns the index of the highest-contribution socketed chain at depth > 0, or -1 if none qualify. */
function findChainToPeel(chains: readonly GemUpgradeChain[], depths: readonly number[], socketedIdentitySet: ReadonlySet<string>): number {
  let bestIndex = -1;
  let bestContribution = -1;
  const len = Math.min(chains.length, depths.length);
  for (let index = 0; index < len; index++) {
    const chain = chains[index];
    const depth = depths[index];
    if (depth === 0) continue;
    const identity = `${chain.gemId}|${chain.starRating}|${chain.steps[depth - 1].toRank}`;
    if (!socketedIdentitySet.has(identity)) continue;
    const contribution = chain.steps[depth - 1].contributionAfter;
    if (contribution > bestContribution || (contribution === bestContribution && chain.gemId < chains[bestIndex].gemId)) {
      bestContribution = contribution;
      bestIndex = index;
    }
  }
  return bestIndex;
}

/** Restricts `gemAssignments` to the slots in `fiveStarSlots` -- only those sockets reduce residual cost (see docs/SPEC.md). */
function restrictToFiveStarSlots(
  gemAssignments: ReadonlyMap<string, SocketAssignment[]>,
  fiveStarSlots: ReadonlySet<string>,
): Map<string, SocketAssignment[]> {
  const result = new Map<string, SocketAssignment[]>();
  for (const [slot, assignments] of gemAssignments) {
    if (fiveStarSlots.has(slot)) result.set(slot, assignments);
  }
  return result;
}

/**
 * Reverts each dropped upgrade operation's target rank back to its
 * pre-upgrade rank (most recent step first, so multi-step chains unwind
 * correctly), skipping any index already claimed by a socket assignment,
 * then appends the restored fodder for display.
 */
function buildDisplayInventory(
  working: readonly InventoryGem[],
  droppedOps: ReadonlyArray<readonly [UpgradeDelta[], UpgradeDelta]>,
  gemsToRestore: readonly InventoryGem[],
  assignedCopyIds: ReadonlySet<number>,
): InventoryGem[] {
  const displayInventory: InventoryGem[] = working.map((gem) => ({ ...gem }));
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
  return displayInventory;
}

/** Everything `deriveFromBags` needs that stays constant across every trial (the base pipeline call, every upgrade depth candidate, every budget swap trial). */
interface DerivationContext {
  mainGems: readonly MainGem[];
  skippedSlots: readonly string[];
  availablePower: number;
  bonusTable: Map<number, number[]>;
  working: readonly InventoryGem[];
  appliedDeltas: readonly UpgradeDelta[];
  fiveStarSlots: ReadonlySet<string>;
}

/** Everything derived from one candidate per-slot bag assignment: the materialized result, upgrade bookkeeping, display inventory, and the response-accurate surplus/bonus count. */
interface DerivedAssignment {
  result: ReturnType<typeof materializeResult>;
  filtered: UpgradeDelta[];
  upgradeCost: number;
  effectiveResidual: number;
  displayInventory: InventoryGem[];
  surplus: number;
  bonuses: number;
}

/**
 * Derives a full `DerivedAssignment` from a candidate per-slot bag
 * assignment: materializes sockets (phase 3), filters upgrades down to what
 * is actually socketed in a five-star main gem, rebuilds the display
 * inventory, and computes surplus and total activated bonuses exactly as
 * the final response will report them.
 *
 * The upgrade depth walk in `runOptimization` has its own inline loop and
 * does not call this function for each candidate depth; it calls it once,
 * for the winning depth's result. The bonus budget pass calls it once per
 * swap trial.
 */
function deriveFromBags(ctx: DerivationContext, perSlotGems: ReadonlyMap<string, readonly CopyEntry[]>): DerivedAssignment {
  const allCopies = expandInventory(ctx.working);
  const result = materializeResult(ctx.availablePower, ctx.mainGems, ctx.skippedSlots, allCopies, perSlotGems, ctx.bonusTable);

  const relevant = restrictToFiveStarSlots(result.gemAssignments, ctx.fiveStarSlots);
  const { filtered, droppedOps, gemsToRestore } = filterUpgradesToSocketed(ctx.appliedDeltas, relevant, result.gemAssignments);
  const upgradeCost = filtered.reduce((sum, delta) => sum + delta.additionalGemPower, 0);
  const effectiveResidual = result.totalResidualCost + upgradeCost;

  const assignedCopyIds = new Set<number>();
  for (const assignments of result.gemAssignments.values()) {
    for (const assignment of assignments) {
      if (assignment.copyId >= 0) assignedCopyIds.add(assignment.copyId);
    }
  }

  const displayInventory = buildDisplayInventory(ctx.working, droppedOps, gemsToRestore, assignedCopyIds);
  const dormantPower = sumDormantPower(displayInventory, assignedCopyIds);
  const surplus = result.availablePower + dormantPower - effectiveResidual;
  const bonuses = result.gemResults.reduce((sum, gemResult) => sum + gemResult.bonusesActivated, 0);

  return { result, filtered, upgradeCost, effectiveResidual, displayInventory, surplus, bonuses };
}

/**
 * Finalizes one candidate per-slot bag assignment into a response: derives
 * the result, runs the bonus budget pass when selected, assembles the
 * upgrades block (when `baseline` is given), and reconciles rank-1
 * conversion last. Used by every return path in `runOptimization` (no
 * upgrades, no viable upgrade chains, and the winning upgrade depth).
 *
 * The budget pass, if it accepts a swap, re-derives the upgrade bookkeeping
 * from its winning bags -- see docs/SPEC.md ("Bonus activation modes"). It
 * never runs against `baseline` (the "without upgrades" comparison).
 */
function finalizeResponse(
  ctx: DerivationContext,
  initialPerSlotGems: ReadonlyMap<string, readonly CopyEntry[]>,
  baseline: ReturnType<typeof materializeResult> | null,
  bonusMode: BonusMode,
  progress: ProgressReporter,
  alreadyDormant: ReadonlyMap<string, number>,
  originalAvailablePower: number,
  rankOneGems: readonly InventoryGem[],
): OptimizeResponse {
  let derived = deriveFromBags(ctx, initialPerSlotGems);

  if (bonusMode === 'budget') {
    progress.report('bonus_budget', 'running', { detail: 'Activating gem bonuses...' });
    const evaluate: BudgetEvaluator = (bags) => {
      const trial = deriveFromBags(ctx, bags);
      return { result: trial.result, surplus: trial.surplus, bonuses: trial.bonuses };
    };
    const initialEvaluation: BudgetEvaluation = { result: derived.result, surplus: derived.surplus, bonuses: derived.bonuses };
    const winner = budgetActivateBonuses(ctx.mainGems, ctx.bonusTable, expandInventory(ctx.working), initialEvaluation, evaluate);
    derived = deriveFromBags(ctx, bagsFromAssignments(winner.result));
  }

  const upgradeResult: UpgradeOptimizationResult | null =
    baseline === null
      ? null
      : {
          baseline,
          upgraded: derived.result,
          upgradesApplied: derived.filtered,
          totalUpgradeCost: derived.upgradeCost,
          effectiveResidual: derived.effectiveResidual,
          improvement: baseline.totalResidualCost - derived.effectiveResidual,
        };

  const response = domainToResponse(derived.result, upgradeResult, derived.displayInventory, alreadyDormant);
  return finalizeRankOneConversion(response, originalAvailablePower, rankOneGems);
}

/**
 * Runs the optimizer end to end: parses and validates the request, runs
 * the baseline pipeline, and -- when `enableUpgrades` is set -- searches
 * for the most cost-effective combination of gem upgrades before
 * producing the final response. `bonusMode` selects the bonus activation
 * strategy: 'off' (default, tie-break only), 'forced' (biases gem
 * selection inside the pipeline itself), or 'budget' (a post-pipeline swap
 * pass, see `finalizeResponse`). Throws ValidationError if the request has
 * no valid main gems.
 */
export function runOptimization(
  request: OptimizeRequest,
  enableUpgrades: boolean,
  convert1Star: boolean,
  bonusMode: BonusMode = 'off',
  progress: ProgressReporter = nullReporter,
): OptimizeResponse {
  const { availablePower: parsedAvailablePower, mainGems, skippedSlots, inventory: parsedInventory } = requestToDomain(request);
  const alreadyDormant = alreadyDormantCounter(request);

  if (mainGems.length === 0) {
    throw new ValidationError('No valid main gems found in gem_setup. Provide at least one slot with a valid gem_id and target_rank.');
  }

  // When convert1Star is set, rank-1 1-star gems are removed from the
  // inventory up front and their count is added to the available power
  // pool, so the optimizer (including the upgrade search below) sees
  // their gem-power equivalent from the start.
  const originalAvailablePower = parsedAvailablePower;
  let availablePower = parsedAvailablePower;
  let inventory = parsedInventory;
  let rankOneGems: InventoryGem[] = [];
  if (convert1Star) {
    rankOneGems = inventory.filter((gem) => gem.starRating === 1 && gem.rank === '1');
    inventory = inventory.filter((gem) => !(gem.starRating === 1 && gem.rank === '1'));
    availablePower = availablePower + rankOneGems.length;
  }

  const baseline = runPipeline(availablePower, mainGems, skippedSlots, inventory, { progress, bonusMode });

  // Only sockets in five-star main gems reduce residual cost; gems placed
  // in two-star main gem sockets must not be counted as "used" when
  // deciding which upgrades to keep, nor as activatable by the budget pass.
  const fiveStarSlots = new Set(mainGems.filter((mainGem) => mainGem.starRating === 5).map((mainGem) => mainGem.slotName));

  const noUpgradeCtx: DerivationContext = {
    mainGems,
    skippedSlots,
    availablePower,
    bonusTable: baseline.bonusTable,
    working: inventory,
    appliedDeltas: [],
    fiveStarSlots,
  };

  if (!enableUpgrades) {
    return finalizeResponse(
      noUpgradeCtx,
      bagsFromAssignments(baseline),
      null,
      bonusMode,
      progress,
      alreadyDormant,
      originalAvailablePower,
      rankOneGems,
    );
  }

  // Build upgrade chains (one per socketable gem type) and search for the
  // most cost-effective combination of upgrade depths.
  const socketCounts = computeSocketCounts(mainGems);
  const { chains, leftover } = buildUpgradeChains(inventory, socketCounts);

  if (!chains.some((chain) => chain.steps.length > 0)) {
    return finalizeResponse(
      noUpgradeCtx,
      bagsFromAssignments(baseline),
      baseline,
      bonusMode,
      progress,
      alreadyDormant,
      originalAvailablePower,
      rankOneGems,
    );
  }

  progress.report('upgrades', 'running', { detail: 'Evaluating upgrade potential...' });

  // Two-star chains are fully exhausted before touching any five-star
  // chain: five-star gems have a higher gem-power-per-upgrade-cost ratio
  // (roughly 0.64 vs 0.26 for two-star), so they're preserved as long as
  // possible.
  const twoStarChains = chains.filter((chain) => chain.starRating === 2);
  const fiveStarChains = chains.filter((chain) => chain.starRating === 5);
  const allChains = [...twoStarChains, ...fiveStarChains]; // order matters: two-star depths first
  const fiveStarDepths = fiveStarChains.map((chain) => chain.steps.length);

  interface Candidate {
    result: ReturnType<typeof runPipeline>;
    effectiveResidual: number;
    netResidual: number;
    working: InventoryGem[];
    appliedDeltas: UpgradeDelta[];
  }
  let bestCandidate: Candidate | null = null;
  let firstPipelineRun = true;

  function fiveStarAssignments(gemAssignments: Map<string, SocketAssignment[]>): Map<string, SocketAssignment[]> {
    return restrictToFiveStarSlots(gemAssignments, fiveStarSlots);
  }

  let surplusFound = false;
  let socketedIdentitySet: Set<string> = new Set();
  let netResidual = 0;

  while (!surplusFound) {
    // Restore two-star chains to their maximum depth for this five-star configuration.
    const twoStarDepths = twoStarChains.map((chain) => chain.steps.length);

    while (true) {
      const { working, appliedDeltas } = materializeUpgrades(allChains, [...twoStarDepths, ...fiveStarDepths], leftover);
      if (!firstPipelineRun) {
        progress.report('upgrades_rerun', 'running', { detail: 'Re-optimizing with upgrades...' });
      }
      const result = runPipeline(availablePower, mainGems, skippedSlots, working, {
        progress: firstPipelineRun ? progress : nullReporter,
        bonusMode,
      });
      firstPipelineRun = false;
      const relevant = fiveStarAssignments(result.gemAssignments);
      const { filtered } = filterUpgradesToSocketed(appliedDeltas, relevant, result.gemAssignments);
      const upgradeCost = filtered.reduce((sum, delta) => sum + delta.additionalGemPower, 0);
      const effectiveResidual = result.totalResidualCost + upgradeCost;
      // Net residual credits the gem power recoverable by making
      // unsocketed gems dormant. Used to decide when to stop the search;
      // effectiveResidual (gross) is what's displayed to the player.
      netResidual = effectiveResidual - result.totalDormantPower;

      // Collapse all non-socketed two-star chains to depth 0 immediately:
      // a non-socketed chain at depth > 0 has its cost refunded but its
      // consumed rank-1 fodder is gone, inflating residual. Restoring it
      // always improves the effective residual.
      socketedIdentitySet = socketedIdentities(relevant);
      const nonSocketedIndices: number[] = [];
      for (let index = 0; index < twoStarChains.length; index++) {
        const chain = twoStarChains[index];
        const depth = twoStarDepths[index];
        if (depth > 0 && !socketedIdentitySet.has(`${chain.gemId}|${chain.starRating}|${chain.steps[depth - 1].toRank}`)) {
          nonSocketedIndices.push(index);
        }
      }
      if (nonSocketedIndices.length > 0) {
        for (const index of nonSocketedIndices) twoStarDepths[index] = 0;
        continue; // re-evaluate with fodder restored
      }

      // All non-socketed chains are at depth 0 -- this is a clean state.
      if (bestCandidate === null || netResidual < bestCandidate.netResidual) {
        bestCandidate = { result, effectiveResidual, netResidual, working, appliedDeltas };
      }

      if (netResidual <= originalAvailablePower) {
        surplusFound = true;
        break;
      }

      const chainToPeel = findChainToPeel(twoStarChains, twoStarDepths, socketedIdentitySet);
      if (chainToPeel < 0) break; // All two-star at depth 0 -- fall through to peel one five-star chain

      twoStarDepths[chainToPeel] -= 1;
    }

    if (surplusFound) break;

    // All two-star chains are exhausted for this five-star configuration.
    // Use the socketed set from the last evaluation to pick which
    // five-star chain to peel.
    const chainToPeel = findChainToPeel(fiveStarChains, fiveStarDepths, socketedIdentitySet);
    if (chainToPeel < 0) break; // no five-star chains left to peel

    fiveStarDepths[chainToPeel] -= 1;
    // twoStarDepths will be reset to maximum at the top of the outer loop
  }

  // The search already ran the full pipeline on the winning inventory;
  // finalizeResponse re-derives the upgrade bookkeeping and display
  // inventory from it (and applies the bonus budget pass, if selected).
  const chosen = bestCandidate!;
  const ctx: DerivationContext = {
    mainGems,
    skippedSlots,
    availablePower,
    bonusTable: baseline.bonusTable,
    working: chosen.working,
    appliedDeltas: chosen.appliedDeltas,
    fiveStarSlots,
  };
  return finalizeResponse(
    ctx,
    bagsFromAssignments(chosen.result),
    baseline,
    bonusMode,
    progress,
    alreadyDormant,
    originalAvailablePower,
    rankOneGems,
  );
}
