/**
 * Returns all known gems with their socket bonus requirements, computed
 * once at module load in gem-list order (5-star, then 2-star, then
 * 1-star -- not ascending by id).
 */

import { SOCKET_UNLOCK_RANK } from '../constants';
import { GEMS } from '../data';
import type { BonusSocket, GemInfo } from './types';

function buildGemInfo(): GemInfo[] {
  const gems: GemInfo[] = [];
  for (const gemDef of GEMS.values()) {
    const unlockRanks = SOCKET_UNLOCK_RANK[gemDef.starRating];
    const bonusSockets: BonusSocket[] = [];
    gemDef.bonusGemIds.forEach((requiredGemId, socketIndex) => {
      if (requiredGemId) bonusSockets.push({ unlock_rank: unlockRanks[socketIndex], required_gem_id: requiredGemId });
    });
    gems.push({ id: gemDef.id, name: gemDef.name, star_rating: gemDef.starRating as 1 | 2 | 5, bonus_gems: bonusSockets });
  }
  return gems;
}

/** All known gems with their socket bonus requirements, in gem-list order. */
export const GEM_INFO: GemInfo[] = buildGemInfo();
