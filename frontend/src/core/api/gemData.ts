/**
 * Ported from backend/app/api/routes.py `gem_data()`. Returns all known
 * gems with their socket bonus requirements, computed once at module load.
 *
 * Iterates GEMS in GEM_LIST order (5-star, then 2-star, then 1-star) --
 * NOT ascending by id -- matching the Python `GEMS.values()` order exactly.
 */

import { SOCKET_UNLOCK_RANK } from '../constants';
import { GEMS } from '../data';
import type { BonusSocket, GemInfo } from './types';

function buildGemInfo(): GemInfo[] {
  const gems: GemInfo[] = [];
  for (const g of GEMS.values()) {
    const unlockRanks = SOCKET_UNLOCK_RANK[g.starRating];
    const bonusSockets: BonusSocket[] = [];
    g.bonusGemIds.forEach((reqId, i) => {
      if (reqId) bonusSockets.push({ unlock_rank: unlockRanks[i], required_gem_id: reqId });
    });
    gems.push({ id: g.id, name: g.name, star_rating: g.starRating as 1 | 2 | 5, bonus_gems: bonusSockets });
  }
  return gems;
}

/** All known gems with their socket bonus requirements, in GEMS order. */
export const GEM_INFO: GemInfo[] = buildGemInfo();
