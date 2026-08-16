import type { InventoryGem } from '../models';

/**
 * Copies a gem record. `InventoryGem` is a flat, scalar-only record, so a
 * shallow copy is sufficient -- there is no nested mutable structure to
 * worry about. `buildUpgradeChains` and `materializeUpgrades` rely on
 * gems being replaced wholesale in these lists rather than mutated in
 * place; if that ever changes, this function needs a matching change.
 */
export function cloneGem(gem: InventoryGem): InventoryGem {
  return { ...gem };
}

export function cloneGems(gems: readonly InventoryGem[]): InventoryGem[] {
  return gems.map(cloneGem);
}
