"""Tests for suppressing "make this dormant" recommendations for gems the
player already marked dormant before submitting the request.

Calls _run_optimization directly (same function the API routes use) with
hand-built OptimizeRequest payloads, since the behavior under test spans the
request schema (InventoryItem.dormant), converters.already_dormant_counter,
and domain_to_response's dormant_gems / newly_dormant_gem_power accounting.

Fixture setup: main gem 5001 (5-star) at target_rank "1" unlocks zero sockets
(see app.core.config.SOCKET_UNLOCK_RANK), so every inventory copy is left
unassigned regardless of star rating -- a simple way to guarantee "unused"
without needing to reason about socket assignment.
"""

from app.api.routes import _run_optimization
from app.api.schemas import GemSetup, GemSetupItem, InventoryItem, OptimizeRequest

HEAD_SETUP = GemSetupItem(gem_id=5001, target_rank="1", active_stars=5)


def _request(inventory: list[InventoryItem], gem_power: int = 100) -> OptimizeRequest:
    return OptimizeRequest(
        gem_power=gem_power,
        gem_setup=GemSetup(head=HEAD_SETUP),
        inventory=inventory,
    )


def _optimize(inventory: list[InventoryItem], **kwargs):
    return _run_optimization(_request(inventory), enable_upgrades=False, convert_1star=False, **kwargs)


def _dormant_entry(response, gem_id: int):
    return next((d for d in response.dormant_gems if d.gem_id == gem_id), None)


def test_unused_non_dormant_gem_is_recommended():
    response = _optimize([InventoryItem(gem_id=2001, rank="3", active_stars=2)])
    entry = _dormant_entry(response, 2001)
    assert entry is not None
    assert entry.quantity == 1
    assert entry.gem_power_gained == 20
    assert entry.already_dormant_quantity == 0
    assert response.summary.dormant_gem_power == 20
    assert response.summary.newly_dormant_gem_power == 20


def test_already_dormant_gem_is_not_recommended_but_still_counted():
    response = _optimize([InventoryItem(gem_id=2001, rank="3", active_stars=2, dormant=True)])
    entry = _dormant_entry(response, 2001)
    assert entry is not None
    assert entry.quantity == 0
    assert entry.gem_power_gained == 0
    assert entry.already_dormant_quantity == 1
    # Accounting (dormant_gem_power / surplus) is unaffected by the dormant
    # flag -- only the recommendation surfaced to the player changes.
    assert response.summary.dormant_gem_power == 20
    assert response.summary.newly_dormant_gem_power == 0

    non_dormant = _optimize([InventoryItem(gem_id=2001, rank="3", active_stars=2)])
    assert response.summary.surplus_or_shortfall == non_dormant.summary.surplus_or_shortfall
    assert response.summary.dormant_gem_power == non_dormant.summary.dormant_gem_power


def test_mixed_dormant_and_active_copies_split_correctly():
    response = _optimize([
        InventoryItem(gem_id=2001, rank="3", active_stars=2, dormant=True),
        InventoryItem(gem_id=2001, rank="3", active_stars=2, dormant=False),
    ])
    entry = _dormant_entry(response, 2001)
    assert entry is not None
    assert entry.quantity == 1
    assert entry.gem_power_gained == 20
    assert entry.already_dormant_quantity == 1
    assert response.summary.dormant_gem_power == 40
    assert response.summary.newly_dormant_gem_power == 20


def test_dormant_gems_section_omitted_when_all_already_dormant():
    """No net-new dormant recommendations anywhere in the response -- this is
    the idempotency property: re-submitting an already-dormant-marked
    inventory should not surface any recommendation for the player to act on.
    """
    response = _optimize([InventoryItem(gem_id=2001, rank="3", active_stars=2, dormant=True)])
    assert all(d.quantity == 0 for d in response.dormant_gems)
