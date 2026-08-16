/**
 * Order-faithful port of Python's `itertools.permutations(iterable)` (full-
 * length permutations only, matching every call site in optimizer.py).
 *
 * optimizer.reorder_for_bonuses keeps the *first* strict-maximum permutation
 * it encounters, so generation order is observable and must match CPython's
 * exactly: lexicographic order of input *positions*, not Heap's algorithm or
 * any other generation scheme. CPython's `permutations` yields the identity
 * permutation first, which is what makes the pre-loop `best_ordering =
 * list(gems)` initialization redundant-but-tie-consistent with the loop
 * itself -- preserve that same "identity wins ties" behavior here.
 */
export function* permutations<T>(items: readonly T[]): Generator<T[]> {
  const n = items.length;
  const indices = Array.from({ length: n }, (_, i) => i);
  const cycles = Array.from({ length: n }, (_, i) => n - i);
  yield indices.map((i) => items[i]);
  if (n === 0) return;

  while (true) {
    let i = n - 1;
    for (; i >= 0; i--) {
      cycles[i] -= 1;
      if (cycles[i] === 0) {
        const first = indices[i];
        for (let j = i; j < n - 1; j++) indices[j] = indices[j + 1];
        indices[n - 1] = first;
        cycles[i] = n - i;
      } else {
        const j = n - cycles[i];
        [indices[i], indices[j]] = [indices[j], indices[i]];
        yield indices.map((k) => items[k]);
        break;
      }
    }
    if (i < 0) return;
  }
}
