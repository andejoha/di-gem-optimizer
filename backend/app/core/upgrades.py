"""Upgrade optimization for the gem resonance optimizer.

Provides logic to discover profitable gem upgrades, apply them in-memory, and
re-run the optimizer to determine whether the upgraded configuration reduces the
player's overall gem-power cost.

Upgrades step through sub-ranks one at a time (e.g., 7 → 7.1 → 7.2 → … → 8),
consuming same-name gem copies of rank 1 plus gem power from the player's pool.

The key economic identity for an upgrade from rank A to rank B::

    additional_gem_power    = required_gem_power[B] - required_gem_power[A]
    additional_socket_power = contribution[B] - contribution[A]
    net_gain                = additional_socket_power - additional_gem_power
                            = (required_gems[B] - required_gems[A]) * BASE_POWER[star]

**Upgrade potential model**

For each socketable ``(gem_id, star_rating)`` type in inventory the highest-ranked
copy is the *upgrade target*; all other copies of that type form the *fodder pool*.
``build_upgrade_chains`` greedily advances the target one rank at a time, consuming
one rank-1 fodder copy per step, recording the complete upgrade trajectory as a
``GemUpgradeChain`` with per-step snapshots.

``materialize_upgrades`` converts a ``depths`` vector (how many steps of each chain
to apply) into a concrete inventory, delta list, and total gem-power cost.

``filter_upgrades_to_socketed`` then prunes upgrades whose target gem is not actually
placed in a socket by the optimizer, so only cost-effective upgrades are shown and
charged.

Public API:
  - ``get_sorted_ranks``: ordered rank strings for a star rating.
  - ``compute_upgrade_delta``: single upgrade step economics.
  - ``compute_socket_counts``: total available sockets per gem star rating.
  - ``compute_socketable_star_ratings``: which gem star ratings have available sockets.
  - ``build_upgrade_chains``: per-type max-potential upgrade trajectories.
  - ``materialize_upgrades``: realize a depth vector as a concrete inventory + deltas.
  - ``filter_upgrades_to_socketed``: prune upgrades for gems not ultimately socketed.
"""

import copy
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from app.core.config import BASE_POWER, SOCKET_STAR_TYPE
from app.core.data import COST_1STAR, COST_2STAR, COST_5STAR
from app.core.models import (
    InventoryGem,
    MainGem,
    SocketAssignment,
    UpgradeDelta,
)
from app.core.rules import compute_contribution


def _cost_table(star_rating: int):
    """Return the upgrade cost table for the given star rating."""
    if star_rating == 1:
        return COST_1STAR
    if star_rating == 2:
        return COST_2STAR
    return COST_5STAR


def get_sorted_ranks(star_rating: int) -> list[str]:
    """Return rank strings for the given star rating, ordered from lowest to highest.

    Ranks are sorted by ``(required_gems, required_gem_power)`` rather than
    lexicographically, which correctly orders labels like ``"6.9"`` before
    ``"6.10"`` (where a naive lexicographic sort would fail).

    Args:
        star_rating: Star tier of the gem (``1``, ``2``, or ``5``).

    Returns:
        List of rank strings in ascending upgrade order, e.g.
        ``["0", "1", "2", ..., "10"]`` for 2-star gems.

    Raises:
        ValueError: If ``star_rating`` is not ``1``, ``2``, or ``5``.
    """
    if star_rating not in (1, 2, 5):
        raise ValueError(f"Unknown star_rating: {star_rating}. Must be 1, 2, or 5.")
    table = _cost_table(star_rating)
    return sorted(
        table.keys(),
        key=lambda rank: (table[rank].required_gems, table[rank].required_gem_power),
    )


def compute_upgrade_delta(
    star_rating: int,
    from_rank: str,
    to_rank: str,
    inventory_index: int,
    gem_id: int,
) -> UpgradeDelta:
    """Compute the incremental cost and benefit of upgrading a gem one rank step.

    Args:
        star_rating: Star tier of the gem being upgraded (``2`` or ``5``).
        from_rank: The gem's current rank string (e.g. ``"5"`` or ``"4.3"``).
        to_rank: The rank the gem will reach after this upgrade step (e.g. ``"6"``).
        inventory_index: Zero-based index into the inventory list that identifies
            which specific gem copy this delta applies to.
        gem_id: Stable integer ID of the gem, used for reporting purposes.

    Returns:
        ``UpgradeDelta`` with all incremental cost and benefit fields populated.

    Raises:
        ValueError: If ``from_rank`` or ``to_rank`` is not found in the
            corresponding cost table.
    """
    table = _cost_table(star_rating)

    from_entry = table.get(from_rank)
    to_entry = table.get(to_rank)

    if from_entry is None:
        raise ValueError(f"Rank '{from_rank}' not found in {star_rating}-star cost table.")
    if to_entry is None:
        raise ValueError(f"Rank '{to_rank}' not found in {star_rating}-star cost table.")

    from_contribution = compute_contribution(star_rating, from_rank, table)
    to_contribution = compute_contribution(star_rating, to_rank, table)

    additional_gem_power = to_entry.required_gem_power - from_entry.required_gem_power
    additional_socket_power = to_contribution - from_contribution
    net_gain = additional_socket_power - additional_gem_power

    return UpgradeDelta(
        gem_id=gem_id,
        star_rating=star_rating,
        current_rank=from_rank,
        target_rank=to_rank,
        additional_gem_power=additional_gem_power,
        additional_socket_power=additional_socket_power,
        net_gain=net_gain,
        inventory_index=inventory_index,
    )


def _find_spare_indices(
    working: list[InventoryGem],
    gem_index: int,
    needed_copies: int,
    excluded_indices: frozenset[int] | None = None,
    required_rank: str | None = None,
) -> list[int] | None:
    """Find indices of the cheapest spare copies of a gem available for sacrifice.

    Searches ``working`` for other entries of the same gem name and star rating
    (excluding the gem at ``gem_index`` itself and any ``excluded_indices``) and
    returns the indices of the ``needed_copies`` cheapest ones (by contribution,
    ascending). Returns ``None`` if fewer than ``needed_copies`` spares exist.

    Sacrificing the lowest-contribution spares minimises the opportunity cost
    of losing those copies from the inventory.

    Args:
        working: Current in-memory inventory list.
        gem_index: Index of the gem that is being upgraded (excluded from spares).
        needed_copies: Number of spare copies required as sacrifice fodder.
        excluded_indices: Additional indices to exclude (e.g. gems reserved as
            materials for a direct upgrade or as sources for other prep steps).
        required_rank: When set, only copies at this exact rank are eligible as
            sacrifice fodder. Progressive upgrades require rank-1 copies.

    Returns:
        A list of exactly ``needed_copies`` indices into ``working``, sorted by
        contribution ascending, or ``None`` if not enough spares are available.
    """
    gem = working[gem_index]
    excluded = {gem_index} | (excluded_indices or frozenset())
    spares = [
        (index, working[index])
        for index in range(len(working))
        if index not in excluded
        and working[index].star_rating == gem.star_rating
        and working[index].gem_id == gem.gem_id
        and (required_rank is None or working[index].rank == required_rank)
    ]
    if len(spares) < needed_copies:
        return None
    spares.sort(key=lambda pair: pair[1].contribution)
    return [spare_index for spare_index, _ in spares[:needed_copies]]


# ---------------------------------------------------------------------------
# Upgrade potential chain data structures
# ---------------------------------------------------------------------------


@dataclass
class GemUpgradeStep:
    """One upgrade step in a gem's potential upgrade trajectory.

    Each step advances the target gem from ``from_rank`` to ``to_rank``,
    consuming fodder copies in the process.

    Attributes:
        from_rank: Rank of the target gem before this step.
        to_rank: Rank of the target gem after this step.
        gem_power_cost: Gem power drawn from the player's pool for this step.
        deltas: Ordered list of ``UpgradeDelta`` records produced by this step.
        contribution_after: Socketed power of the target gem after this step.
            Used by the downgrade walk to identify which chain to peel next.
        sub_inventory_after: Snapshot of this gem type's sub-inventory after
            the step is applied (target at upgraded rank, remaining fodder).
    """

    from_rank: str
    to_rank: str
    gem_power_cost: int
    deltas: list[UpgradeDelta]
    contribution_after: int
    sub_inventory_after: list[InventoryGem]


@dataclass
class GemUpgradeChain:
    """The complete upgrade trajectory for one ``(gem_id, star_rating)`` type.

    Attributes:
        gem_id: Stable integer ID of the gem type.
        star_rating: Star tier (``2`` or ``5``).
        base_sub_inventory: Original copies of this type before any upgrades
            (highest-ranked first). Used when materializing depth 0.
        steps: Ordered list of upgrade steps from lowest to highest rank.
            An empty list means no profitable upgrade is possible for this type.
    """

    gem_id: int
    star_rating: int
    base_sub_inventory: list[InventoryGem]
    steps: list[GemUpgradeStep]


# ---------------------------------------------------------------------------
# Public chain-building API
# ---------------------------------------------------------------------------


def compute_socket_counts(main_gems: list[MainGem]) -> dict[int, int]:
    """Return the total socket count per inventory gem star rating across all 5-star main gems.

    Sockets 0-2 of a 5-star main gem accept 2-star inventory gems.
    Sockets 3-4 accept 5-star inventory gems and only unlock at main gem rank ≥ 6.

    Args:
        main_gems: Active main gems in the optimization setup.

    Returns:
        Dict mapping star rating (``2`` and/or ``5``) to total socket count.
        Empty if there are no 5-star main gems.
    """
    counts: dict[int, int] = {}
    for main_gem in main_gems:
        if main_gem.star_rating != 5:
            continue
        for socket_index in range(main_gem.num_sockets):
            star_type = SOCKET_STAR_TYPE[5][socket_index]
            counts[star_type] = counts.get(star_type, 0) + 1
    return counts


def compute_socketable_star_ratings(main_gems: list[MainGem]) -> frozenset[int]:
    """Return which gem star ratings have at least one available socket.

    Convenience wrapper around ``compute_socket_counts``.
    """
    return frozenset(compute_socket_counts(main_gems).keys())


def build_upgrade_chains(
    inventory: list[InventoryGem],
    socket_counts: dict[int, int],
) -> tuple[list[GemUpgradeChain], list[InventoryGem]]:
    """Build upgrade trajectories for the top gem types per star, capped by socket capacity.

    For each star rating in ``socket_counts``, at most ``socket_counts[star]``
    gem types receive upgrade chains.  Types are ranked by:

    1. Highest copy contribution in the inventory (already-upgraded gems first).
    2. Total copy count (more fodder = more upgrade potential, used as tiebreaker).
    3. Gem ID (for determinism).

    Within each selected type:

    - The **highest-ranked** copy is the *upgrade target*; it cannot be
      downgraded below its initial rank (depth 0 always returns the original copies).
    - All other copies of that type serve as *fodder*.
    - The chain advances the target one rank at a time (including sub-ranks),
      consuming one rank-1 fodder copy per step, until fodder is exhausted or
      rank 10 is reached.

    Gem types beyond the socket cap, and gems of non-socketable star ratings,
    are returned as leftover and passed through to the optimizer unchanged.

    Args:
        inventory: The player's gem inventory.  Not mutated.
        socket_counts: Mapping of star rating → available socket count, as
            returned by ``compute_socket_counts``.

    Returns:
        A two-tuple ``(chains, leftover)`` where:
        - ``chains``: one ``GemUpgradeChain`` per selected gem type.
        - ``leftover``: all other copies, passed through to ``materialize_upgrades``.
    """
    socketable_star_ratings = frozenset(socket_counts.keys())
    leftover: list[InventoryGem] = [
        gem for gem in inventory if gem.star_rating not in socketable_star_ratings
    ]

    groups: dict[tuple[int, int], list[InventoryGem]] = defaultdict(list)
    for gem in inventory:
        if gem.star_rating in socketable_star_ratings:
            groups[(gem.gem_id, gem.star_rating)].append(gem)

    # For each star rating, rank gem types and select the top socket_counts[star].
    # Ranking: highest copy contribution ↓, copy count ↓, gem_id ↑.
    selected_types: set[tuple[int, int]] = set()
    candidates_by_star: dict[int, list[tuple[int, int]]] = {}
    for gem_type in groups:
        _, star_rating = gem_type
        candidates_by_star.setdefault(star_rating, []).append(gem_type)

    for star_rating, candidate_types in candidates_by_star.items():
        slot_count = socket_counts.get(star_rating, 0)
        if slot_count <= 0:
            continue
        candidate_types.sort(key=lambda gem_type: (
            -max(gem.contribution for gem in groups[gem_type]),
            -len(groups[gem_type]),
            gem_type[0],  # gem_id for determinism
        ))
        selected_types.update(candidate_types[:slot_count])

    chains: list[GemUpgradeChain] = []

    for (gem_id, star_rating), copies in groups.items():
        if (gem_id, star_rating) not in selected_types:
            leftover.extend(copies)
            continue

        # Highest-contribution copy is the target; rest are fodder.
        copies_sorted = sorted(copies, key=lambda gem: (gem.contribution, gem.gem_id), reverse=True)
        base_sub_inventory = copy.deepcopy(copies_sorted)

        # Working sub-inventory: index 0 is always the upgrade target.
        # Shallow copy suffices — InventoryGem objects are replaced wholesale,
        # never mutated in place.
        working_sub: list[InventoryGem] = list(copies_sorted)

        table = _cost_table(star_rating)
        sorted_ranks = get_sorted_ranks(star_rating)
        rank_to_position = {rank: position for position, rank in enumerate(sorted_ranks)}
        steps: list[GemUpgradeStep] = []

        while True:
            target = working_sub[0]
            current_position = rank_to_position.get(target.rank)
            if current_position is None:
                break

            # Find the next rank that consumes at least one extra copy
            # (required_gems increases). Ranks where required_gems doesn't change
            # provide zero leverage and are skipped.
            current_required_gems = table[target.rank].required_gems
            next_rank = next(
                (rank for rank in sorted_ranks[current_position + 1:]
                 if table[rank].required_gems > current_required_gems),
                None,
            )
            if next_rank is None:
                break

            fodder_needed = table[next_rank].required_gems - table[target.rank].required_gems
            sacrifice_indices = _find_spare_indices(working_sub, 0, fodder_needed, required_rank="1")
            if sacrifice_indices is None:
                break

            delta = compute_upgrade_delta(star_rating, target.rank, next_rank, 0, gem_id)

            old_gem = working_sub[0]
            new_contribution = compute_contribution(star_rating, next_rank, table)
            working_sub[0] = InventoryGem(
                gem_id=old_gem.gem_id,
                star_rating=old_gem.star_rating,
                rank=next_rank,
                quantity=old_gem.quantity,
                active_stars=old_gem.active_stars,
                contribution=new_contribution,
            )
            sacrificed_gems = [working_sub[index] for index in sacrifice_indices]
            for sacrifice_index in sorted(sacrifice_indices, reverse=True):
                working_sub.pop(sacrifice_index)

            steps.append(GemUpgradeStep(
                from_rank=old_gem.rank,
                to_rank=next_rank,
                gem_power_cost=delta.additional_gem_power,
                deltas=[UpgradeDelta(
                    gem_id=gem_id,
                    star_rating=star_rating,
                    current_rank=old_gem.rank,
                    target_rank=next_rank,
                    additional_gem_power=delta.additional_gem_power,
                    additional_socket_power=delta.additional_socket_power,
                    net_gain=delta.net_gain,
                    inventory_index=0,
                    copies_sacrificed=len(sacrifice_indices),
                    upgrade_type="partial",
                    sacrificed_gems=sacrificed_gems,
                    pre_upgrade_gem=old_gem,
                )],
                contribution_after=working_sub[0].contribution,
                sub_inventory_after=copy.deepcopy(working_sub),
            ))

        chains.append(GemUpgradeChain(
            gem_id=gem_id,
            star_rating=star_rating,
            base_sub_inventory=base_sub_inventory,
            steps=steps,
        ))

    return chains, leftover


def materialize_upgrades(
    chains: list[GemUpgradeChain],
    depths: list[int],
    leftover: list[InventoryGem],
) -> tuple[list[InventoryGem], list[UpgradeDelta], int]:
    """Realize a depth vector as a concrete inventory, delta list, and gem-power cost.

    For each chain, applies the first ``depths[i]`` upgrade steps:
    - At depth 0 the original copies are used unchanged.
    - At depth N the sub-inventory snapshot after step N-1 is used.

    The delta list is ordered to match what ``filter_upgrades_to_socketed``
    expects: within each chain, steps are in ascending-rank order.

    Args:
        chains: Upgrade trajectories from ``build_upgrade_chains``.
        depths: Per-chain depth values (``0 ≤ depths[i] ≤ len(chains[i].steps)``).
        leftover: Non-socketable copies passed through unchanged.

    Returns:
        Three-tuple ``(working, applied_deltas, total_cost)`` where:
        - ``working``: Full inventory for the optimizer (leftover + chain gems
          at their respective depths).
        - ``applied_deltas``: Flattened delta list for all applied steps.
        - ``total_cost``: Sum of ``gem_power_cost`` across all applied steps.
    """
    working: list[InventoryGem] = copy.deepcopy(leftover)
    applied_deltas: list[UpgradeDelta] = []
    total_cost = 0

    for chain, depth in zip(chains, depths):
        if depth == 0:
            working.extend(copy.deepcopy(chain.base_sub_inventory))
        else:
            working.extend(copy.deepcopy(chain.steps[depth - 1].sub_inventory_after))
            for step in chain.steps[:depth]:
                applied_deltas.extend(step.deltas)
                total_cost += step.gem_power_cost

    return working, applied_deltas, total_cost


def filter_upgrades_to_socketed(
    applied_upgrades: list[UpgradeDelta],
    gem_assignments: dict[str, list[SocketAssignment]],
) -> tuple[list[UpgradeDelta], list[tuple[list[UpgradeDelta], UpgradeDelta]], list[InventoryGem]]:
    """Return filtered upgrades, dropped operations, and gems to restore.

    Traces upgrade chains backward: if gem X is upgraded 3→4→5 and rank 5 is
    socketed, all steps are kept.  Upgrades for gems that are never socketed
    are dropped.

    Uses a Counter to handle multiple copies of identically-named gems correctly.

    Returns:
        A three-tuple of:
        - ``filtered_upgrades``: only the upgrades whose target ends up socketed.
        - ``dropped_ops``: the dropped ``(preps, main_delta)`` operations in
          original order.  Callers should process these in *reverse* order when
          reverting ranks in the display inventory.
        - ``gems_to_restore``: consumed/sacrificed gem copies from dropped
          operations, at their *pre-upgrade* ranks, to be appended to the
          display inventory.
    """
    # Count each (gem_id, star_rating, rank) that appears in a socket.
    needed: Counter[tuple[int, int, str]] = Counter()
    for assignments in gem_assignments.values():
        for assignment in assignments:
            if assignment.gem is not None:
                needed[(assignment.gem.gem_id, assignment.gem.star_rating, assignment.gem.rank)] += 1

    # Group upgrades into operations: (preparation_steps, main_delta).
    # Preparation deltas always immediately precede the direct delta they serve.
    operations: list[tuple[list[UpgradeDelta], UpgradeDelta]] = []
    current_preps: list[UpgradeDelta] = []
    for delta in applied_upgrades:
        if delta.upgrade_type == "preparation":
            current_preps.append(delta)
        else:
            operations.append((current_preps, delta))
            current_preps = []

    # Walk operations in reverse to trace chains.
    relevant: list[bool] = [False] * len(operations)
    for operation_index in range(len(operations) - 1, -1, -1):
        _, main_delta = operations[operation_index]
        key = (main_delta.gem_id, main_delta.star_rating, main_delta.target_rank)
        if needed[key] > 0:
            needed[key] -= 1
            relevant[operation_index] = True
            # The pre-upgrade state feeds into this step, so it may be needed earlier.
            pre_key = (main_delta.gem_id, main_delta.star_rating, main_delta.current_rank)
            needed[pre_key] += 1

    filtered: list[UpgradeDelta] = []
    dropped_ops: list[tuple[list[UpgradeDelta], UpgradeDelta]] = []
    gems_to_restore: list[InventoryGem] = []

    for operation_index, (preps, main_delta) in enumerate(operations):
        if relevant[operation_index]:
            filtered.extend(preps)
            filtered.append(main_delta)
        else:
            dropped_ops.append((preps, main_delta))
            # Collect consumed gems at their *original* ranks.
            if preps:
                # Direct upgrade with prep steps: material gems were upgraded by
                # prep steps before being consumed.  Restore them at their
                # pre-prep ranks via pre_upgrade_gem rather than at their
                # post-prep ranks stored in main_delta.sacrificed_gems.
                prepped_keys = {
                    (prep.gem_id, prep.star_rating, prep.target_rank) for prep in preps
                }
                for sacrificed_gem in main_delta.sacrificed_gems:
                    if (sacrificed_gem.gem_id, sacrificed_gem.star_rating, sacrificed_gem.rank) not in prepped_keys:
                        gems_to_restore.append(sacrificed_gem)  # non-prepped material
                for prep_delta in preps:
                    if prep_delta.pre_upgrade_gem is not None:
                        gems_to_restore.append(prep_delta.pre_upgrade_gem)
                    gems_to_restore.extend(prep_delta.sacrificed_gems)
            else:
                gems_to_restore.extend(main_delta.sacrificed_gems)

    return filtered, dropped_ops, gems_to_restore
