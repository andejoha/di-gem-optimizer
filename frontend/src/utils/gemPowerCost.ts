/**
 * Gem Power upgrade cost tables for all star ratings.
 *
 * Values are the cumulative Gem Power required to reach the given rank from rank 0.
 * Source of truth: backend/app/core/data.py (COST_1STAR, COST_2STAR, COST_5STAR).
 * Keep in sync with the backend if the game is patched with new rank tiers.
 */

import type { InventoryGemStack } from '../types/inventory';

const GP_1STAR: Record<string, number> = {
  '0':   0,
  '1':   0,
  '2':   1,
  '3':   6,
  '4':  16,
  '5':  31,
  '6':  51,
  '7':  76,
  '8': 106,
  '9': 146,
  '10': 196,
};

const GP_2STAR: Record<string, number> = {
  '0':      0,
  '1':      0,
  '2':      5,
  '3':     20,
  '4':     45,
  '4.1':   55,
  '5':     65,
  '5.1':   80,
  '5.2':   95,
  '5.3':  110,
  '5.4':  125,
  '6':    150,
  '6.1':  165,
  '6.2':  180,
  '6.3':  195,
  '6.4':  210,
  '7':    235,
  '7.1':  250,
  '7.2':  265,
  '7.3':  280,
  '7.4':  295,
  '7.5':  310,
  '8':    340,
  '8.1':  355,
  '8.2':  370,
  '8.3':  385,
  '8.4':  400,
  '8.5':  415,
  '8.6':  430,
  '8.7':  445,
  '8.8':  460,
  '9':    490,
  '9.1':  505,
  '9.2':  520,
  '9.3':  535,
  '9.4':  550,
  '9.5':  565,
  '9.6':  580,
  '9.7':  595,
  '9.8':  610,
  '9.9':  625,
  '9.10': 640,
  '9.11': 655,
  '10':   685,
};

const GP_5STAR: Record<string, number> = {
  '0':      0,
  '1':      0,
  '2':     50,
  '3':    125,
  '4':    225,
  '4.1':  275,
  '4.2':  325,
  '4.3':  375,
  '4.4':  425,
  '5':    475,
  '5.1':  535,
  '5.2':  595,
  '5.3':  655,
  '5.4':  715,
  '5.5':  775,
  '6':    850,
  '6.1':  910,
  '6.2':  970,
  '6.3':  1030,
  '6.4':  1090,
  '6.5':  1150,
  '6.6':  1210,
  '6.7':  1270,
  '6.8':  1330,
  '6.9':  1390,
  '6.10': 1450,
  '6.11': 1510,
  '7':    1575,
  '7.1':  1635,
  '7.2':  1695,
  '7.3':  1755,
  '7.4':  1815,
  '7.5':  1875,
  '7.6':  1935,
  '7.7':  1995,
  '7.8':  2055,
  '7.9':  2115,
  '7.10': 2175,
  '7.11': 2235,
  '8':    2300,
  '8.1':  2360,
  '8.2':  2420,
  '8.3':  2480,
  '8.4':  2540,
  '8.5':  2600,
  '8.6':  2660,
  '8.7':  2720,
  '8.8':  2780,
  '8.9':  2840,
  '8.10': 2900,
  '8.11': 2960,
  '8.12': 3020,
  '8.13': 3080,
  '8.14': 3140,
  '8.15': 3200,
  '8.16': 3260,
  '8.17': 3320,
  '9':    3375,
  '9.1':  3435,
  '9.2':  3495,
  '9.3':  3555,
  '9.4':  3615,
  '9.5':  3675,
  '9.6':  3735,
  '9.7':  3795,
  '9.8':  3855,
  '9.9':  3915,
  '9.10': 3975,
  '9.11': 4035,
  '9.12': 4095,
  '9.13': 4155,
  '9.14': 4215,
  '9.15': 4275,
  '9.16': 4335,
  '9.17': 4395,
  '10':   4450,
};

/**
 * Returns the cumulative Gem Power required to reach a given rank from rank 0.
 * Rank "1" is always 0 GP (the base rank is free), so this equals the upgrade cost
 * from rank 1 to the given rank.
 */
export function requiredGemPower(starRating: number, rank: string): number {
  const table = starRating === 5 ? GP_5STAR : starRating === 1 ? GP_1STAR : GP_2STAR;
  return table[rank] ?? 0;
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
