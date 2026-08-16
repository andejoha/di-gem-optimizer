/**
 * Gem Power upgrade cost lookups for all star ratings.
 *
 * Previously duplicated the full COST_1STAR/2STAR/5STAR literal tables from
 * backend/app/core/data.py by hand ("Keep in sync with the backend"). Now
 * reads directly from core/data.ts, the single source of truth shared with
 * the optimizer itself -- there is nothing left to keep in sync.
 */

import { COST_TABLES } from '../core/data';
import type { InventoryGemStack } from '../types/inventory';

/**
 * Returns the cumulative Gem Power required to reach a given rank from rank 0.
 * Rank "1" is always 0 GP (the base rank is free), so this equals the upgrade cost
 * from rank 1 to the given rank.
 */
export function requiredGemPower(starRating: number, rank: string): number {
  return COST_TABLES.get(starRating)?.get(rank)?.requiredGemPower ?? 0;
}

/**
 * Returns the total Gem Power a stack contributes to the pool when dormant.
 * Equals 0 for active stacks.
 */
export function dormantContribution(
  stack: Pick<InventoryGemStack, 'dormant' | 'quantity' | 'star_rating' | 'rank'>,
): number {
  if (!stack.dormant) return 0;
  return stack.quantity * requiredGemPower(stack.star_rating, stack.rank);
}
