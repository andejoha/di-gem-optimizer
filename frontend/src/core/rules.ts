/**
 * Domain rules for the gem resonance optimizer.
 *
 * Ported from backend/app/core/rules.py. Pure functions encoding game
 * mechanics: gem power contribution formulas, socket unlock schedules, and
 * resonance calculations.
 */

import { BASE_POWER, SOCKET_UNLOCK_RANK } from './constants';
import { RESONANCE_1STAR, RESONANCE_2STAR, RESONANCE_5STAR } from './data';
import type { MainGem, SocketAssignment, UpgradeCostEntry } from './models';

/**
 * Returns how many awakening sockets are unlocked at the given target rank.
 *
 * Sub-rank decimals (e.g. "4.3") are truncated to their major rank because
 * sub-ranks do not unlock additional sockets. Mirrors Python's
 * `int(float(rank_str))`, including its "unparseable -> 0" fallback (Python
 * catches ValueError/TypeError; here `Number.parseFloat` returns NaN, which
 * we check for explicitly since NaN comparisons are always false in JS,
 * making every socket appear locked -- the same net effect Python's `0`
 * return produces via `major >= unlock_rank` never being true, but made
 * explicit here since the loop below never actually runs for NaN).
 */
export function numSocketsUnlocked(rankStr: string, starRating: number = 5): number {
  const parsed = Number.parseFloat(rankStr);
  if (Number.isNaN(parsed)) return 0;
  const major = Math.trunc(parsed);
  const unlockRanks = SOCKET_UNLOCK_RANK[starRating];
  let count = 0;
  for (const unlockRank of Object.values(unlockRanks)) {
    if (major >= unlockRank) count++;
  }
  return count;
}

/** Returns whether a specific socket index is unlocked at the given rank. */
export function isSocketUnlocked(socketIdx: number, rankStr: string, starRating: number = 5): boolean {
  return socketIdx < numSocketsUnlocked(rankStr, starRating);
}

/**
 * Returns the GP recovered when a gem at `rank` is made dormant: the
 * cumulative gem power spent upgrading it (`requiredGemPower`), not the gem
 * copies consumed as fodder. Rank-1 gems have `requiredGemPower === 0`.
 */
export function computeExtractablePower(rank: string, costTable: ReadonlyMap<string, UpgradeCostEntry>): number {
  return costTable.get(rank)?.requiredGemPower ?? 0;
}

/**
 * Computes the total gem power a socketed gem contributes:
 *   contribution = requiredGems * BASE_POWER[starRating] + requiredGemPower
 *
 * Throws if `rank` is not found in `costTable` (mirrors Python's ValueError,
 * including the same sorted-valid-ranks message used in the 422 detail).
 */
export function computeContribution(
  starRating: number,
  rank: string,
  costTable: ReadonlyMap<string, UpgradeCostEntry>,
): number {
  const entry = costTable.get(rank);
  if (entry === undefined) {
    const valid = [...costTable.keys()].sort();
    throw new Error(`Rank '${rank}' not found in upgrade cost table. Available ranks: [${valid.map((r) => `'${r}'`).join(', ')}]`);
  }
  const base = BASE_POWER[starRating];
  return entry.requiredGems * base + entry.requiredGemPower;
}

/** Returns the base resonance of an equipped gem at the given rank, or 0 if the rank is not found. */
export function computeBaseResonance(rank: string, activeStars: number, starRating: number = 5): number {
  if (starRating === 1) return RESONANCE_1STAR.get(rank) ?? 0;
  if (starRating === 2) return RESONANCE_2STAR.get(rank) ?? 0;
  const rankEntry = RESONANCE_5STAR.get(rank);
  if (rankEntry === undefined) return 0;
  return rankEntry[activeStars] ?? 0;
}

/**
 * Returns the resonance bonus a socketed gem provides to its host gem:
 *   - 1-star gem: 1 x integerRank
 *   - 2-star gem: 2 x integerRank
 *   - 5-star gem with 2, 3, or 4 active stars: 10 x integerRank
 *   - 5-star gem with 5 active stars: 11 x integerRank
 */
export function computeSocketResonanceBonus(starRating: number, activeStars: number, rank: string): number {
  const integerRank = Math.trunc(Number.parseFloat(rank));
  if (starRating === 1) return 1 * integerRank;
  if (starRating === 2) return 2 * integerRank;
  if (activeStars === 5) return 11 * integerRank;
  return 10 * integerRank;
}

/** Computes resonance components for one main gem slot: [baseResonance, socketBonus, totalResonance]. */
export function computeSlotResonance(
  mainGem: MainGem,
  assignments: readonly SocketAssignment[],
): [base: number, socketBonus: number, total: number] {
  const base = computeBaseResonance(mainGem.targetRank, mainGem.activeStars, mainGem.starRating);
  let socketBonus = 0;
  for (const a of assignments) {
    if (a.gem !== null) {
      const bonus = computeSocketResonanceBonus(a.gem.starRating, a.gem.activeStars, a.gem.rank);
      a.socketResonance = bonus;
      socketBonus += bonus;
    }
  }
  return [base, socketBonus, base + socketBonus];
}
