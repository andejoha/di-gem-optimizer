"""Telluric Fragments shop analysis for the gem resonance optimizer.

Provides constants, data structures, and candidate filtering for the greedy
shop search that recommends profitable gem purchases using Telluric Fragments.
The greedy loop itself lives in routes.py to avoid circular imports.
"""

from dataclasses import dataclass

from app.core.data import GEMS
from app.core.models import GemDef, InventoryGem

# Telluric Fragment cost per star rating.
TF_COST: dict[int, int] = {1: 20, 2: 80}


@dataclass
class ShopPurchase:
    """One recommended Telluric Fragments shop purchase.

    Attributes:
        gem_id: Stable integer ID of the gem to buy.
        star_rating: Star tier of the gem (1 or 2).
        tf_cost: Telluric Fragments spent (20 for 1-star, 80 for 2-star).
        surplus_improvement: GP surplus increase gained by this purchase
            (relative to the result before this purchase was applied).
    """

    gem_id: int
    star_rating: int
    tf_cost: int
    surplus_improvement: int


def get_shop_candidates(inventory: list[InventoryGem]) -> list[GemDef]:
    """Return unique 1-star and 2-star gem definitions present in inventory.

    Only gems already in the player's inventory are candidates.  A brand-new
    gem (not in inventory) can at most improve GP surplus by BASE_POWER[star]
    when socketed, which equals the profitability threshold and is therefore
    never recommended.  Upgrade chains — the main source of above-threshold
    improvement — require same-name copies and are only possible for gems
    the player already owns.

    Args:
        inventory: The player's current socketable gem copies.

    Returns:
        Deduplicated list of GemDef objects for 1-star and 2-star gems
        present in the inventory, in stable gem-ID order.
    """
    seen: set[int] = set()
    candidates: list[GemDef] = []
    for gem in inventory:
        gem_id = gem.gem_id
        if gem_id in seen:
            continue
        gem_def = GEMS.get(gem_id)
        if gem_def is None or gem_def.star_rating not in TF_COST:
            continue
        seen.add(gem_id)
        candidates.append(gem_def)
    # Stable sort by gem_id for deterministic evaluation order.
    candidates.sort(key=lambda g: g.id)
    return candidates
