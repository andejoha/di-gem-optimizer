import type { GemInfo, GemSetup } from '../types/api';
import type { InventoryGemStack } from '../types/inventory';
import { encodeSetup, generateId, type CodecState } from './setupCodec';
import { SLOT_ORDER } from './gearAssets';
import { requiredGemPower } from './gemPowerCost';

function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function generateExampleSetups(gems: GemInfo[]): { random: string; max: string } {
  const fiveStars = gems.filter((g) => g.star_rating === 5);
  const twoStars = gems.filter((g) => g.star_rating === 2);
  const oneStars = gems.filter((g) => g.star_rating === 1);

  // --- Random setup ---
  const shuffled5 = shuffle(fiveStars);
  const shuffled2 = shuffle(twoStars);
  const shuffled1 = shuffle(oneStars);

  const mainFiveStars = shuffled5.slice(0, 6);
  const mainTwoStars = shuffled2.slice(0, 2);

  const randomGemSetup: GemSetup = {};
  SLOT_ORDER.slice(0, 6).forEach((slot, i) => {
    randomGemSetup[slot] = {
      gem_id: mainFiveStars[i].id,
      target_rank: String(randInt(4, 10)),
      active_stars: randInt(2, 5),
    };
  });
  [SLOT_ORDER[6], SLOT_ORDER[7]].forEach((slot, i) => {
    randomGemSetup[slot] = {
      gem_id: mainTwoStars[i].id,
      target_rank: String(randInt(4, 10)),
      active_stars: 2,
    };
  });

  const mainGemIds = new Set([...mainFiveStars, ...mainTwoStars].map((g) => g.id));

  const invFiveStars = shuffled5.filter((g) => !mainGemIds.has(g.id)).slice(0, 5);
  const invTwoStars = shuffled2.filter((g) => !mainGemIds.has(g.id)).slice(0, mainFiveStars.length * 3);
  const invOneStars = shuffled1.slice(0, 5);

  const stacks: InventoryGemStack[] = [];

  for (const gem of invFiveStars) {
    stacks.push({
      id: generateId(),
      gem_id: gem.id,
      star_rating: gem.star_rating,
      rank: String(randInt(1, 4)),
      active_stars: randInt(2, 5),
      quantity: randInt(1, 5),
    });
  }
  for (const gem of invTwoStars) {
    stacks.push({
      id: generateId(),
      gem_id: gem.id,
      star_rating: gem.star_rating,
      rank: String(randInt(1, 6)),
      active_stars: 2,
      quantity: randInt(1, 5),
    });
  }
  for (const gem of invOneStars) {
    stacks.push({
      id: generateId(),
      gem_id: gem.id,
      star_rating: gem.star_rating,
      rank: String(randInt(1, 7)),
      active_stars: 1,
      quantity: randInt(1, 5),
    });
  }

  // Fill remaining 1-star gems at R1 until we have at least 20 total R1 1-star copies
  let r1Total = stacks.filter((s) => s.star_rating === 1 && s.rank === '1').reduce((sum, s) => sum + s.quantity, 0);

  const invOneStarIds = new Set(invOneStars.map((g) => g.id));
  for (const gem of shuffled1.filter((g) => !invOneStarIds.has(g.id))) {
    if (r1Total >= 20) break;
    const qty = Math.min(randInt(1, 5), 20 - r1Total);
    stacks.push({
      id: generateId(),
      gem_id: gem.id,
      star_rating: gem.star_rating,
      rank: '1',
      active_stars: 1,
      quantity: qty,
    });
    r1Total += qty;
  }

  // Gem power: exact cost of all 8 main gems at their selected ranks.
  const gemPower = SLOT_ORDER.reduce((sum, slot, i) => {
    const item = randomGemSetup[slot];
    return sum + (item ? requiredGemPower(i < 6 ? 5 : 2, item.target_rank) : 0);
  }, 0);

  const randomState: CodecState = { gemSetup: randomGemSetup, gemPower, stacks };

  // --- Max setup ---
  const maxMain = shuffle(fiveStars).slice(0, 8);

  const maxGemSetup: GemSetup = {};
  SLOT_ORDER.forEach((slot, i) => {
    maxGemSetup[slot] = { gem_id: maxMain[i].id, target_rank: '10', active_stars: 5 };
  });

  const maxStacks: InventoryGemStack[] = gems.map((gem) => ({
    id: generateId(),
    gem_id: gem.id,
    star_rating: gem.star_rating,
    rank: '10',
    active_stars: gem.star_rating,
    quantity: 10,
  }));

  const maxState: CodecState = { gemSetup: maxGemSetup, gemPower: 10000, stacks: maxStacks };

  return { random: encodeSetup(randomState), max: encodeSetup(maxState) };
}
