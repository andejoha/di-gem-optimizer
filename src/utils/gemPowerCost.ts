/**
 * Gem power upgrade cost lookups for all star ratings, reading directly
 * from core/data.ts, the single source of truth shared with the optimizer.
 */

import { COST_TABLES } from '../core/data';
import type { InventoryGemStack } from '../types/inventory';

/**
 * Returns the cumulative gem power required to reach a given rank from rank 0.
 * Rank "1" is always 0 gem power (the base rank is free), so this equals the
 * upgrade cost from rank 1 to the given rank.
 */
export function requiredGemPower(starRating: number, rank: string): number {
  return COST_TABLES.get(starRating)?.get(rank)?.requiredGemPower ?? 0;
}

/**
 * Returns the total gem power a stack contributes to the pool when dormant.
 * Equals 0 for active stacks.
 */
export function dormantContribution(stack: Pick<InventoryGemStack, 'dormant' | 'quantity' | 'star_rating' | 'rank'>): number {
  if (!stack.dormant) return 0;
  return stack.quantity * requiredGemPower(stack.star_rating, stack.rank);
}
