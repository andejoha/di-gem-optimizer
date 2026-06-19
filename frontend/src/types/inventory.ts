import type { StarRating, InventoryItem, RemainingInventoryItem } from './api';

export interface InventoryGemStack {
  id: string;
  gem_id: number;
  star_rating: StarRating;
  rank: string;
  active_stars: number;
  quantity: number;
  dormant?: boolean;
}

export function inventoryStackKey(item: Pick<InventoryGemStack, 'gem_id' | 'rank' | 'active_stars' | 'dormant'>): string {
  return `${item.gem_id}|${item.rank}|${item.active_stars}|${item.dormant ? 1 : 0}`;
}

export function stacksToInventoryItems(stacks: InventoryGemStack[]): InventoryItem[] {
  return stacks
    .filter((stack) => !stack.dormant)
    .flatMap((stack) =>
      Array.from({ length: stack.quantity }, () => ({
        gem_id: stack.gem_id,
        rank: stack.rank,
        active_stars: stack.active_stars,
      }))
    );
}

export function remainingItemsToStacks(items: RemainingInventoryItem[]): InventoryGemStack[] {
  const map = new Map<string, InventoryGemStack>();
  for (const item of items) {
    const key = inventoryStackKey(item);
    const existing = map.get(key);
    if (existing) {
      existing.quantity += 1;
    } else {
      map.set(key, {
        id: key,
        gem_id: item.gem_id,
        star_rating: item.star_rating as StarRating,
        rank: item.rank,
        active_stars: item.active_stars,
        quantity: 1,
      });
    }
  }
  return Array.from(map.values());
}
