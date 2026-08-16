/**
 * Composite string keys for Maps that need to be keyed by more than one
 * value (a gem id plus a star rating, for example) -- JS Map/Set key
 * arrays by reference identity, not by value, so a tuple can't be used
 * directly as a key.
 *
 * Rank strings contain "." but never "|", so "|"-joined encodings are
 * unambiguous.
 */

/** Key for maps keyed by (gemId, starRating) -- e.g. the gem-type groups in `buildUpgradeChains`. */
export function gemTypeKey(gemId: number, starRating: number): string {
  return `${gemId}|${starRating}`;
}

/** Key for maps keyed by (gemId, starRating, rank) -- e.g. the socketed-gem counts in `filterUpgradesToSocketed`. */
export function gemRankKey(gemId: number, starRating: number, rank: string): string {
  return `${gemId}|${starRating}|${rank}`;
}

/** Counter-style lookup: returns 0 for a missing key instead of undefined. */
export function countOf<K>(counter: ReadonlyMap<K, number>, key: K): number {
  return counter.get(key) ?? 0;
}

/** Increments a counter Map in place, creating the entry if absent. */
export function increment<K>(counter: Map<K, number>, key: K, by = 1): void {
  counter.set(key, countOf(counter, key) + by);
}
