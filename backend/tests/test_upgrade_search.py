"""Tests for the new upgrade-potential chain-building and downgrade-walk algorithm.

Covers:
- compute_socketable_star_ratings: which gem stars can be socketed
- build_upgrade_chains: correct step counts, fodder consumption, snapshots
- materialize_upgrades: depth-0 passes originals, higher depths use snapshots
- Never-worse-than-baseline: walk result effective_residual ≤ baseline residual
- filter_upgrades_to_socketed: unsocketed upgrades are refunded / dropped
- Only the highest-ranked copy of each type is upgraded (others are fodder)
- 5-star gems not upgraded when no main gem reaches rank ≥ 6
"""

import copy

import pytest

from app.core.data import COST_2STAR, COST_5STAR
from app.core.models import InventoryGem, MainGem, SocketAssignment
from app.core.pipeline import _run_pipeline
from app.core.rules import compute_contribution, num_sockets_unlocked
from app.core.upgrades import (
    build_upgrade_chains,
    compute_socket_counts,
    compute_socketable_star_ratings,
    filter_upgrades_to_socketed,
    materialize_upgrades,
)


# ---------------------------------------------------------------------------
# Helpers
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
    from app.core.data import COST_5STAR as C5
    tbl = C5 if star == 5 else table
    return MainGem(
        slot_name=slot,
        gem_id=gem_id,
        star_rating=star,
        target_rank=rank,
        required_power=tbl[rank].required_gem_power,
        num_sockets=num_sockets_unlocked(rank, star),
        active_stars=active_stars,
    )


# Known 2-star contributions:
#   rank "1"  → 1*4 + 0  = 4
#   rank "4"  → 2*4 + 45 = 53
#   rank "5"  → 4*4 + 65 = 81


# ---------------------------------------------------------------------------
# compute_socket_counts
# ---------------------------------------------------------------------------

def test_socket_counts_no_main_gems():
    assert compute_socket_counts([]) == {}


def test_socket_counts_single_rank5_main():
    # rank "5" → 3 sockets (0,1,2) all 2-star; 5-star sockets unlock at rank 6
    mg = _main("head", 5001, 5, "5")
    counts = compute_socket_counts([mg])
    assert counts == {2: 3}


def test_socket_counts_rank6_main():
    # rank "6" → 4 sockets: 0,1,2 (2-star) + 3 (5-star)
    mg = _main("head", 5001, 5, "6")
    counts = compute_socket_counts([mg])
    assert counts == {2: 3, 5: 1}


def test_socket_counts_multiple_main_gems():
    mg1 = _main("head",  5001, 5, "5")  # 3×2-star
    mg2 = _main("chest", 5001, 5, "6")  # 3×2-star + 1×5-star
    counts = compute_socket_counts([mg1, mg2])
    assert counts == {2: 6, 5: 1}


# ---------------------------------------------------------------------------
# compute_socketable_star_ratings
# ---------------------------------------------------------------------------

def test_socketable_no_main_gems():
    assert compute_socketable_star_ratings([]) == frozenset()


def test_socketable_5star_main_below_rank6():
    mg = _main("head", 5001, 5, "5")
    result = compute_socketable_star_ratings([mg])
    assert 2 in result
    assert 5 not in result  # sockets 3-4 require rank ≥ 6


def test_socketable_5star_main_at_rank6():
    mg = _main("head", 5001, 5, "6")
    result = compute_socketable_star_ratings([mg])
    assert 2 in result
    assert 5 in result


def test_socketable_only_2star_main_gem():
    """2-star main gems provide no reduction; 5-star sockets never appear."""
    from app.core.data import COST_2STAR as C2
    mg = MainGem(
        slot_name="head", gem_id=2001, star_rating=2, target_rank="5",
        required_power=C2["5"].required_gem_power,
        num_sockets=num_sockets_unlocked("5", 2),
        active_stars=2,
    )
    result = compute_socketable_star_ratings([mg])
    assert result == frozenset()


# ---------------------------------------------------------------------------
# build_upgrade_chains — step counts and fodder logic
# ---------------------------------------------------------------------------

def test_single_copy_no_steps():
    """A gem type with exactly 1 copy has no fodder → 0 steps."""
    inv = [_inv(2033, 2, "1")]
    chains, leftover = build_upgrade_chains(inv, {2: 99})
    assert len(chains) == 1
    assert len(chains[0].steps) == 0
    assert leftover == []


def test_two_copies_one_step_to_rank4():
    """2 copies → can reach rank 4 (needs 1 fodder), can't proceed further."""
    inv = [_inv(2033, 2, "1"), _inv(2033, 2, "1")]
    chains, _ = build_upgrade_chains(inv, {2: 99})
    assert len(chains) == 1
    chain = chains[0]
    assert len(chain.steps) == 1
    assert chain.steps[0].from_rank == "1"
    assert chain.steps[0].to_rank == "4"
    # Target contrib after step 1 = 53 (rank 4 = 2*4+45)
    assert chain.steps[0].contribution_after == 53


def test_four_copies_three_steps():
    """4 copies → 3 sub-rank steps: 1→4 (1 fodder), 4→4.1 (1 fodder), 4.1→5 (1 fodder)."""
    inv = [_inv(2033, 2, "1")] * 4
    chains, _ = build_upgrade_chains(inv, {2: 99})
    assert len(chains) == 1
    chain = chains[0]
    assert len(chain.steps) == 3
    assert chain.steps[0].to_rank == "4"
    assert chain.steps[1].to_rank == "4.1"
    assert chain.steps[2].to_rank == "5"
    assert chain.steps[2].contribution_after == 81  # rank 5 = 4*4+65


def test_highest_ranked_copy_is_target():
    """When copies are at different ranks, the highest-contribution one is the target."""
    low  = _inv(2033, 2, "1")   # contribution = 4
    high = _inv(2033, 2, "4")   # contribution = 53
    inv = [low, high]
    chains, _ = build_upgrade_chains(inv, {2: 99})
    chain = chains[0]
    assert chain.base_sub_inventory[0].rank == "4"  # highest first
    # Target at rank 4 with 1 rank-1 fodder: can advance one sub-rank to 4.1 (delta=1 copy).
    assert len(chain.steps) == 1
    assert chain.steps[0].to_rank == "4.1"


def test_non_socketable_gems_are_leftover():
    """1-star gems and 5-star gems (when no 5-star socket) go straight to leftover."""
    from app.core.data import COST_1STAR
    one_star = InventoryGem(
        gem_id=1001, star_rating=1, rank="1", quantity=1,
        active_stars=1,
        contribution=compute_contribution(1, "1", COST_1STAR),
    )
    two_star = _inv(2033, 2, "1")
    inv = [one_star, two_star]
    chains, leftover = build_upgrade_chains(inv, {2: 99})
    assert any(g.gem_id == 1001 for g in leftover)
    assert all(c.star_rating == 2 for c in chains)


def test_5star_inv_not_upgraded_when_star5_not_socketable():
    """5-star inv gems don't get a chain when socketable_star_ratings = {2}."""
    five_star = InventoryGem(
        gem_id=5001, star_rating=5, rank="1", quantity=1,
        active_stars=2,
        contribution=compute_contribution(5, "1", COST_5STAR),
    )
    inv = [five_star, five_star]
    chains, leftover = build_upgrade_chains(inv, {2: 99})
    assert len(chains) == 0
    assert len(leftover) == 2


def test_socket_cap_limits_chain_count():
    """With socket_count={2:1}, only the single highest-value type gets a chain."""
    inv = [
        _inv(2001, 2, "1"), _inv(2001, 2, "1"),  # 2 copies, contrib=4 each
        _inv(2033, 2, "4"), _inv(2033, 2, "1"),  # highest copy at rank 4 (contrib=53)
    ]
    chains, leftover = build_upgrade_chains(inv, {2: 1})
    # Only 1 chain: 2033 wins (max contribution 53 > 4)
    assert len(chains) == 1
    assert chains[0].gem_id == 2033
    # 2001 copies go to leftover
    assert sum(1 for g in leftover if g.gem_id == 2001) == 2


def test_socket_cap_selects_by_copy_count_on_tie():
    """When contributions are equal, the type with more copies (more upgrade potential) wins."""
    inv = [
        _inv(2001, 2, "1"),                              # 1 copy
        _inv(2033, 2, "1"), _inv(2033, 2, "1"),          # 2 copies
    ]
    chains, leftover = build_upgrade_chains(inv, {2: 1})
    assert len(chains) == 1
    assert chains[0].gem_id == 2033  # more copies wins
    assert sum(1 for g in leftover if g.gem_id == 2001) == 1


def test_already_upgraded_gem_not_downgraded_past_initial_rank():
    """The chain target is always the highest-ranked copy; depth 0 returns that initial rank."""
    high = _inv(2033, 2, "4")   # already at rank 4
    low  = _inv(2033, 2, "1")   # fodder
    chains, leftover = build_upgrade_chains([high, low], {2: 99})
    chain = chains[0]
    # Target is the rank-4 copy; it is always present at depth 0 (initial rank).
    assert chain.base_sub_inventory[0].rank == "4"
    # Depth 0 returns the original sub-inventory (target at rank 4 + fodder at rank 1).
    working, _, _ = materialize_upgrades(chains, [0], leftover)
    target_ranks = [g.rank for g in working if g.gem_id == 2033]
    assert "4" in target_ranks  # target preserved at initial rank


# ---------------------------------------------------------------------------
# materialize_upgrades
# ---------------------------------------------------------------------------

def test_materialize_depth0_returns_originals():
    inv = [_inv(2033, 2, "1")] * 4
    chains, leftover = build_upgrade_chains(inv, {2: 99})
    working, deltas, cost = materialize_upgrades(chains, [0], leftover)
    assert cost == 0
    assert deltas == []
    # All 4 originals back
    assert len(working) == 4
    assert all(g.rank == "1" for g in working)


def test_materialize_depth1_gives_step1_snapshot():
    inv = [_inv(2033, 2, "1")] * 4
    chains, leftover = build_upgrade_chains(inv, {2: 99})
    working, deltas, cost = materialize_upgrades(chains, [1], leftover)
    # Step 1 consumes 1 fodder → 3 gems left; target now at rank 4
    assert any(g.rank == "4" for g in working)
    assert cost == chains[0].steps[0].gem_power_cost
    assert len(deltas) == len(chains[0].steps[0].deltas)


def test_materialize_depth2_gives_step2_snapshot():
    inv = [_inv(2033, 2, "1")] * 4
    chains, leftover = build_upgrade_chains(inv, {2: 99})
    # Steps: 1→4, 4→4.1, 4.1→5. At depth 2: target is at rank 4.1.
    working, deltas, cost = materialize_upgrades(chains, [2], leftover)
    ranks = [g.rank for g in working]
    assert "4.1" in ranks
    assert cost == sum(s.gem_power_cost for s in chains[0].steps[:2])


def test_materialize_leftover_included():
    """Non-socketable gems always appear in the output regardless of depth."""
    from app.core.data import COST_1STAR
    one_star = InventoryGem(
        gem_id=1001, star_rating=1, rank="1", quantity=1,
        active_stars=1,
        contribution=compute_contribution(1, "1", COST_1STAR),
    )
    inv = [_inv(2033, 2, "1")] * 4 + [one_star]
    chains, leftover = build_upgrade_chains(inv, {2: 99})
    working, _, _ = materialize_upgrades(chains, [0], leftover)
    assert any(g.gem_id == 1001 for g in working)


# ---------------------------------------------------------------------------
# filter_upgrades_to_socketed
# ---------------------------------------------------------------------------

def test_filter_empty_deltas_returns_empty():
    filtered, dropped, restore = filter_upgrades_to_socketed([], {})
    assert filtered == []
    assert dropped == []
    assert restore == []


def test_filter_keeps_socketed_upgrade():
    """A delta whose target rank appears in assignments is kept."""
    gem = _inv(2033, 2, "4")
    sa = SocketAssignment(socket_index=0, gem=gem, copy_id=0, contribution=gem.contribution)
    from app.core.models import UpgradeDelta
    delta = UpgradeDelta(
        gem_id=2033, star_rating=2, current_rank="1", target_rank="4",
        additional_gem_power=45, additional_socket_power=49, net_gain=4,
        inventory_index=0, copies_sacrificed=1, upgrade_type="partial",
        sacrificed_gems=[_inv(2033, 2, "1")],
        pre_upgrade_gem=_inv(2033, 2, "1"),
    )
    filtered, dropped, restore = filter_upgrades_to_socketed(
        [delta], {"head": [sa]}
    )
    assert len(filtered) == 1
    assert len(dropped) == 0


def test_filter_drops_unsocketed_upgrade():
    """A delta whose target rank is not in any socket is dropped and fodder restored."""
    gem_target = _inv(2033, 2, "4")
    # No assignment for this gem → socket has something else
    other_gem = _inv(2003, 2, "5")
    sa = SocketAssignment(socket_index=0, gem=other_gem, copy_id=0, contribution=other_gem.contribution)
    fodder = _inv(2033, 2, "1")
    from app.core.models import UpgradeDelta
    delta = UpgradeDelta(
        gem_id=2033, star_rating=2, current_rank="1", target_rank="4",
        additional_gem_power=45, additional_socket_power=49, net_gain=4,
        inventory_index=0, copies_sacrificed=1, upgrade_type="partial",
        sacrificed_gems=[fodder],
        pre_upgrade_gem=_inv(2033, 2, "1"),
    )
    filtered, dropped, restore = filter_upgrades_to_socketed(
        [delta], {"head": [sa]}
    )
    assert len(filtered) == 0
    assert len(dropped) == 1
    # Consumed fodder is returned for display
    assert any(g.rank == "1" and g.gem_id == 2033 for g in restore)


# ---------------------------------------------------------------------------
# Integration: pipeline + upgrade walk (never worse than baseline)
# ---------------------------------------------------------------------------

def _make_pipeline_inputs():
    """Return (available_power, main_gems, inventory) for a repeatable scenario.

    Setup:
    - 1× 5-star main gem (ID 5001, "Phoenix Ashes") at rank "5"
      required_power = 225, sockets = 3 (all 2-star type)
    - 4× 2-star gem (ID 2033) at rank "1" in inventory
      3 usable sockets, contribution = 4 each without upgrades

    Baseline socketed power = 12 → residual = 213.
    With max upgrades (1→4 then 4→5): target@rank5 (contrib=81), two rank-1 copies consumed.
    Upgraded socketed power = 81 + remaining copies socketed.
    """
    available_power = 300
    main_gems = [_main("head", 5001, 5, "5")]
    inventory = [_inv(2033, 2, "1")] * 4
    return available_power, main_gems, inventory


def test_walk_never_worse_than_baseline():
    available_power, main_gems, inventory = _make_pipeline_inputs()
    baseline = _run_pipeline(available_power, main_gems, [], inventory)

    socket_counts = compute_socket_counts(main_gems)
    chains, leftover = build_upgrade_chains(inventory, socket_counts)
    depths = [len(c.steps) for c in chains]

    best_eff = None
    while True:
        working, applied, _ = materialize_upgrades(chains, depths, leftover)
        result = _run_pipeline(available_power, main_gems, [], working)
        filtered, _, _ = filter_upgrades_to_socketed(applied, result.gem_assignments)
        filtered_cost = sum(d.additional_gem_power for d in filtered)
        eff = result.total_residual_cost + filtered_cost

        if best_eff is None or eff < best_eff:
            best_eff = eff

        if eff <= available_power:
            break

        peel_idx = -1
        peel_contrib = -1
        for i, (chain, depth) in enumerate(zip(chains, depths)):
            if depth > 0:
                contrib = chain.steps[depth - 1].contribution_after
                if contrib > peel_contrib:
                    peel_contrib = contrib
                    peel_idx = i
        if peel_idx < 0:
            break
        depths[peel_idx] -= 1

    # The chosen effective residual must never exceed the baseline residual
    assert best_eff <= baseline.total_residual_cost


def test_walk_improvement_direction():
    """Upgrades should reduce or maintain effective residual vs baseline."""
    available_power, main_gems, inventory = _make_pipeline_inputs()
    baseline = _run_pipeline(available_power, main_gems, [], inventory)
    baseline_eff = baseline.total_residual_cost

    socket_counts = compute_socket_counts(main_gems)
    chains, leftover = build_upgrade_chains(inventory, socket_counts)

    if all(len(c.steps) == 0 for c in chains):
        pytest.skip("No upgrade steps available for this inventory")

    # Evaluate at max depth
    depths = [len(c.steps) for c in chains]
    working, applied, _ = materialize_upgrades(chains, depths, leftover)
    result = _run_pipeline(available_power, main_gems, [], working)
    filtered, _, _ = filter_upgrades_to_socketed(applied, result.gem_assignments)
    filtered_cost = sum(d.additional_gem_power for d in filtered)
    eff_with_upgrades = result.total_residual_cost + filtered_cost

    # May be equal (upgrade not beneficial) but must not be worse
    assert eff_with_upgrades <= baseline_eff


def test_only_one_copy_upgraded_per_type():
    """The target is always the highest-ranked copy; others serve as fodder."""
    high_rank = _inv(2033, 2, "4")   # contribution 53
    low_rank1  = _inv(2033, 2, "1")  # contribution 4
    low_rank2  = _inv(2033, 2, "1")  # contribution 4
    inv = [low_rank1, high_rank, low_rank2]  # unsorted deliberately

    chains, _ = build_upgrade_chains(inv, {2: 99})
    assert len(chains) == 1
    chain = chains[0]

    # Target should be the rank-4 copy (highest contribution)
    assert chain.base_sub_inventory[0].rank == "4"
    # Base sub_inventory has 3 copies; target is first
    assert len(chain.base_sub_inventory) == 3


def test_multiple_gem_types_separate_chains():
    """Two different gem types each get their own chain."""
    inv = [
        _inv(2001, 2, "1"), _inv(2001, 2, "1"),  # gem 2001: 2 copies
        _inv(2033, 2, "1"), _inv(2033, 2, "1"),  # gem 2033: 2 copies
    ]
    chains, _ = build_upgrade_chains(inv, {2: 99})
    assert len(chains) == 2
    gem_ids = {c.gem_id for c in chains}
    assert gem_ids == {2001, 2033}
    # Each type has exactly 1 step (rank 1→4 with 1 fodder copy)
    for chain in chains:
        assert len(chain.steps) == 1


def test_materialize_two_chains_independent():
    """Materializing chains is independent: one at depth 1, another at depth 0."""
    inv = [
        _inv(2001, 2, "1"), _inv(2001, 2, "1"),  # chain A
        _inv(2033, 2, "1"), _inv(2033, 2, "1"),  # chain B
    ]
    chains, leftover = build_upgrade_chains(inv, {2: 99})
    # Sort chains by gem_id for deterministic indexing
    chains_sorted = sorted(chains, key=lambda c: c.gem_id)
    depths = [1, 0]  # apply chain 0 step 1, chain 1 unchanged
    working, deltas, cost = materialize_upgrades(chains_sorted, depths, leftover)

    gem2001_ranks = [g.rank for g in working if g.gem_id == 2001]
    gem2033_ranks = [g.rank for g in working if g.gem_id == 2033]

    # Chain 0 (2001) at depth 1: target upgraded to rank 4, 1 fodder consumed
    assert "4" in gem2001_ranks
    # Chain 1 (2033) at depth 0: both copies still at rank 1
    assert all(r == "1" for r in gem2033_ranks)
    assert len(gem2033_ranks) == 2
