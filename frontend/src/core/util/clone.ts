import type { InventoryGem } from '../models';

/**
 * Replaces Python's `copy.deepcopy` for InventoryGem lists throughout
 * upgrades.py and routes.py. Every deep-copied value in the Python source is
 * a flat, scalar-only InventoryGem record -- there is no nested mutable
 * structure to worry about -- so a shallow spread is a correct, exact
 * replacement and is 5-10x faster than `structuredClone`. This matters
 * because `materialize_upgrades`/`build_upgrade_chains` snapshot the
 * sub-inventory on every step of the upgrade walk.
 *
 * Invariant this relies on (see upgrades.py comment at the equivalent
 * snapshot site): gems are always replaced wholesale in these lists, never
 * mutated in place after being cloned. If that invariant is ever violated,
 * cloneGem must be revisited.
 */
export function cloneGem(gem: InventoryGem): InventoryGem {
  return { ...gem };
}

export function cloneGems(gems: readonly InventoryGem[]): InventoryGem[] {
  return gems.map(cloneGem);
}
