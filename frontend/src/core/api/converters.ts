/**
 * Conversion helpers between wire-format API types and core domain objects.
 * Ported from backend/app/api/converters.py.
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
  const valid = [...costTable.keys()].sort((a, b) => {
    const ea = costTable.get(a)!;
    const eb = costTable.get(b)!;
    if (ea.requiredGems !== eb.requiredGems) return ea.requiredGems - eb.requiredGems;
    return ea.requiredGemPower - eb.requiredGemPower;
  });
  return `[${valid.map((r) => `'${r}'`).join(', ')}]`;
}

export interface DomainRequest {
  availablePower: number;
  mainGems: MainGem[];
  skippedSlots: string[];
  inventory: InventoryGem[];
}

/** Converts a validated API request into internal domain objects. Throws ValidationError on invalid input (mirrors HTTP 422). */
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
  request.inventory.forEach((invItem, i) => {
    const gemDef = GEMS.get(invItem.gem_id);
    if (gemDef === undefined) {
      throw new ValidationError(`Unknown gem_id ${invItem.gem_id} for inventory item ${i}.`);
    }

    const rank = invItem.rank.trim();
    const starRating = gemDef.starRating;
    const costTable = COST_TABLES.get(starRating)!;

    if (!costTable.has(rank)) {
      throw new ValidationError(
        `Invalid rank '${rank}' for inventory item ${i} (gem_id=${invItem.gem_id}, star_rating=${starRating}). Valid ${starRating}-star ranks: ${validRanksMessage(costTable)}`,
      );
    }

    const contribution = computeContribution(starRating, rank, costTable);
    inventory.push(
      makeInventoryGem({
        gemId: invItem.gem_id,
        starRating,
        rank,
        quantity: 1,
        activeStars: invItem.active_stars,
        contribution,
      }),
    );
  });

  return { availablePower, mainGems, skippedSlots, inventory };
}

/**
 * Counts inventory copies the player already marked dormant before
 * submitting. Keyed by (gemId, starRating, rank, activeStars) -- the same
 * identity domainToResponse uses for dormant_gems -- via a 4-part string
 * key so it survives as a Map (Counter semantics: missing key -> 0).
 */
export function alreadyDormantCounter(request: OptimizeRequest): Map<string, number> {
  const counter = new Map<string, number>();
  for (const invItem of request.inventory) {
    if (!invItem.dormant) continue;
    const gemDef = GEMS.get(invItem.gem_id);
    if (gemDef === undefined) continue;
    const key = dormantKey(invItem.gem_id, gemDef.starRating, invItem.rank.trim(), invItem.active_stars);
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

  const mgStarMap = new Map(result.mainGems.map((mg) => [mg.slotName, mg.starRating]));
  const mgActiveStarsMap = new Map(result.mainGems.map((mg) => [mg.slotName, mg.activeStars]));

  for (const gr of result.gemResults) {
    const bonusReqs = bonusTable.get(gr.gemId) ?? [];
    const assignments = result.gemAssignments.get(gr.slotName) ?? [];
    const gemStarRating = mgStarMap.get(gr.slotName) ?? 5;
    const gemActiveStars = mgActiveStarsMap.get(gr.slotName) ?? gemStarRating;
    const socketTypeMap = SOCKET_STAR_TYPE[gemStarRating];

    const sockets: SocketResponse[] = [];
    for (let s = 0; s < MAX_SOCKETS[gemStarRating]; s++) {
      const bonusGemId = s < bonusReqs.length ? bonusReqs[s] : null;
      const starType = socketTypeMap[s];

      if (s >= gr.socketsUnlocked) {
        sockets.push({
          socket_index: s + 1,
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

      const assignment = assignments.find((a) => a.socketIndex === s) ?? null;
      if (assignment === null || assignment.gem === null) {
        sockets.push({
          socket_index: s + 1,
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
        const sockRes = computeSocketResonanceBonus(gem.starRating, gem.activeStars, gem.rank);
        sockets.push({
          socket_index: s + 1,
          socket_star_type: starType,
          status: 'assigned',
          assigned_gem_id: gem.gemId,
          assigned_gem_star_rating: gem.starRating,
          assigned_gem_rank: gem.rank,
          assigned_gem_active_stars: gem.activeStars,
          contribution: assignment.contribution,
          bonus_gem_required_id: bonusGemId,
          bonus_activated: assignment.bonusActivated,
          socket_resonance: sockRes,
        });
      }
    }

    slotMap.set(gr.slotName, {
      gem_id: gr.gemId,
      star_rating: gemStarRating,
      active_stars: gemActiveStars,
      target_rank: gr.targetRank,
      sockets_unlocked: gr.socketsUnlocked,
      required_power: gr.requiredPower,
      total_socketed_power: gr.totalSocketedPower,
      residual_cost: gr.residualCost,
      bonuses_activated: gr.bonusesActivated,
      bonuses_possible: gr.bonusesPossible,
      base_resonance: gr.baseResonance,
      socket_resonance_bonus: gr.socketResonanceBonus,
      total_resonance: gr.totalResonance,
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
    const bl = upgradeResult.baseline;
    const blResidual = bl.totalResidualCost;
    const blD = bl.totalDormantPower;
    const blEffectiveAvailable = bl.availablePower + blD;
    const blFeasible = blResidual <= blEffectiveAvailable;
    const baselineSummary: SummaryResponse = {
      total_socketed_power: bl.totalSocketedPower,
      total_required_power: bl.totalRequiredPower,
      total_residual_cost: blResidual,
      available_power: bl.availablePower,
      status: blFeasible ? 'feasible' : 'shortfall',
      surplus_or_shortfall: blEffectiveAvailable - blResidual,
      skipped_slots: bl.skippedSlots,
      total_resonance: bl.totalResonance,
      dormant_gem_power: blD,
      newly_dormant_gem_power: blD,
    };
    const upgradesApplied: UpgradeItem[] = upgradeResult.upgradesApplied.map((d) => ({
      upgrade_type: d.upgradeType,
      gem_id: d.gemId,
      star_rating: d.starRating,
      current_rank: d.currentRank,
      target_rank: d.targetRank,
      gem_power_cost: d.additionalGemPower,
      socketed_power_gain: d.additionalSocketPower,
      net_gain: d.netGain,
      copies_sacrificed: d.copiesSacrificed,
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
  // unassigned copies (inventory index == copy_id here, since converters
  // always builds InventoryGem with quantity=1 -- one entry per copy).
  const assignedIds = new Set<number>();
  for (const assignments of result.gemAssignments.values()) {
    for (const a of assignments) {
      if (a.copyId >= 0) assignedIds.add(a.copyId);
    }
  }
  const remainingInventory: RemainingInventoryItem[] = [];
  // (gemId, star, rank, active) -> [gp per copy]. Map, not object, since
  // dormant_gems array order is directly observable in the response.
  const dormantMap = new Map<string, number[]>();
  const dormantIdentity = new Map<string, { gemId: number; starRating: number; rank: string; activeStars: number }>();
  inventory.forEach((gem, i) => {
    if (assignedIds.has(i)) return;
    remainingInventory.push({
      gem_id: gem.gemId,
      star_rating: gem.starRating,
      rank: gem.rank,
      active_stars: gem.activeStars,
      contribution: gem.contribution,
    });
    const gp = computeExtractablePower(gem.rank, COST_TABLES.get(gem.starRating)!);
    if (gp > 0) {
      const key = dormantKey(gem.gemId, gem.starRating, gem.rank, gem.activeStars);
      const list = dormantMap.get(key);
      if (list) list.push(gp);
      else {
        dormantMap.set(key, [gp]);
        dormantIdentity.set(key, { gemId: gem.gemId, starRating: gem.starRating, rank: gem.rank, activeStars: gem.activeStars });
      }
    }
  });

  let totalDormantPower = 0;
  for (const gplist of dormantMap.values()) for (const gp of gplist) totalDormantPower += gp;

  // Split each key's unassigned copies into "already dormant on input" and
  // "newly" dormant, consuming already-dormant highest-GP-first.
  const dormantGems: DormantGemItem[] = [];
  let totalNewlyDormantPower = 0;
  for (const [key, gplist] of dormantMap) {
    const identity = dormantIdentity.get(key)!;
    const gplistSorted = [...gplist].sort((a, b) => b - a);
    const alreadyCount = Math.min(alreadyDormant.get(key) ?? 0, gplistSorted.length);
    const newlyGp = gplistSorted.slice(alreadyCount);
    const newlySum = newlyGp.reduce((s, gp) => s + gp, 0);
    totalNewlyDormantPower += newlySum;
    dormantGems.push({
      gem_id: identity.gemId,
      star_rating: identity.starRating,
      rank: identity.rank,
      active_stars: identity.activeStars,
      quantity: newlyGp.length,
      gem_power_gained: newlySum,
      already_dormant_quantity: alreadyCount,
    });
  }

  const D = totalDormantPower;
  const effectiveAvailable = result.availablePower + D;
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
    dormant_gem_power: D,
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
