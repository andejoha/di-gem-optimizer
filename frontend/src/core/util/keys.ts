/**
 * Composite key encoders for values that are tuple-keyed dicts / sets of
 * tuples / Counters in the Python source (dict[tuple[int,int], ...],
 * Counter[tuple[int,int,str]], frozenset[tuple[...]], etc). JS Map/Set key
 * on reference identity for arrays, so every such structure is ported as a
 * Map/Set keyed by one of these string encodings instead.
 *
 * Rank strings contain "." but never "|", so "|"-joined encodings are
 * unambiguous.
 */

/** Key for maps keyed by (gemId, starRating) -- e.g. upgrades.build_upgrade_chains's `groups`. */
export function gemTypeKey(gemId: number, starRating: number): string {
  return `${gemId}|${starRating}`;
}

/** Key for maps keyed by (gemId, starRating, rank) -- e.g. filter_upgrades_to_socketed's `needed` Counter. */
export function gemRankKey(gemId: number, starRating: number, rank: string): string {
  return `${gemId}|${starRating}|${rank}`;
}

/** Counter-style lookup: returns 0 for a missing key, matching Python's `Counter.__getitem__`. */
export function countOf<K>(counter: ReadonlyMap<K, number>, key: K): number {
  return counter.get(key) ?? 0;
}

/** Increments a Counter-style Map in place, creating the entry if absent. */
export function increment<K>(counter: Map<K, number>, key: K, by = 1): void {
  counter.set(key, countOf(counter, key) + by);
}

/** Map.get with a Python-dict-style default, without the pitfalls of `||` on legitimately-zero/false values. */
export function getOr<K, V>(map: ReadonlyMap<K, V>, key: K, fallback: V): V {
  return map.has(key) ? (map.get(key) as V) : fallback;
}
