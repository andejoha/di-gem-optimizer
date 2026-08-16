import { COST_2STAR, COST_5STAR } from '../core/data';

// Max sub-rank per star rating and main rank, derived from the upgrade
// cost tables at module load.
function deriveMaxSubRank(costTable: ReadonlyMap<string, unknown>): Partial<Record<number, number>> {
  const result: Partial<Record<number, number>> = {};
  for (const rank of costTable.keys()) {
    const [mainStr, subStr] = rank.split('.');
    if (subStr === undefined) continue;
    const main = Number(mainStr);
    const sub = Number(subStr);
    result[main] = Math.max(result[main] ?? 0, sub);
  }
  return result;
}

const MAX_SUB_RANK: Partial<Record<number, Partial<Record<number, number>>>> = {
  2: deriveMaxSubRank(COST_2STAR),
  5: deriveMaxSubRank(COST_5STAR),
};

export function getMaxSubRank(starRating: number, mainRank: number): number {
  return MAX_SUB_RANK[starRating]?.[mainRank] ?? 0;
}

export function parseRank(rankStr: string): [number, number] {
  const parts = rankStr.split('.');
  return [parseInt(parts[0] ?? '1', 10), parseInt(parts[1] ?? '0', 10)];
}

/** Returns the display percentage for a sub-rank (same formula used in the dialog). */
export function subRankToPercent(subRank: number, maxSubRank: number): number {
  return subRank * Math.round(100 / (maxSubRank + 1));
}

/** Formats a target_rank string as "Rank X" or "Rank X (Y%)" */
export function formatRank(targetRank: string, starRating: number): string {
  const [main, sub] = parseRank(targetRank);
  if (sub === 0) return `Rank ${main}`;
  const maxSub = getMaxSubRank(starRating, main);
  const pct = subRankToPercent(sub, maxSub);
  return `Rank ${main} (${pct}%)`;
}
