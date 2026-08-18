import { describe, expect, it } from 'vitest';
import { MAX_SOCKETS, SOCKET_STAR_TYPE } from '../../src/core/constants';
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
} from '../../src/core/data';

describe('GEMS ordering (critical hazard: GEMS is NOT in ascending ID order)', () => {
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
});

describe('bonusGemIds catalog invariants (premise for optimizer.ts assignSockets)', () => {
  it('every gem def has exactly one requirement per socket, none absent', () => {
    for (const gem of GEM_LIST) {
      expect(gem.bonusGemIds.length, `gem ${gem.id}`).toBe(MAX_SOCKETS[gem.starRating]);
      expect(
        gem.bonusGemIds.every((id) => id !== 0),
        `gem ${gem.id} has an absent requirement`,
      ).toBe(true);
    }
  });

  it('every requirement names a known gem whose tier matches its socket tier', () => {
    const byId = new Map(GEM_LIST.map((g) => [g.id, g]));
    for (const gem of GEM_LIST) {
      const socketTypeMap = SOCKET_STAR_TYPE[gem.starRating];
      gem.bonusGemIds.forEach((requiredId, socketIndex) => {
        const required = byId.get(requiredId);
        expect(required, `gem ${gem.id} socket ${socketIndex} requires unknown gem ${requiredId}`).toBeDefined();
        expect(required!.starRating, `gem ${gem.id} socket ${socketIndex}`).toBe(socketTypeMap[socketIndex]);
      });
    }
  });

  it('no two sockets of the same star-type group on one main gem require the same gem', () => {
    // This is the premise that makes assignSockets' greedy matching optimal:
    // each copy can satisfy at most one socket's requirement per group.
    for (const gem of GEM_LIST) {
      const socketTypeMap = SOCKET_STAR_TYPE[gem.starRating];
      const byStarType = new Map<number, number[]>();
      gem.bonusGemIds.forEach((requiredId, socketIndex) => {
        const starType = socketTypeMap[socketIndex];
        const list = byStarType.get(starType);
        if (list) list.push(requiredId);
        else byStarType.set(starType, [requiredId]);
      });
      for (const [starType, requirements] of byStarType) {
        expect(new Set(requirements).size, `gem ${gem.id} star-type group ${starType}`).toBe(requirements.length);
      }
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
