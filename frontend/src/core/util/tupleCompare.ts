/**
 * Lexicographic tuple comparison, matching Python's tuple comparison
 * semantics used throughout the optimizer for multi-key sort/max/min keys
 * (e.g. `key = (bonus_gain, -new_cost, slot_a, copy_id_a, slot_b, copy_id_b)`
 * in optimizer.redistribute_for_bonuses).
 *
 * Elements may be numbers or strings; comparison is by `<`/`>`, matching
 * Python's numeric and code-point string ordering respectively (identical
 * to JS string ordering for the ASCII slot names and rank strings used
 * here). `-0` compares equal to `0`, matching Python's `-0 == 0`.
 *
 * IMPORTANT: when a Python call site does `sorted(xs, key=k, reverse=True)`,
 * do NOT translate as `.sort(asc).reverse()` -- Python's reverse=True is
 * stable and does not reverse the order of ties, but reversing an
 * already-sorted array does. Instead negate the comparator:
 *   xs.slice().sort((a, b) => -cmpTuple(key(a), key(b)))
 */
export function cmpTuple(a: readonly (number | string)[], b: readonly (number | string)[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i];
    const y = b[i];
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return a.length - b.length;
}
