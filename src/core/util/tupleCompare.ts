/**
 * Lexicographic comparison of two same-shaped tuples, used for multi-key
 * sort/max/min keys throughout the optimizer (e.g. the move-selection key
 * in `optimizer.ts`'s `redistributeForBonuses`).
 *
 * Elements may be numbers or strings; comparison is positional, using
 * `<`/`>` on each pair of elements in turn. `-0` compares equal to `0`.
 *
 * When sorting descending by a key that can contain ties, build the
 * comparator with a negation rather than sorting ascending and reversing
 * the result -- reversing an already-sorted array also reverses the order
 * of tied elements, which changes which one wins when a caller only keeps
 * the first match:
 *   xs.slice().sort((a, b) => -compareTuples(key(a), key(b)))
 */
export function compareTuples(a: readonly (number | string)[], b: readonly (number | string)[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i];
    const y = b[i];
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return a.length - b.length;
}
