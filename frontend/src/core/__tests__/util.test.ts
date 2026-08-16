import { describe, expect, it } from 'vitest';
import { cloneGem, cloneGems } from '../util/clone';
import { countOf, gemRankKey, gemTypeKey, getOr, increment } from '../util/keys';
import { permutations } from '../util/permutations';
import { cmpTuple } from '../util/tupleCompare';

describe('cmpTuple', () => {
  it('compares numeric tuples lexicographically', () => {
    expect(cmpTuple([1, 2], [1, 3])).toBeLessThan(0);
    expect(cmpTuple([2, 1], [1, 9])).toBeGreaterThan(0);
    expect(cmpTuple([1, 2], [1, 2])).toBe(0);
  });

  it('handles mixed sign and mixed str/int positions (redistribute_for_bonuses key shape)', () => {
    // key = (bonus_gain, -new_cost, slot_a, copy_id_a, slot_b, copy_id_b)
    const a = [2, -10, 'head', 3, 'chest', 7];
    const b = [2, -5, 'head', 3, 'chest', 7];
    expect(cmpTuple(a, b)).toBeLessThan(0); // -10 < -5
  });

  it('treats -0 as equal to 0', () => {
    expect(cmpTuple([-0], [0])).toBe(0);
  });

  it('stable reverse=True translation: sort then negate, never sort-then-reverse', () => {
    // Two items tie on the sort key (contribution only) -- Python's
    // sorted(items, key=lambda x: (x.contribution,), reverse=True) preserves
    // their ORIGINAL relative order for ties (verified against a live
    // Python run: sorted([(10,2),(10,1),(5,3)], key=lambda x: (x[0],),
    // reverse=True) == [(10,2),(10,1),(5,3)] -- gemId 2 stays before gemId 1
    // because that was their input order, not because 2 > 1).
    // `.sort(asc).reverse()` would flip that tie to [1, 2, 3] -- wrong.
    const items = [
      { contribution: 10, gemId: 2 },
      { contribution: 10, gemId: 1 },
      { contribution: 5, gemId: 3 },
    ];
    const key = (x: (typeof items)[number]) => [x.contribution];
    const sortedDesc = items.slice().sort((x, y) => -cmpTuple(key(x), key(y)));
    expect(sortedDesc.map((x) => x.gemId)).toEqual([2, 1, 3]);

    const wrongViaReverse = items
      .slice()
      .sort((x, y) => cmpTuple(key(x), key(y)))
      .reverse();
    expect(wrongViaReverse.map((x) => x.gemId)).toEqual([1, 2, 3]); // flips the tie -- demonstrates the pitfall
  });
});

describe('permutations', () => {
  it('matches itertools.permutations generation order (verified against a live Python run)', () => {
    const result = [...permutations(['a', 'b', 'c'])];
    expect(result).toEqual([
      ['a', 'b', 'c'],
      ['a', 'c', 'b'],
      ['b', 'a', 'c'],
      ['b', 'c', 'a'],
      ['c', 'a', 'b'],
      ['c', 'b', 'a'],
    ]);
  });

  it('yields the identity permutation first (ties favor the pre-existing ordering)', () => {
    const [first] = permutations([1, 2, 3, 4, 5]);
    expect(first).toEqual([1, 2, 3, 4, 5]);
  });

  it('handles n=0 and n=1', () => {
    expect([...permutations([])]).toEqual([[]]);
    expect([...permutations(['x'])]).toEqual([['x']]);
  });
});

describe('key/counter helpers', () => {
  it('gemTypeKey and gemRankKey are unambiguous despite "." in rank strings', () => {
    expect(gemTypeKey(5001, 5)).toBe('5001|5');
    expect(gemRankKey(5001, 5, '4.1')).not.toBe(gemRankKey(5001, 5, '41'));
  });

  it('countOf returns 0 for a missing key (Counter semantics)', () => {
    const counter = new Map<string, number>();
    expect(countOf(counter, 'x')).toBe(0);
    increment(counter, 'x');
    increment(counter, 'x', 2);
    expect(countOf(counter, 'x')).toBe(3);
  });

  it('getOr distinguishes a legitimate 0/false value from "missing"', () => {
    const map = new Map([['a', 0]]);
    expect(getOr(map, 'a', 99)).toBe(0);
    expect(getOr(map, 'b', 99)).toBe(99);
  });
});

describe('clone helpers', () => {
  it('cloneGem produces an equal but distinct object', () => {
    const gem = { gemId: 1, starRating: 2, rank: '5', quantity: 1, activeStars: 2, contribution: 10 };
    const cloned = cloneGem(gem);
    expect(cloned).toEqual(gem);
    expect(cloned).not.toBe(gem);
  });

  it('cloneGems produces a new array of new objects', () => {
    const gems = [{ gemId: 1, starRating: 2, rank: '5', quantity: 1, activeStars: 2, contribution: 10 }];
    const cloned = cloneGems(gems);
    expect(cloned).toEqual(gems);
    expect(cloned).not.toBe(gems);
    expect(cloned[0]).not.toBe(gems[0]);
  });
});
