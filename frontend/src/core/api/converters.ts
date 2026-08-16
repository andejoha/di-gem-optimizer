/**
 * Conversion helpers between wire-format request/response types and the
 * internal domain objects the optimizer operates on.
 */

import { MAX_SOCKETS, SLOT_ORDER, SOCKET_STAR_TYPE } from '../constants';
import { COST_TABLES, GEMS } from '../data';
import type { InventoryGem, MainGem, OptimizationResult, UpgradeOptimizationResult } from '../models';
import { makeInventoryGem } from '../models';
import { computeContribution, computeExtractablePower, computeSocketResonanceBonus, numSocketsUnlocked } from '../rules';
import { ValidationError } from './validate';
import type {
  DormantGemItem,
  GemResults,
  OptimizeRequest,
  OptimizeResponse,
  RemainingInventoryItem,
  SlotResponse,
  SocketResponse,
  SummaryResponse,
  UpgradeItem,
  UpgradesResponse,
} from './types';

function validRanksMessage(costTable: ReadonlyMap<string, { requiredGems: number; requiredGemPower: number }>): string {
  const valid = [...costTable.keys()].sort((rankA, rankB) => {
    const entryA = costTable.get(rankA)!;
    const entryB = costTable.get(rankB)!;
    if (entryA.requiredGems !== entryB.requiredGems) return entryA.requiredGems - entryB.requiredGems;
    return entryA.requiredGemPower - entryB.requiredGemPower;
  });
  return `[${valid.map((rank) => `'${rank}'`).join(', ')}]`;
}

export interface DomainRequest {
  availablePower: number;
  mainGems: MainGem[];
  skippedSlots: string[];
  inventory: InventoryGem[];
}

/** Converts a request into internal domain objects, validating gem ids and ranks along the way. Throws ValidationError on invalid input. */
export function requestToDomain(request: OptimizeRequest): DomainRequest {
  const availablePower = request.gem_power;
  const mainGems: MainGem[] = [];
  const skippedSlots: string[] = [];

  for (const slot of SLOT_ORDER) {
    const item = request.gem_setup[slot];
    if (item === null || item === undefined) {
      skippedSlots.push(slot);
      continue;
    }

    const gemDef = GEMS.get(item.gem_id);
    if (gemDef === undefined) {
      throw new ValidationError(`Unknown gem_id ${item.gem_id} for slot '${slot}'.`);
    }

    const rank = item.target_rank.trim();
    const starRating = gemDef.starRating;
    const costTable = COST_TABLES.get(starRating)!;

    if (!costTable.has(rank)) {
      throw new ValidationError(
        `Invalid target_rank '${rank}' for slot '${slot}' (gem_id=${item.gem_id}, star_rating=${starRating}). Valid ${starRating}-star ranks: ${validRanksMessage(costTable)}`,
      );
    }

    const entry = costTable.get(rank)!;
    mainGems.push({
      slotName: slot,
      gemId: item.gem_id,
      starRating,
      targetRank: rank,
      requiredPower: entry.requiredGemPower,
      numSockets: numSocketsUnlocked(rank, starRating),
      activeStars: item.active_stars,
    });
  }

  const inventory: InventoryGem[] = [];
  request.inventory.forEach((inventoryItem, index) => {
    const gemDef = GEMS.get(inventoryItem.gem_id);
    if (gemDef === undefined) {
      throw new ValidationError(`Unknown gem_id ${inventoryItem.gem_id} for inventory item ${index}.`);
    }

    const rank = inventoryItem.rank.trim();
    const starRating = gemDef.starRating;
    const costTable = COST_TABLES.get(starRating)!;

    if (!costTable.has(rank)) {
      throw new ValidationError(
        `Invalid rank '${rank}' for inventory item ${index} (gem_id=${inventoryItem.gem_id}, star_rating=${starRating}). Valid ${starRating}-star ranks: ${validRanksMessage(costTable)}`,
      );
    }

    const contribution = computeContribution(starRating, rank, costTable);
    inventory.push(
      makeInventoryGem({
        gemId: inventoryItem.gem_id,
        starRating,
        rank,
        quantity: 1,
        activeStars: inventoryItem.active_stars,
        contribution,
      }),
    );
  });

  return { availablePower, mainGems, skippedSlots, inventory };
}

/**
 * Counts inventory copies the player already marked dormant before
 * submitting, keyed by (gemId, starRating, rank, activeStars) -- the same
 * identity `domainToResponse` uses for `dormant_gems`. A missing key means
 * a count of 0.
 */
export function alreadyDormantCounter(request: OptimizeRequest): Map<string, number> {
  const counter = new Map<string, number>();
  for (const inventoryItem of request.inventory) {
    if (!inventoryItem.dormant) continue;
    const gemDef = GEMS.get(inventoryItem.gem_id);
    if (gemDef === undefined) continue;
    const key = dormantKey(inventoryItem.gem_id, gemDef.starRating, inventoryItem.rank.trim(), inventoryItem.active_stars);
    counter.set(key, (counter.get(key) ?? 0) + 1);
  }
  return counter;
}

function dormantKey(gemId: number, starRating: number, rank: string, activeStars: number): string {
  return `${gemId}|${starRating}|${rank}|${activeStars}`;
}

/** Converts internal domain objects into a JSON-serialisable response. */
export function domainToResponse(
  result: OptimizationResult,
  upgradeResult: UpgradeOptimizationResult | null,
  inventory: readonly InventoryGem[],
  alreadyDormant: ReadonlyMap<string, number> = new Map(),
): OptimizeResponse {
  const residual = result.totalResidualCost;
  const summaryResidual = upgradeResult !== null ? upgradeResult.effectiveResidual : residual;

  const slotMap = new Map<string, SlotResponse>();
  const bonusTable = result.bonusTable;

  const mainGemStarRatingBySlot = new Map(result.mainGems.map((mainGem) => [mainGem.slotName, mainGem.starRating]));
  const mainGemActiveStarsBySlot = new Map(result.mainGems.map((mainGem) => [mainGem.slotName, mainGem.activeStars]));

  for (const gemResult of result.gemResults) {
    const bonusRequirements = bonusTable.get(gemResult.gemId) ?? [];
    const assignments = result.gemAssignments.get(gemResult.slotName) ?? [];
    const gemStarRating = mainGemStarRatingBySlot.get(gemResult.slotName) ?? 5;
    const gemActiveStars = mainGemActiveStarsBySlot.get(gemResult.slotName) ?? gemStarRating;
    const socketTypeMap = SOCKET_STAR_TYPE[gemStarRating];

    const sockets: SocketResponse[] = [];
    for (let socketIndex = 0; socketIndex < MAX_SOCKETS[gemStarRating]; socketIndex++) {
      const bonusGemId = socketIndex < bonusRequirements.length ? bonusRequirements[socketIndex] : null;
      const starType = socketTypeMap[socketIndex];

      if (socketIndex >= gemResult.socketsUnlocked) {
        sockets.push({
          socket_index: socketIndex + 1,
          socket_star_type: starType,
          status: 'locked',
          assigned_gem_id: null,
          assigned_gem_star_rating: null,
          assigned_gem_rank: null,
          assigned_gem_active_stars: null,
          contribution: null,
          bonus_gem_required_id: bonusGemId,
          bonus_activated: null,
          socket_resonance: null,
        });
        continue;
      }

      const assignment = assignments.find((candidate) => candidate.socketIndex === socketIndex) ?? null;
      if (assignment === null || assignment.gem === null) {
        sockets.push({
          socket_index: socketIndex + 1,
          socket_star_type: starType,
          status: 'empty',
          assigned_gem_id: null,
          assigned_gem_star_rating: null,
          assigned_gem_rank: null,
          assigned_gem_active_stars: null,
          contribution: null,
          bonus_gem_required_id: bonusGemId,
          bonus_activated: null,
          socket_resonance: null,
        });
      } else {
        const gem = assignment.gem;
        const socketResonance = computeSocketResonanceBonus(gem.starRating, gem.activeStars, gem.rank);
        sockets.push({
          socket_index: socketIndex + 1,
          socket_star_type: starType,
          status: 'assigned',
          assigned_gem_id: gem.gemId,
          assigned_gem_star_rating: gem.starRating,
          assigned_gem_rank: gem.rank,
          assigned_gem_active_stars: gem.activeStars,
          contribution: assignment.contribution,
          bonus_gem_required_id: bonusGemId,
          bonus_activated: assignment.bonusActivated,
          socket_resonance: socketResonance,
        });
      }
    }

    slotMap.set(gemResult.slotName, {
      gem_id: gemResult.gemId,
      star_rating: gemStarRating,
      active_stars: gemActiveStars,
      target_rank: gemResult.targetRank,
      sockets_unlocked: gemResult.socketsUnlocked,
      required_power: gemResult.requiredPower,
      total_socketed_power: gemResult.totalSocketedPower,
      residual_cost: gemResult.residualCost,
      bonuses_activated: gemResult.bonusesActivated,
      bonuses_possible: gemResult.bonusesPossible,
      base_resonance: gemResult.baseResonance,
      socket_resonance_bonus: gemResult.socketResonanceBonus,
      total_resonance: gemResult.totalResonance,
      sockets,
    });
  }

  const gemResults: GemResults = {
    head: slotMap.get('head') ?? null,
    chest: slotMap.get('chest') ?? null,
    shoulders: slotMap.get('shoulders') ?? null,
    legs: slotMap.get('legs') ?? null,
    main_hand: slotMap.get('main_hand') ?? null,
    off_hand: slotMap.get('off_hand') ?? null,
    alt_main_hand: slotMap.get('alt_main_hand') ?? null,
    alt_off_hand: slotMap.get('alt_off_hand') ?? null,
  };

  let upgradesResponse: UpgradesResponse | null = null;
  if (upgradeResult !== null) {
    const baseline = upgradeResult.baseline;
    const baselineResidual = baseline.totalResidualCost;
    const baselineDormantPower = baseline.totalDormantPower;
    const baselineEffectiveAvailable = baseline.availablePower + baselineDormantPower;
    const baselineFeasible = baselineResidual <= baselineEffectiveAvailable;
    const baselineSummary: SummaryResponse = {
      total_socketed_power: baseline.totalSocketedPower,
      total_required_power: baseline.totalRequiredPower,
      total_residual_cost: baselineResidual,
      available_power: baseline.availablePower,
      status: baselineFeasible ? 'feasible' : 'shortfall',
      surplus_or_shortfall: baselineEffectiveAvailable - baselineResidual,
      skipped_slots: baseline.skippedSlots,
      total_resonance: baseline.totalResonance,
      dormant_gem_power: baselineDormantPower,
      newly_dormant_gem_power: baselineDormantPower,
    };
    const upgradesApplied: UpgradeItem[] = upgradeResult.upgradesApplied.map((delta) => ({
      upgrade_type: delta.upgradeType,
      gem_id: delta.gemId,
      star_rating: delta.starRating,
      current_rank: delta.currentRank,
      target_rank: delta.targetRank,
      gem_power_cost: delta.additionalGemPower,
      socketed_power_gain: delta.additionalSocketPower,
      net_gain: delta.netGain,
      copies_sacrificed: delta.copiesSacrificed,
    }));
    upgradesResponse = {
      upgrades_applied: upgradesApplied,
      total_upgrade_cost: upgradeResult.totalUpgradeCost,
      baseline_residual_cost: upgradeResult.baseline.totalResidualCost,
      upgraded_residual_cost: upgradeResult.upgraded.totalResidualCost,
      baseline_summary: baselineSummary,
    };
  }

  // Compute remaining inventory and dormant gems in a single pass over the
  // unassigned copies (inventory index equals copy id here, since
  // requestToDomain always builds one InventoryGem entry per copy).
  const assignedIds = new Set<number>();
  for (const assignments of result.gemAssignments.values()) {
    for (const assignment of assignments) {
      if (assignment.copyId >= 0) assignedIds.add(assignment.copyId);
    }
  }
  const remainingInventory: RemainingInventoryItem[] = [];
  // Maps (gemId, star, rank, active) -> gem power per unassigned copy. A
  // Map, not a plain object, since dormant_gems array order is directly
  // observable in the response.
  const dormantPowerByGem = new Map<string, number[]>();
  const dormantIdentity = new Map<string, { gemId: number; starRating: number; rank: string; activeStars: number }>();
  inventory.forEach((gem, index) => {
    if (assignedIds.has(index)) return;
    remainingInventory.push({
      gem_id: gem.gemId,
      star_rating: gem.starRating,
      rank: gem.rank,
      active_stars: gem.activeStars,
      contribution: gem.contribution,
    });
    const extractablePower = computeExtractablePower(gem.rank, COST_TABLES.get(gem.starRating)!);
    if (extractablePower > 0) {
      const key = dormantKey(gem.gemId, gem.starRating, gem.rank, gem.activeStars);
      const powerList = dormantPowerByGem.get(key);
      if (powerList) powerList.push(extractablePower);
      else {
        dormantPowerByGem.set(key, [extractablePower]);
        dormantIdentity.set(key, { gemId: gem.gemId, starRating: gem.starRating, rank: gem.rank, activeStars: gem.activeStars });
      }
    }
  });

  let totalDormantPower = 0;
  for (const powerList of dormantPowerByGem.values()) for (const power of powerList) totalDormantPower += power;

  // Split each key's unassigned copies into "already dormant on input" and
  // "newly" dormant, consuming already-dormant copies highest-power-first.
  const dormantGems: DormantGemItem[] = [];
  let totalNewlyDormantPower = 0;
  for (const [key, powerList] of dormantPowerByGem) {
    const identity = dormantIdentity.get(key)!;
    const sortedPower = [...powerList].sort((a, b) => b - a);
    const alreadyCount = Math.min(alreadyDormant.get(key) ?? 0, sortedPower.length);
    const newlyDormantPower = sortedPower.slice(alreadyCount);
    const newlyDormantSum = newlyDormantPower.reduce((sum, power) => sum + power, 0);
    totalNewlyDormantPower += newlyDormantSum;
    dormantGems.push({
      gem_id: identity.gemId,
      star_rating: identity.starRating,
      rank: identity.rank,
      active_stars: identity.activeStars,
      quantity: newlyDormantPower.length,
      gem_power_gained: newlyDormantSum,
      already_dormant_quantity: alreadyCount,
    });
  }

  const effectiveAvailable = result.availablePower + totalDormantPower;
  const feasible = summaryResidual <= effectiveAvailable;
  const summary: SummaryResponse = {
    total_socketed_power: result.totalSocketedPower,
    total_required_power: result.totalRequiredPower,
    total_residual_cost: summaryResidual,
    available_power: result.availablePower,
    status: feasible ? 'feasible' : 'shortfall',
    surplus_or_shortfall: effectiveAvailable - summaryResidual,
    skipped_slots: result.skippedSlots,
    total_resonance: result.totalResonance,
    dormant_gem_power: totalDormantPower,
    newly_dormant_gem_power: totalNewlyDormantPower,
  };

  return {
    summary,
    gem_results: gemResults,
    upgrades: upgradesResponse,
    remaining_inventory: remainingInventory,
    converted_gems: [],
    dormant_gems: dormantGems,
  };
}
