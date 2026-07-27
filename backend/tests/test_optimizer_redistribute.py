"""Tests for redistribute_for_bonuses and its helpers (total_residual_for,
max_bonuses_for_owned) in app.core.optimizer.

All tests call the optimizer functions directly with hand-built fixtures so
there is no dependency on any API or I/O layer.  The _inv / _main helpers
compute contribution / required_power from the real cost tables so expected
values stay in sync with any cost-table changes.

Known reference values:
  5-star rank "1"  contribution = 32
  5-star rank "3"  contribution = 189
  5-star rank "5"  contribution = 731
  5-star rank "6"  required_power = 850, num_sockets = 4  (sockets 0-2: 2-star, socket 3: 5-star)
  5-star rank "7"  required_power = 1575, num_sockets = 5  (sockets 0-2: 2-star, sockets 3-4: 5-star)
  2-star rank "1"  contribution = 4
  2-star rank "7"  required_power = 235, num_sockets = 3  (socket 0: 1-star, sockets 1-2: 2-star)

Gem IDs used (real definitions in data.py):
  5001 Phoenix Ashes        bonus_gem_ids = [2001, 2003, 2004, 5002, 5004]
  5002 Chip of Stone Flesh  bonus_gem_ids = [2002, 2006, 2007, 5001, 5005]
  2001 Power & Command      bonus_gem_ids = [1007, 2003, 2004]
  2002 Follower's Burden    bonus_gem_ids = [1017, 2001, 2005]
"""

import pytest

from app.core.data import COST_2STAR, COST_5STAR
from app.core.models import InventoryGem, MainGem
from app.core.optimizer import (
    dormant_power_for,
    expand_inventory,
    max_bonuses_for_owned,
    redistribute_for_bonuses,
    total_residual_for,
)
from app.core.pipeline import _run_pipeline
from app.core.rules import compute_contribution, num_sockets_unlocked


# ---------------------------------------------------------------------------
# Helpers (mirrors test_upgrade_search.py)
# ---------------------------------------------------------------------------

def _inv(gem_id: int, star: int, rank: str, active_stars: int = 2) -> InventoryGem:
    table = COST_2STAR if star == 2 else COST_5STAR
    return InventoryGem(
        gem_id=gem_id,
        star_rating=star,
        rank=rank,
        quantity=1,
        active_stars=active_stars,
        contribution=compute_contribution(star, rank, table),
    )


def _main(slot: str, gem_id: int, star: int, rank: str, active_stars: int = 2) -> MainGem:
    table = COST_2STAR if star == 2 else COST_5STAR
    tbl = COST_5STAR if star == 5 else table
    return MainGem(
        slot_name=slot,
        gem_id=gem_id,
        star_rating=star,
        target_rank=rank,
        required_power=tbl[rank].required_gem_power,
        num_sockets=num_sockets_unlocked(rank, star),
        active_stars=active_stars,
    )


# ---------------------------------------------------------------------------
# total_residual_for
# ---------------------------------------------------------------------------

def test_total_residual_five_star_offset():
    """5-star main residual is offset by socketed contribution."""
    mg = _main("head", 5001, 5, "6")   # required_power=850
    inv = _inv(5002, 5, "1")           # contribution=32
    per_slot = {"head": [(0, inv)]}
    assert total_residual_for([mg], per_slot) == max(0, 850 - 32)


def test_total_residual_two_star_no_offset():
    """2-star main residual is always required_power regardless of socketed gems."""
    mg = _main("head", 2001, 2, "7")   # required_power=235
    inv = _inv(2003, 2, "7")           # contribution=291
    per_slot = {"head": [(0, inv)]}
    # Even though contribution (291) > required_power (235), residual = 235.
    assert total_residual_for([mg], per_slot) == 235


def test_total_residual_empty_socket():
    """5-star main with no gems has residual equal to required_power."""
    mg = _main("head", 5001, 5, "6")
    per_slot = {"head": []}
    assert total_residual_for([mg], per_slot) == 850


def test_total_residual_cannot_go_negative():
    """5-star main residual floors at zero when contribution exceeds required_power."""
    mg = _main("head", 5001, 5, "6")   # required_power=850
    inv = _inv(5002, 5, "7")           # contribution=2407 >> 850
    per_slot = {"head": [(0, inv)]}
    assert total_residual_for([mg], per_slot) == 0


# ---------------------------------------------------------------------------
# dormant_power_for
# ---------------------------------------------------------------------------

def test_dormant_power_sums_unowned_extractable_power():
    """Only copies absent from owned_copy_ids contribute extractable GP."""
    owned = _inv(5002, 5, "1")   # contribution=32, required_gem_power=0 -> extractable 0
    unowned_a = _inv(9999, 5, "5")  # required_gem_power=475
    unowned_b = _inv(9998, 5, "6")  # required_gem_power=850
    all_copies = [(0, owned), (1, unowned_a), (2, unowned_b)]
    assert dormant_power_for(all_copies, owned_copy_ids={0}) == 475 + 850


def test_dormant_power_zero_when_all_owned():
    inv = _inv(5002, 5, "6")
    all_copies = [(0, inv)]
    assert dormant_power_for(all_copies, owned_copy_ids={0}) == 0


# ---------------------------------------------------------------------------
# max_bonuses_for_owned
# ---------------------------------------------------------------------------

def test_max_bonuses_no_requirements():
    """Gem with no bonus requirements yields 0 regardless of owned gems."""
    mg = _main("head", 5001, 5, "6")
    bonus_table: dict[int, list[int]] = {5001: [0, 0, 0, 0, 0]}
    inv = _inv(5002, 5, "1")
    assert max_bonuses_for_owned(mg, [(0, inv)], bonus_table) == 0


def test_max_bonuses_single_match():
    """A single exact gem_id match activates one bonus."""
    mg = _main("head", 5001, 5, "6")  # 4 sockets; socket 3 is 5-star
    bonus_table = {5001: [0, 0, 0, 5002, 0]}
    inv = _inv(5002, 5, "1")
    assert max_bonuses_for_owned(mg, [(0, inv)], bonus_table) == 1


def test_max_bonuses_no_matching_gem():
    """Requirement present but no owned gem with that gem_id → 0 bonuses."""
    mg = _main("head", 5001, 5, "6")
    bonus_table = {5001: [0, 0, 0, 5002, 0]}
    inv = _inv(5003, 5, "1")  # gem_id=5003, not 5002
    assert max_bonuses_for_owned(mg, [(0, inv)], bonus_table) == 0


def test_max_bonuses_duplicate_requirements_one_gem():
    """Two sockets require the same gem_id; owning one copy → only 1 bonus."""
    mg = _main("head", 5001, 5, "7")  # 5 sockets (3 + 2 = 3 × 2-star + 2 × 5-star)
    # Both 5-star sockets (indices 3 and 4) require the same gem_id.
    bonus_table = {5001: [0, 0, 0, 5002, 5002]}
    inv = _inv(5002, 5, "1")
    assert max_bonuses_for_owned(mg, [(0, inv)], bonus_table) == 1


def test_max_bonuses_duplicate_requirements_two_gems():
    """Two sockets require the same gem_id; owning two copies → 2 bonuses."""
    mg = _main("head", 5001, 5, "7")
    bonus_table = {5001: [0, 0, 0, 5002, 5002]}
    inv_a = _inv(5002, 5, "1")
    inv_b = _inv(5002, 5, "3")  # different rank, same gem_id
    assert max_bonuses_for_owned(mg, [(0, inv_a), (1, inv_b)], bonus_table) == 2


# ---------------------------------------------------------------------------
# redistribute_for_bonuses — swap activates more bonuses (feasible)
# ---------------------------------------------------------------------------

def test_swap_between_two_five_star_mains_activates_bonuses():
    """Cross-main swap of equal-contribution 5-star gems unlocks 2 new bonuses.

    mg_a (5001) has inv_5001_type in its 5-star socket, but socket 3 wants 5002.
    mg_b (5002) has inv_5002_type, but socket 3 wants 5001.
    A swap gives both mains the gem they need — total bonuses: 0 → 2.
    Because both gems have the same contribution the residual is unchanged.
    """
    mg_a = _main("head", 5001, 5, "6")
    mg_b = _main("chest", 5002, 5, "6")

    # Inventory gems with gem_ids that are the "wrong" gem for each main.
    inv_5001_type = _inv(5001, 5, "1")  # gem_id=5001, contribution=32
    inv_5002_type = _inv(5002, 5, "1")  # gem_id=5002, contribution=32

    per_slot: dict[str, list] = {
        "head":  [(0, inv_5001_type)],   # mg_a holds the 5001-type → no bonus (needs 5002)
        "chest": [(1, inv_5002_type)],   # mg_b holds the 5002-type → no bonus (needs 5001)
    }
    # Socket 3 of each main requires the other's gem.
    bonus_table = {5001: [0, 0, 0, 5002, 0], 5002: [0, 0, 0, 5001, 0]}
    available_power = 5000
    all_copies = [(0, inv_5001_type), (1, inv_5002_type)]

    result = redistribute_for_bonuses(
        [mg_a, mg_b], per_slot, bonus_table, available_power, all_copies
    )

    owned_ids_head  = {gem.gem_id for _, gem in result["head"]}
    owned_ids_chest = {gem.gem_id for _, gem in result["chest"]}
    assert 5002 in owned_ids_head,  "mg_a should now own the 5002-type gem"
    assert 5001 in owned_ids_chest, "mg_b should now own the 5001-type gem"

    bonuses = (
        max_bonuses_for_owned(mg_a, result["head"],  bonus_table)
        + max_bonuses_for_owned(mg_b, result["chest"], bonus_table)
    )
    assert bonuses == 2


# ---------------------------------------------------------------------------
# redistribute_for_bonuses — swap blocked by feasibility
# ---------------------------------------------------------------------------

def test_swap_with_unassigned_blocked_by_feasibility():
    """A swap that activates a bonus is rejected when it makes the plan infeasible.

    mg_a holds a high-contribution 5-star gem (rank "5", contribution=731).
    An unassigned 5-star gem (rank "1", contribution=32) has the gem_id that
    matches mg_a's socket-3 bonus requirement.  Swapping it in gains 1 bonus
    but raises the residual to 818, which exceeds available_power=200.
    The move must therefore be rejected.
    """
    mg_a = _main("head", 5001, 5, "6")  # required_power=850, 4 sockets

    # Currently owns a high-contribution gem that does NOT activate the bonus.
    inv_owned = _inv(9999, 5, "5")  # gem_id=9999 (non-bonus), contribution=731
    # Unassigned gem that WOULD activate the bonus but has low contribution.
    inv_bonus = _inv(5002, 5, "1")  # gem_id=5002 matches socket-3 req, contribution=32

    per_slot: dict[str, list] = {"head": [(0, inv_owned)]}
    bonus_table = {5001: [0, 0, 0, 5002, 0]}

    # Starting residual: max(0, 850 - 731) = 119 → feasible with available_power=200.
    # After swap:        max(0, 850 -  32) = 818 > 200 → infeasible; must be blocked.
    available_power = 200
    all_copies = [(0, inv_owned), (1, inv_bonus)]

    result = redistribute_for_bonuses(
        [mg_a], per_slot, bonus_table, available_power, all_copies
    )

    owned_ids = {gem.gem_id for _, gem in result["head"]}
    assert 9999 in owned_ids, "original high-contribution gem must stay"
    assert 5002 not in owned_ids, "bonus gem must NOT be swapped in (infeasible)"


def test_swap_with_unassigned_allowed_when_outgoing_dormant_gp_covers_the_gap():
    """Net-cost accounting must credit the dormant GP an outgoing gem frees up.

    mg_a owns a deeply-upgraded 5-star gem (rank "6": required_gems=14,
    required_gem_power=850, contribution=1298) that does NOT activate the
    bonus. An unassigned rank "1" gem (contribution=32, required_gem_power=0)
    DOES activate the bonus but is far weaker.

    Gross residual rises from 277 to 1543 (a 1266 increase) — comfortably
    over a budget of 700, so the old residual-only guard would reject this
    swap outright.

    But the outgoing rank "6" gem becomes dormant-eligible once displaced,
    recovering its full required_gem_power (850). Net cost only rises by
    32 * (14 - 1) = 416 (to 693), which DOES fit under budget=700: the
    player's true affordable ceiling accounts for GP they can reclaim by
    making the displaced gem dormant, so the swap should be allowed.
    """
    mg_a = _main("head", 5001, 5, "7")  # required_power=1575, 5 sockets

    inv_owned = _inv(9999, 5, "6")  # gem_id=9999 (non-bonus), contribution=1298
    inv_bonus = _inv(5002, 5, "1")  # gem_id=5002 matches socket-3 req, contribution=32

    per_slot: dict[str, list] = {"head": [(0, inv_owned)]}
    bonus_table = {5001: [0, 0, 0, 5002, 0]}

    # Starting residual: max(0, 1575 - 1298) = 277.
    # Starting cost: 277 - dormant(0, since the unassigned rank-1 gem has
    # required_gem_power=0) = 277.
    # Budget=700 > starting cost, so the ceiling is 700.
    budget = 700
    all_copies = [(0, inv_owned), (1, inv_bonus)]

    result = redistribute_for_bonuses(
        [mg_a], per_slot, bonus_table, budget, all_copies
    )

    owned_ids = {gem.gem_id for _, gem in result["head"]}
    assert 5002 in owned_ids, "bonus gem should be swapped in (net cost fits budget)"
    assert 9999 not in owned_ids, "displaced gem becomes dormant-eligible, not owned"


# ---------------------------------------------------------------------------
# redistribute_for_bonuses — pull in unassigned gem
# ---------------------------------------------------------------------------

def test_pull_in_unassigned_gem_activates_bonus():
    """Swapping a socketed non-bonus gem for an unassigned bonus gem gains 1 bonus.

    Both gems have equal contribution, so feasibility is unaffected.
    """
    mg_a = _main("head", 5001, 5, "6")

    inv_non_bonus = _inv(9998, 5, "1")  # gem_id=9998, contribution=32, no bonus
    inv_bonus     = _inv(5002, 5, "1")  # gem_id=5002, contribution=32, activates bonus

    per_slot: dict[str, list] = {"head": [(0, inv_non_bonus)]}
    bonus_table = {5001: [0, 0, 0, 5002, 0]}
    available_power = 5000
    # copy_id=1 is unassigned (not in any slot of per_slot).
    all_copies = [(0, inv_non_bonus), (1, inv_bonus)]

    result = redistribute_for_bonuses(
        [mg_a], per_slot, bonus_table, available_power, all_copies
    )

    owned_ids = {gem.gem_id for _, gem in result["head"]}
    assert 5002 in owned_ids, "bonus gem should have been swapped in"
    assert 9998 not in owned_ids, "non-bonus gem should have been displaced"

    bonuses = max_bonuses_for_owned(mg_a, result["head"], bonus_table)
    assert bonuses == 1


# ---------------------------------------------------------------------------
# redistribute_for_bonuses — star-type constraint respected
# ---------------------------------------------------------------------------

def test_star_type_constraint_prevents_wrong_star_swap():
    """A 2-star gem whose gem_id matches a 5-star socket requirement is never
    moved into the 5-star socket ownership group of that main gem.

    Socket 3 of mg_a (5-star socket, star_type=5) requires gem_id=5002.
    An unassigned 2-star gem has gem_id=5002 but star_rating=2.
    The redistribution must NOT swap it in (wrong star type).
    """
    mg_a = _main("head", 5001, 5, "6")  # sockets 0-2: 2-star, socket 3: 5-star

    inv_owned_5star   = _inv(9998, 5, "1")  # 5-star, currently filling the 5-star socket
    inv_wrong_star    = _inv(5002, 2, "1")  # 2-star gem_id=5002; star mismatch for socket 3

    per_slot: dict[str, list] = {"head": [(0, inv_owned_5star)]}
    bonus_table = {5001: [0, 0, 0, 5002, 0]}   # socket 3 needs gem_id=5002
    available_power = 5000
    # copy_id=1 is the wrong-star unassigned candidate.
    all_copies = [(0, inv_owned_5star), (1, inv_wrong_star)]

    result = redistribute_for_bonuses(
        [mg_a], per_slot, bonus_table, available_power, all_copies
    )

    owned = result["head"]
    star_ratings_owned = [gem.star_rating for _, gem in owned]
    assert 2 not in star_ratings_owned, (
        "a 2-star gem must never appear in mg_a's 5-star socket group"
    )
    # The original 5-star gem should still be the only occupant.
    assert len(owned) == 1
    _, only_gem = owned[0]
    assert only_gem.star_rating == 5


# ---------------------------------------------------------------------------
# redistribute_for_bonuses — no-op and idempotence
# ---------------------------------------------------------------------------

def test_no_op_when_no_gain():
    """When no swap can increase total bonuses the result equals the input."""
    mg_a = _main("head", 5001, 5, "6")

    # The gem already in the socket already activates the bonus.
    inv_bonus = _inv(5002, 5, "1")
    per_slot: dict[str, list] = {"head": [(0, inv_bonus)]}
    bonus_table = {5001: [0, 0, 0, 5002, 0]}
    available_power = 5000
    all_copies = [(0, inv_bonus)]

    result = redistribute_for_bonuses(
        [mg_a], per_slot, bonus_table, available_power, all_copies
    )
    assert result == {"head": [(0, inv_bonus)]}


def test_idempotent():
    """Running redistribute twice gives the same result as running it once."""
    mg_a = _main("head", 5001, 5, "6")
    mg_b = _main("chest", 5002, 5, "6")
    inv_5001_type = _inv(5001, 5, "1")
    inv_5002_type = _inv(5002, 5, "1")
    per_slot: dict[str, list] = {
        "head":  [(0, inv_5001_type)],
        "chest": [(1, inv_5002_type)],
    }
    bonus_table = {5001: [0, 0, 0, 5002, 0], 5002: [0, 0, 0, 5001, 0]}
    available_power = 5000
    all_copies = [(0, inv_5001_type), (1, inv_5002_type)]

    once  = redistribute_for_bonuses([mg_a, mg_b], per_slot, bonus_table, available_power, all_copies)
    twice = redistribute_for_bonuses([mg_a, mg_b], once,    bonus_table, available_power, all_copies)
    assert once == twice


# ---------------------------------------------------------------------------
# redistribute_for_bonuses — 2-star ↔ 2-star swaps always feasible
# ---------------------------------------------------------------------------

def test_two_star_swap_always_feasible():
    """Swapping 2-star gems between two 2-star main gems never changes residual.

    2-star main gems carry their full required_power as residual regardless of
    socketed power, so even available_power=0 cannot block a bonus-improving swap.

    mg_a (2001) socket 1 requires gem_id=2003; mg_b (2002) socket 1 requires 2001.
    mg_a currently holds gem_id=2001, mg_b holds gem_id=2003.  After swap both get
    the gem they need → 2 new bonuses.
    """
    mg_a = _main("a", 2001, 2, "7")  # required_power=235, 3 sockets; socket 1 needs 2003
    mg_b = _main("b", 2002, 2, "7")  # required_power=235, 3 sockets; socket 1 needs 2001

    inv_2001 = _inv(2001, 2, "1")   # gem_id=2001
    inv_2003 = _inv(2003, 2, "1")   # gem_id=2003

    per_slot: dict[str, list] = {
        "a": [(0, inv_2001)],  # mg_a has 2001 but needs 2003 in socket 1
        "b": [(1, inv_2003)],  # mg_b has 2003 but needs 2001 in socket 1
    }
    # bonus_table: 2001 sockets → [1-star req, 2003, 2004]; 2002 sockets → [1-star req, 2001, 2005]
    bonus_table = {2001: [1007, 2003, 2004], 2002: [1017, 2001, 2005]}

    # available_power=0 → if residual changed, no swap would be accepted.
    # Since 2-star mains are immune, it must still be accepted.
    available_power = 0
    all_copies = [(0, inv_2001), (1, inv_2003)]

    result = redistribute_for_bonuses(
        [mg_a, mg_b], per_slot, bonus_table, available_power, all_copies
    )

    owned_a = {gem.gem_id for _, gem in result["a"]}
    owned_b = {gem.gem_id for _, gem in result["b"]}
    assert 2003 in owned_a, "mg_a should own gem_id=2003 after swap"
    assert 2001 in owned_b, "mg_b should own gem_id=2001 after swap"

    bonuses_a = max_bonuses_for_owned(mg_a, result["a"], bonus_table)
    bonuses_b = max_bonuses_for_owned(mg_b, result["b"], bonus_table)
    assert bonuses_a + bonuses_b == 2


# ---------------------------------------------------------------------------
# End-to-end via _run_pipeline
# ---------------------------------------------------------------------------

def test_pipeline_bonus_count_after_redistribution():
    """Full pipeline produces correct bonuses after cross-gem redistribution.

    Two 5-star mains whose bonus-matching gems start on the wrong main.
    The pipeline must detect the swap opportunity and end up with 2 bonuses
    while keeping the plan feasible.
    """
    # Both mains at rank "6": 4 sockets each (0-2: 2-star, 3: 5-star).
    # Socket 3 of 5001 requires gem_id=5002; socket 3 of 5002 requires gem_id=5001.
    main_gems = [
        _main("head",  5001, 5, "6"),
        _main("chest", 5002, 5, "6"),
    ]

    # Two 5-star inventory gems: one of type 5001 and one of type 5002.
    inv_5001_type = InventoryGem(gem_id=5001, star_rating=5, rank="1", quantity=1, active_stars=2, contribution=32)
    inv_5002_type = InventoryGem(gem_id=5002, star_rating=5, rank="1", quantity=1, active_stars=2, contribution=32)
    inventory = [inv_5001_type, inv_5002_type]

    available_power = 5000
    result = _run_pipeline(available_power, main_gems, [], inventory)

    total_bonuses = sum(gr.bonuses_activated for gr in result.gem_results)
    assert total_bonuses == 2, (
        f"Expected 2 bonuses after redistribution but got {total_bonuses}. "
        f"gem_results: {[(gr.slot_name, gr.bonuses_activated) for gr in result.gem_results]}"
    )
    assert result.total_residual_cost <= available_power, "plan must remain feasible"
