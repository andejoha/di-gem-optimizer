// Max sub-rank per star rating and main rank, derived from backend upgrade cost tables.
const MAX_SUB_RANK: Partial<Record<number, Partial<Record<number, number>>>> = {
  2: { 4: 1,  5: 4,  6: 4,  7: 5,  8: 8,  9: 11 },
  5: { 4: 4,  5: 5,  6: 11, 7: 11, 8: 17, 9: 17 },
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
