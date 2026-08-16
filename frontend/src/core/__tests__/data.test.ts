import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COST_1STAR,
  COST_2STAR,
  COST_5STAR,
  COST_TABLES,
  GEM_LIST,
  GEMS,
  RESONANCE_1STAR,
  RESONANCE_2STAR,
  RESONANCE_5STAR,
} from '../data';

const GOLDEN_DIR = fileURLToPath(new URL('../../../../golden', import.meta.url));

function loadGoldenGemData(): Array<{ id: number; name: string; star_rating: number; bonus_gems: unknown[] }> {
  return JSON.parse(readFileSync(`${GOLDEN_DIR}/gem-data.json`, 'utf-8'));
}

describe('GEMS ordering (critical hazard: GEMS is NOT in ascending ID order)', () => {
  it('GEM_LIST id order matches golden/gem-data.json exactly (5-star, then 2-star, then 1-star)', () => {
    const golden = loadGoldenGemData();
    expect(GEM_LIST.map((g) => g.id)).toEqual(golden.map((g) => g.id));
  });

  it('is NOT in ascending numeric order (guards against accidentally "fixing" it into a Record)', () => {
    const ids = GEM_LIST.map((g) => g.id);
    const ascending = [...ids].sort((a, b) => a - b);
    expect(ids).not.toEqual(ascending);
  });

  it('GEMS Map preserves GEM_LIST insertion order', () => {
    expect([...GEMS.keys()]).toEqual(GEM_LIST.map((g) => g.id));
  });

  it('has 92 gems: 28 five-star, 34 two-star, 30 one-star', () => {
    expect(GEM_LIST.length).toBe(92);
    expect(GEM_LIST.filter((g) => g.starRating === 5).length).toBe(28);
    expect(GEM_LIST.filter((g) => g.starRating === 2).length).toBe(34);
    expect(GEM_LIST.filter((g) => g.starRating === 1).length).toBe(30);
  });

  it('every gem name and bonus list matches the golden capture', () => {
    const golden = loadGoldenGemData();
    const byId = new Map(golden.map((g) => [g.id, g]));
    for (const gem of GEM_LIST) {
      const expected = byId.get(gem.id);
      expect(expected, `gem ${gem.id} missing from golden data`).toBeDefined();
      expect(gem.name).toBe(expected!.name);
      expect(gem.starRating).toBe(expected!.star_rating);
      expect(gem.bonusGemIds).toEqual((expected!.bonus_gems as Array<{ required_gem_id: number }>).map((b) => b.required_gem_id));
    }
  });
});

describe('cost tables', () => {
  it('COST_1STAR has 11 ranks (0-10, no sub-ranks)', () => {
    expect(COST_1STAR.size).toBe(11);
    expect(COST_1STAR.get('10')).toEqual({ correctedRank: '10', requiredGems: 6, requiredGemPower: 196 });
  });

  it('COST_2STAR includes sub-ranks up to 9.11', () => {
    expect(COST_2STAR.get('9.11')).toEqual({ correctedRank: '9.11', requiredGems: 40, requiredGemPower: 655 });
    expect(COST_2STAR.size).toBe(44);
  });

  it('COST_5STAR includes sub-ranks up to 8.17', () => {
    expect(COST_5STAR.get('8.17')).toEqual({ correctedRank: '8.17', requiredGems: 55, requiredGemPower: 3320 });
    expect(COST_5STAR.size).toBe(76);
  });

  it('COST_TABLES resolves by star rating', () => {
    expect(COST_TABLES.get(1)).toBe(COST_1STAR);
    expect(COST_TABLES.get(2)).toBe(COST_2STAR);
    expect(COST_TABLES.get(5)).toBe(COST_5STAR);
  });
});

describe('resonance tables', () => {
  it('RESONANCE_5STAR is keyed by rank then active-star count', () => {
    expect(RESONANCE_5STAR.get('10')).toEqual({ 2: 820, 3: 860, 4: 900, 5: 1000 });
  });

  it('RESONANCE_1STAR and RESONANCE_2STAR are flat rank -> value maps', () => {
    expect(RESONANCE_1STAR.get('10')).toBe(150);
    expect(RESONANCE_2STAR.get('10')).toBe(300);
  });
});
