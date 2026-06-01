"""Verify the potential-based baseline eligibility selection."""
from app.core.models import InventoryGem
from app.core.upgrades import _select_high_potential_types


def _gem(gem_id: int, star: int, rank: str = "1") -> InventoryGem:
    return InventoryGem(gem_id=gem_id, star_rating=star, rank=rank, quantity=1, active_stars=0, contribution=0)


def test_picks_highest_potential_2star():
    """User's reported scenario: Crucible (12 copies) beats Abiding Curse (3 copies)."""
    crucible_id, abiding_id = 100, 200
    inventory = (
        [_gem(crucible_id, 2) for _ in range(12)]
        + [_gem(abiding_id, 2) for _ in range(3)]
    )
    eligible = _select_high_potential_types(inventory, frozenset({2}))
    assert eligible == frozenset({(crucible_id, 2)})


def test_skips_singletons():
    """Gem types with only 1 copy can't be upgraded — should be excluded."""
    inventory = [_gem(100, 2), _gem(200, 2), _gem(300, 2)]
    assert _select_high_potential_types(inventory, frozenset({2})) == frozenset()


def test_picks_one_per_star_rating():
    """When 2-star and 5-star both socketable, pick top-1 of each independently."""
    inventory = (
        [_gem(100, 2) for _ in range(5)]
        + [_gem(200, 2) for _ in range(2)]
        + [_gem(300, 5) for _ in range(3)]
        + [_gem(400, 5) for _ in range(2)]
    )
    eligible = _select_high_potential_types(inventory, frozenset({2, 5}))
    assert eligible == frozenset({(100, 2), (300, 5)})


def test_5star_excluded_when_not_socketable():
    """If only 2-star sockets are available, 5-star gems are ignored."""
    inventory = (
        [_gem(100, 2) for _ in range(3)]
        + [_gem(300, 5) for _ in range(10)]
    )
    eligible = _select_high_potential_types(inventory, frozenset({2}))
    assert eligible == frozenset({(100, 2)})


def test_tie_breaks_on_lower_gem_id():
    """Equal potential -> lower gem_id wins for reproducibility."""
    inventory = [_gem(200, 2) for _ in range(4)] + [_gem(100, 2) for _ in range(4)]
    assert _select_high_potential_types(inventory, frozenset({2})) == frozenset({(100, 2)})


def test_all_ranks_count_toward_potential():
    """Copies at any rank (R1, R3, R5) all contribute to the count."""
    crucible_id = 100
    inventory = (
        [_gem(crucible_id, 2, "1") for _ in range(8)]
        + [_gem(crucible_id, 2, "3") for _ in range(2)]
        + [_gem(crucible_id, 2, "5") for _ in range(2)]
        + [_gem(200, 2, "1") for _ in range(11)]
    )
    eligible = _select_high_potential_types(inventory, frozenset({2}))
    assert eligible == frozenset({(crucible_id, 2)})
