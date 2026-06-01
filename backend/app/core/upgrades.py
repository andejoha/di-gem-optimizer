"""Upgrade optimization for the gem resonance optimizer.

Provides logic to discover profitable gem upgrades (for both inventory and
socketed gems), apply them in-memory, and re-run the optimizer to determine
whether the upgraded configuration reduces the player's overall gem-power cost.

Two upgrade methods are supported and automatically compared each iteration:

**Partial rank upgrades** (original system)
    Step through sub-ranks one at a time (e.g., 7 → 7.1 → 7.2 → … → 8),
    consuming same-name gem copies of any rank plus gem power from the
    player's pool.

**Direct rank upgrades** (new system)
    Jump directly from one whole rank to the next (e.g., 7 → 8) by consuming
    same-name gems at specific required tiers (rank 1, 3, or 5) as materials.
    For target ranks 5 and above the direct upgrade itself costs **zero gem
    power**; only material gems are consumed.  The optimizer may need to
    prepare materials by first partial-upgrading lower-ranked copies to the
    required tiers, which does cost gem power.

The key economic identity for a partial upgrade from rank A to rank B::

    additional_gem_power    = required_gem_power[B] - required_gem_power[A]
    additional_socket_power = contribution[B] - contribution[A]
    net_gain                = additional_socket_power - additional_gem_power
                            = (required_gems[B] - required_gems[A]) * BASE_POWER[star]

For a direct upgrade (rank 5+ target)::

    additional_gem_power    = 0  (the rank jump draws nothing from the player's pool)
    additional_socket_power = contribution[target] - contribution[current]
    net_gain                = (required_gems[target] - required_gems[current]) * BASE_POWER[star]

``net_gain`` uses the same leverage formula as partial upgrades so both paths
are directly comparable in the UI.  ``additional_gem_power`` is kept at 0 so
that the cost accounting in the routes layer (``filtered_cost``) remains correct.

Public API:
  - ``get_sorted_ranks``: ordered rank strings for a star rating.
  - ``compute_upgrade_delta``: single partial upgrade step economics.
  - ``find_all_upgrades``: all candidate single-step partial upgrades.
  - ``apply_upgrades_greedy``: greedily select and apply profitable upgrades.
    Includes a pre-pass (``_apply_free_upgrades``) that first advances gems in
    5-star sockets to their "free ceiling" rank (net_gain == 0, no copies
    consumed), unlocking more efficient subsequent paid upgrades.
"""

import copy
from collections import Counter

from app.core.config import BASE_POWER
from app.core.data import COST_1STAR, COST_2STAR, COST_5STAR, DIRECT_COST_2STAR, DIRECT_COST_5STAR
from app.core.models import (
    DirectUpgradePlan,
    InventoryGem,
    MainGem,
    MaterialPreparationStep,
    OptimizationResult,
    SocketAssignment,
    UpgradeDelta,
)
from app.core.progress import NullReporter, ProgressReporter
from app.core.rules import compute_contribution


def get_sorted_ranks(star_rating: int) -> list[str]:
    """Return rank strings for the given star rating, ordered from lowest to highest.

    Ranks are sorted by ``(required_gems, required_gem_power)`` rather than
    lexicographically, which correctly orders labels like ``"6.9"`` before
    ``"6.10"`` (where a naive lexicographic sort would fail).

    Args:
        star_rating: Star tier of the gem (``2`` or ``5``).

    Returns:
        List of rank strings in ascending upgrade order, e.g.
        ``["0", "1", "2", ..., "10"]`` for 2-star gems.

    Raises:
        ValueError: If ``star_rating`` is not ``2`` or ``5``.
    """
    if star_rating == 1:
        table = COST_1STAR
    elif star_rating == 2:
        table = COST_2STAR
    elif star_rating == 5:
        table = COST_5STAR
    else:
        raise ValueError(f"Unknown star_rating: {star_rating}. Must be 1, 2, or 5.")

    return sorted(
        table.keys(),
        key=lambda r: (table[r].required_gems, table[r].required_gem_power),
    )


def compute_upgrade_delta(
    star_rating: int,
    from_rank: str,
    to_rank: str,
    inventory_index: int,
    gem_id: int,
) -> UpgradeDelta:
    """Compute the incremental cost and benefit of upgrading a gem one rank step.

    Uses the upgrade cost tables and contribution formula to determine exactly
    how much gem power the player must spend (``additional_gem_power``) and how
    much extra socketed power the gem will contribute (``additional_socket_power``)
    after the upgrade.

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
    if star_rating == 1:
        table = COST_1STAR
    elif star_rating == 2:
        table = COST_2STAR
    else:
        table = COST_5STAR

    from_entry = table.get(from_rank)
    to_entry = table.get(to_rank)

    if from_entry is None:
        raise ValueError(f"Rank '{from_rank}' not found in {star_rating}-star cost table.")
    if to_entry is None:
        raise ValueError(f"Rank '{to_rank}' not found in {star_rating}-star cost table.")

    from_contrib = compute_contribution(star_rating, from_rank, table)
    to_contrib = compute_contribution(star_rating, to_rank, table)

    additional_gem_power = to_entry.required_gem_power - from_entry.required_gem_power
    additional_socket_power = to_contrib - from_contrib
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


def find_all_upgrades(inventory: list[InventoryGem]) -> list[list[UpgradeDelta]]:
    """Return all theoretically possible single-step upgrade options for every gem.

    For each gem, enumerates every rank above its current rank as a potential
    single-step upgrade target. The caller (e.g. ``apply_upgrades_greedy``) is
    responsible for composing these into multi-step upgrade chains by iterating
    on the updated inventory.

    Only upgrades with ``net_gain > 0`` are included. Upgrades with
    ``net_gain == 0`` (e.g. rank 1 → 2 for 2-star gems, where no additional
    copies are consumed) are excluded because they cost gem power without
    providing any net leverage.

    .. note::
        This function does **not** check whether enough spare copies of the gem
        exist in ``inventory`` to serve as sacrifice fodder. Copy-availability
        feasibility is enforced separately by ``_find_best_feasible_upgrade``
        inside ``apply_upgrades_greedy``.

    Args:
        inventory: List of ``InventoryGem`` instances representing the player's
            current in-memory gem pool.

    Returns:
        A list parallel to ``inventory``, where ``result[i]`` is a list of
        ``UpgradeDelta`` objects representing all single-step upgrade options for
        ``inventory[i]``, or an empty list if no profitable upgrades exist.
    """
    result: list[list[UpgradeDelta]] = []

    for idx, gem in enumerate(inventory):
        sorted_ranks = get_sorted_ranks(gem.star_rating)

        try:
            current_pos = sorted_ranks.index(gem.rank)
        except ValueError:
            result.append([])
            continue

        gem_upgrades: list[UpgradeDelta] = []
        for next_rank in sorted_ranks[current_pos + 1:]:
            delta = compute_upgrade_delta(
                star_rating=gem.star_rating,
                from_rank=gem.rank,
                to_rank=next_rank,
                inventory_index=idx,
                gem_id=gem.gem_id,
            )
            if delta.net_gain > 0 and delta.additional_socket_power > 0:
                gem_upgrades.append(delta)

        result.append(gem_upgrades)

    return result


def _try_parse_whole_rank(rank_str: str) -> int | None:
    """Return the rank as an integer if it is a whole rank, otherwise ``None``.

    A whole rank has no decimal sub-rank suffix (e.g. ``"7"`` is whole,
    ``"7.3"`` is not).

    Args:
        rank_str: Rank string to parse (e.g. ``"7"`` or ``"7.3"``).

    Returns:
        Integer rank value, or ``None`` if the string contains a sub-rank.
    """
    if "." in rank_str:
        return None
    try:
        return int(rank_str)
    except ValueError:
        return None


def _compute_preparation_cost(
    star_rating: int,
    from_rank: str,
    to_rank: str,
) -> tuple[int, int]:
    """Compute the partial-rank upgrade cost for preparing a material gem.

    Returns the incremental gem power and copy count required to upgrade a gem
    from ``from_rank`` to ``to_rank`` using the partial-rank system.

    Args:
        star_rating: Star tier of the gem (``2`` or ``5``).
        from_rank: Current rank string (e.g. ``"1"``).
        to_rank: Target material rank string (``"1"``, ``"3"``, or ``"5"``).

    Returns:
        A ``(gem_power_cost, copies_consumed)`` tuple.
    """
    if star_rating == 1:
        table = COST_1STAR
    elif star_rating == 2:
        table = COST_2STAR
    else:
        table = COST_5STAR
    from_entry = table[from_rank]
    to_entry = table[to_rank]
    gp_cost = to_entry.required_gem_power - from_entry.required_gem_power
    copies = to_entry.required_gems - from_entry.required_gems
    return gp_cost, copies


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
    exclude = {gem_index} | (excluded_indices or frozenset())
    spares = [
        (i, working[i])
        for i in range(len(working))
        if i not in exclude
        and working[i].star_rating == gem.star_rating
        and working[i].gem_id == gem.gem_id
        and (required_rank is None or working[i].rank == required_rank)
    ]
    if len(spares) < needed_copies:
        return None
    spares.sort(key=lambda pair: pair[1].contribution)
    return [idx for idx, _ in spares[:needed_copies]]


def compute_direct_upgrade_plan(
    working: list[InventoryGem],
    gem_index: int,
    target_whole_rank: int,
    available_power: int,
    total_upgrade_cost: int,
    estimated_residual: int,
) -> DirectUpgradePlan | None:
    """Plan a direct rank upgrade for one gem, including any needed material prep.

    A direct upgrade jumps from one whole rank to the next (e.g. 7 → 8) using
    same-name gems at specific material tiers (rank 1, 3, or 5) as consumables.
    For target ranks ≥ 5 the upgrade itself costs zero gem power; lower-ranked
    gems may need to be partially upgraded first (incurring gem power costs).

    The function:

    1. Rejects gems not at a whole rank or upgrades not targeting rank ≥ 5.
    2. Computes the incremental material requirements from the direct cost table.
    3. Allocates existing inventory copies as materials where possible.
    4. Plans partial-rank preparation upgrades for any missing materials.
    5. Verifies that enough spare copies exist for all preparation sacrifices.
    6. Performs a budget feasibility check.

    Args:
        working: Current in-memory inventory list.
        gem_index: Index of the gem to upgrade.
        target_whole_rank: Target rank (integer, must equal current rank + 1).
        available_power: Player's total gem power pool.
        total_upgrade_cost: Gem power already committed to upgrades this session.
        estimated_residual: Current optimistic estimate of residual cost.

    Returns:
        A ``DirectUpgradePlan`` if the upgrade is feasible and beneficial, or
        ``None`` if the gem is ineligible, resources are insufficient, or the
        upgrade would exceed the budget.
    """
    gem = working[gem_index]

    # Only whole ranks can use the direct upgrade system.
    current_whole_rank = _try_parse_whole_rank(gem.rank)
    if current_whole_rank is None:
        return None

    # Only single-step transitions.
    if target_whole_rank != current_whole_rank + 1:
        return None

    # Ranks 0-4 use the same cost as partial upgrades; no benefit to treating
    # them separately here.
    if target_whole_rank < 5:
        return None

    # Retrieve incremental material requirements.
    direct_table = DIRECT_COST_2STAR if gem.star_rating == 2 else DIRECT_COST_5STAR
    if current_whole_rank not in direct_table or target_whole_rank not in direct_table:
        return None

    from_mats = direct_table[current_whole_rank]
    to_mats = direct_table[target_whole_rank]
    needed: dict[int, int] = {
        r: to_mats[r] - from_mats[r]
        for r in (1, 3, 5)
        if to_mats[r] - from_mats[r] > 0
    }

    if not needed:
        return None  # No materials required (data gap — should not occur).

    cost_table = COST_1STAR if gem.star_rating == 1 else (COST_2STAR if gem.star_rating == 2 else COST_5STAR)

    # Build list of candidate same-id gems (sorted cheapest-first so we
    # prefer low-contribution items when allocating materials and sacrifices).
    same_name: list[tuple[int, InventoryGem]] = sorted(
        [
            (i, working[i])
            for i in range(len(working))
            if i != gem_index
            and working[i].star_rating == gem.star_rating
            and working[i].gem_id == gem.gem_id
        ],
        key=lambda p: p[1].contribution,
    )

    # Allocate materials and plan preparation, processing highest-tier first
    # (rank 5 before rank 3 before rank 1) so expensive material gems are
    # allocated before cheaper ones that might otherwise be consumed as sacrifices.
    reserved: set[int] = {gem_index}
    material_indices: list[int] = []
    preparation_steps: list[MaterialPreparationStep] = []
    total_prep_gp: int = 0
    total_prep_copies: int = 0

    for mat_rank in sorted(needed.keys(), reverse=True):
        count = needed[mat_rank]
        mat_rank_str = str(mat_rank)

        for _ in range(count):
            # Prefer an existing gem already at the exact required rank.
            found_exact: bool = False
            for idx, g in same_name:
                if idx not in reserved and g.rank == mat_rank_str:
                    material_indices.append(idx)
                    reserved.add(idx)
                    found_exact = True
                    break

            if found_exact:
                continue

            # No exact match: find the cheapest whole-rank gem we can upgrade
            # to mat_rank via partial ranks.
            best_prep: tuple[int, InventoryGem, int, int] | None = None
            best_prep_gp: float = float("inf")

            for idx, g in same_name:
                if idx in reserved:
                    continue
                g_whole = _try_parse_whole_rank(g.rank)
                if g_whole is None or g_whole >= mat_rank:
                    continue  # Sub-rank or already at/above required tier.
                prep_gp, prep_copies = _compute_preparation_cost(
                    gem.star_rating, g.rank, mat_rank_str
                )
                if prep_gp < best_prep_gp:
                    best_prep_gp = prep_gp
                    best_prep = (idx, g, prep_gp, prep_copies)

            if best_prep is None:
                return None  # Cannot satisfy this material requirement.

            idx, g, prep_gp, prep_copies = best_prep
            material_indices.append(idx)
            reserved.add(idx)
            preparation_steps.append(MaterialPreparationStep(
                source_inventory_index=idx,
                source_rank=g.rank,
                target_material_rank=mat_rank_str,
                gem_power_cost=prep_gp,
                copies_consumed=prep_copies,
            ))
            total_prep_gp += prep_gp
            total_prep_copies += prep_copies

    # Verify enough spare copies exist for all preparation sacrifices combined.
    available_spare_indices: list[int] = [
        idx for idx, _ in same_name if idx not in reserved
    ]
    if len(available_spare_indices) < total_prep_copies:
        return None

    # Compute contribution gain from the upgrade.
    old_contrib = compute_contribution(gem.star_rating, gem.rank, cost_table)
    new_contrib = compute_contribution(gem.star_rating, str(target_whole_rank), cost_table)
    additional_socket_power = new_contrib - old_contrib

    if additional_socket_power <= 0:
        return None  # Upgrading provides no socketed power gain.

    # Estimate contribution lost to material consumption.  Use each material's
    # current (pre-prep) contribution so we don't double-count the GP already
    # tracked in total_prep_gp: the prep cost pays for the contribution increase
    # from rank-1 to rank-3, so counting the post-prep contribution would charge
    # that increase twice.
    material_contrib_estimate: int = sum(working[mi].contribution for mi in material_indices)

    # Estimate contribution lost to preparation sacrifices (cheapest available).
    prep_spare_contrib: int = sum(
        working[i].contribution
        for i in available_spare_indices[:total_prep_copies]
    )

    total_sacrificed_contribution: int = material_contrib_estimate + prep_spare_contrib
    net_gain: int = additional_socket_power - total_prep_gp

    # Budget check (mirroring the partial upgrade budget logic).
    new_estimated_residual = max(
        0,
        estimated_residual
        - additional_socket_power
        + total_sacrificed_contribution,
    )
    # Allow the budget to exceed available_power by up to net_gain: the ILP
    # re-solve typically captures at least this much leverage through better
    # assignment of the consolidated high-contribution gem.  The post-hoc
    # improvement check in routes.py reverts to baseline if it doesn't pan out.
    # In shortfall mode use current obligation as the ceiling (same rationale
    # as the partial-upgrade gate in _find_best_feasible_upgrade).
    effective_budget = max(available_power, total_upgrade_cost + estimated_residual)
    if total_upgrade_cost + total_prep_gp + new_estimated_residual > effective_budget + net_gain:
        return None

    return DirectUpgradePlan(
        gem_id=gem.gem_id,
        star_rating=gem.star_rating,
        current_rank=gem.rank,
        target_rank=str(target_whole_rank),
        upgrade_index=gem_index,
        material_indices=material_indices,
        preparation_steps=preparation_steps,
        total_gem_power_cost=total_prep_gp,
        additional_socket_power=additional_socket_power,
        net_gain=net_gain,
        material_sacrificed_contribution=material_contrib_estimate,
    )


def _find_best_feasible_upgrade(
    working: list[InventoryGem],
    available_power: int,
    total_upgrade_cost: int,
    estimated_residual: int,
    socketable_star_ratings: frozenset[int] | None = None,
    baseline_socketed_types: frozenset[tuple[int, int]] | None = None,
) -> tuple[UpgradeDelta, int, list[int]] | None:
    """Find the highest-efficiency feasible single-step partial upgrade.

    An upgrade from rank A to rank B for gem ``i`` is *feasible* when:

    1. **Copy availability**: ``required_gems[B] - required_gems[A]`` spare copies
       of the same gem exist elsewhere in ``working``.
    2. **Budget**: the combined effective cost after the upgrade fits within
       ``available_power``::

           total_upgrade_cost + delta.additional_gem_power
           + max(0, estimated_residual - delta.additional_socket_power)
           <= available_power

       Using ``additional_socket_power`` (the full contribution gain of the
       upgraded gem) rather than the narrower ``net_gain`` gives an optimistic
       residual estimate; the final ILP re-solve validates the true outcome.
    3. **Net leverage**: ``net_gain > 0`` (upgrade consumes at least one extra
       copy, providing leverage beyond the raw gem-power cost).

    Candidates are ranked by efficiency: ``net_gain / additional_gem_power``
    (infinite for zero-cost upgrades).

    Args:
        working: Current in-memory inventory list.
        available_power: Player's total gem power pool.
        total_upgrade_cost: Gem power already committed to upgrades this session.
        estimated_residual: Current optimistic estimate of the residual cost
            after all upgrades applied so far.

    Returns:
        A three-tuple ``(delta, upgrade_index, sacrifice_indices)`` for the best
        candidate, or ``None`` if no feasible upgrade exists.
    """
    candidates: list[tuple[UpgradeDelta, int, list[int], float]] = []

    for idx, gem in enumerate(working):
        if socketable_star_ratings is not None and gem.star_rating not in socketable_star_ratings:
            continue
        if baseline_socketed_types is not None and (gem.gem_id, gem.star_rating) not in baseline_socketed_types:
            continue
        sorted_ranks = get_sorted_ranks(gem.star_rating)
        try:
            current_pos = sorted_ranks.index(gem.rank)
        except ValueError:
            continue

        if gem.star_rating == 1:
            table = COST_1STAR
        elif gem.star_rating == 2:
            table = COST_2STAR
        else:
            table = COST_5STAR

        for next_rank in sorted_ranks[current_pos + 1:]:
            delta_copies = (
                table[next_rank].required_gems - table[gem.rank].required_gems
            )

            # Check copy availability: need delta_copies spare R1 copies.
            # The game only allows rank-1 copies as sacrifice fodder for
            # progressive upgrades.
            sacrifice_indices: list[int] = []
            if delta_copies > 0:
                found = _find_spare_indices(working, idx, delta_copies, required_rank="1")
                if found is None:
                    continue  # Not enough spare R1 copies — infeasible.
                sacrifice_indices = found

            delta = compute_upgrade_delta(
                star_rating=gem.star_rating,
                from_rank=gem.rank,
                to_rank=next_rank,
                inventory_index=idx,
                gem_id=gem.gem_id,
            )

            # Exclude upgrades with zero or negative net gain.
            if delta.net_gain <= 0 or delta.additional_socket_power <= 0:
                continue

            # Budget check: account for the contribution lost when spare copies
            # are consumed as sacrifice fodder.  If all sacrificed copies were
            # in 5-star sockets their removal would increase residual cost, so
            # we must include that opportunity cost here to avoid approving
            # upgrades that make the overall result worse.
            sacrificed_contribution = sum(
                working[i].contribution for i in sacrifice_indices
            )
            new_estimated_residual = max(
                0,
                estimated_residual - delta.additional_socket_power + sacrificed_contribution,
            )
            # Allow a small budget overshoot bounded by the upgrade's net_gain:
            # the ILP re-solve captures at least this leverage through better
            # assignment.  Post-hoc validation in routes.py reverts if it doesn't.
            # In shortfall mode the current obligation (upgrade cost + residual)
            # already exceeds available_power, so use obligation as the ceiling
            # instead -- any upgrade that reduces obligation is still admissible.
            effective_budget = max(available_power, total_upgrade_cost + estimated_residual)
            if (
                total_upgrade_cost
                + delta.additional_gem_power
                + new_estimated_residual
                > effective_budget + delta.net_gain
            ):
                continue

            eff = (
                float("inf")
                if delta.additional_gem_power == 0
                else delta.net_gain / delta.additional_gem_power
            )
            candidates.append((delta, idx, sacrifice_indices, eff))

    if not candidates:
        return None

    # Primary sort: efficiency (descending). Tiebreaker: additional_socket_power
    # (descending) so larger upgrades are preferred when efficiency is equal
    # (e.g. R1->R3 over R1->R2 when both have net_gain=0).
    candidates.sort(key=lambda c: (c[3], c[0].additional_socket_power), reverse=True)
    best_delta, best_idx, best_sacrifice, _ = candidates[0]
    return best_delta, best_idx, best_sacrifice


def _find_best_feasible_direct_upgrade(
    working: list[InventoryGem],
    available_power: int,
    total_upgrade_cost: int,
    estimated_residual: int,
    socketable_star_ratings: frozenset[int] | None = None,
    baseline_socketed_types: frozenset[tuple[int, int]] | None = None,
) -> DirectUpgradePlan | None:
    """Find the highest-efficiency feasible direct rank upgrade in the inventory.

    Scans every gem at a whole rank ≥ 4 and evaluates a direct upgrade to the
    next whole rank (e.g. 4 → 5, 7 → 8).  Only target ranks ≥ 5 are considered
    since ranks below that share costs with the partial system.

    Candidates are ranked by efficiency: ``net_gain / total_gem_power_cost``
    (infinite when preparation costs zero gem power).

    Args:
        working: Current in-memory inventory list.
        available_power: Player's total gem power pool.
        total_upgrade_cost: Gem power already committed to upgrades this session.
        estimated_residual: Current optimistic estimate of the residual cost.

    Returns:
        The ``DirectUpgradePlan`` with the highest efficiency, or ``None`` if no
        feasible direct upgrade exists.
    """
    best_plan: DirectUpgradePlan | None = None
    best_eff: float = float("-inf")
    best_socket_power: int = 0

    for idx in range(len(working)):
        gem = working[idx]
        if socketable_star_ratings is not None and gem.star_rating not in socketable_star_ratings:
            continue
        if baseline_socketed_types is not None and (gem.gem_id, gem.star_rating) not in baseline_socketed_types:
            continue
        whole_rank = _try_parse_whole_rank(gem.rank)
        if whole_rank is None:
            continue

        target = whole_rank + 1
        if target < 5:
            continue  # Only meaningful for target rank ≥ 5.

        # Direct upgrades are only defined for 2-star and 5-star gems.
        if gem.star_rating not in (2, 5):
            continue
        direct_table = DIRECT_COST_2STAR if gem.star_rating == 2 else DIRECT_COST_5STAR
        if target not in direct_table:
            continue  # Beyond max rank.

        plan = compute_direct_upgrade_plan(
            working=working,
            gem_index=idx,
            target_whole_rank=target,
            available_power=available_power,
            total_upgrade_cost=total_upgrade_cost,
            estimated_residual=estimated_residual,
        )

        if plan is None or plan.net_gain <= 0:
            continue

        eff = (
            float("inf")
            if plan.total_gem_power_cost == 0
            else plan.net_gain / plan.total_gem_power_cost
        )

        if eff > best_eff or (eff == best_eff and plan.additional_socket_power > best_socket_power):
            best_eff = eff
            best_plan = plan
            best_socket_power = plan.additional_socket_power

    return best_plan


def _execute_direct_upgrade(
    working: list[InventoryGem],
    plan: DirectUpgradePlan,
    applied: list[UpgradeDelta],
    total_upgrade_cost: int,
    estimated_residual: int,
) -> tuple[int, int]:
    """Execute a direct upgrade plan against the working inventory.

    Mutates ``working`` in place:

    1. For each preparation step: upgrades the source gem's rank and removes
       its sacrifice copies.
    2. Removes all material gems.
    3. Upgrades the main gem to the target rank.

    Appends one ``UpgradeDelta`` per preparation step (``upgrade_type="preparation"``)
    and one for the direct upgrade itself (``upgrade_type="direct"``) to ``applied``.

    Index shifting from removals is handled by tracking all adjustments through
    a local adjustment function so that every stored index remains valid
    throughout execution.

    Args:
        working: In-memory inventory list (mutated in place).
        plan: The ``DirectUpgradePlan`` to execute.
        applied: List to append applied ``UpgradeDelta`` records to.
        total_upgrade_cost: Running GP total (updated and returned).
        estimated_residual: Running residual estimate (updated and returned).

    Returns:
        Updated ``(total_upgrade_cost, estimated_residual)`` after execution.
    """
    cost_table = COST_1STAR if plan.star_rating == 1 else (COST_2STAR if plan.star_rating == 2 else COST_5STAR)

    # Local mutable index tracking — adjusted after every pop() so all
    # subsequent index lookups remain correct.
    upgrade_idx: int = plan.upgrade_index
    material_idxs: list[int] = list(plan.material_indices)
    prep_source_idxs: list[int] = [p.source_inventory_index for p in plan.preparation_steps]

    def _adjust(removed: int) -> None:
        """Decrement every tracked index that is above the removed position."""
        nonlocal upgrade_idx
        if upgrade_idx > removed:
            upgrade_idx -= 1
        for k in range(len(material_idxs)):
            if material_idxs[k] > removed:
                material_idxs[k] -= 1
        for k in range(len(prep_source_idxs)):
            if prep_source_idxs[k] > removed:
                prep_source_idxs[k] -= 1

    # Capture material contributions before Step 1 modifies any prepped gems.
    # Using pre-prep values avoids double-counting: the prep GP cost already
    # accounts for the contribution increase, so the residual estimate should
    # only lose the original contribution, not the inflated post-prep value.
    original_material_contrib: int = sum(working[mi].contribution for mi in material_idxs)

    # Step 1: Execute preparation steps.
    all_reserved: frozenset[int] = frozenset(material_idxs) | frozenset(prep_source_idxs) | {upgrade_idx}

    for step_num, prep in enumerate(plan.preparation_steps):
        prep_idx = prep_source_idxs[step_num]

        # Find sacrifice copies fresh, excluding reserved gems.
        reserved_now: frozenset[int] = (
            frozenset(material_idxs)
            | frozenset(prep_source_idxs)
            | {upgrade_idx}
        )
        sacrifices: list[int] = []
        if prep.copies_consumed > 0:
            found = _find_spare_indices(
                working, prep_idx, prep.copies_consumed,
                excluded_indices=reserved_now, required_rank="1",
            )
            if found is None:
                # Plan became infeasible after earlier steps shifted the
                # inventory.  Skip this prep step — the upgrade will proceed
                # with whatever materials are available.
                continue
            sacrifices = found

        # Upgrade the prep gem in place.
        old_gem = working[prep_idx]
        new_contrib = compute_contribution(plan.star_rating, prep.target_material_rank, cost_table)
        working[prep_idx] = InventoryGem(
            gem_id=old_gem.gem_id,
            star_rating=old_gem.star_rating,
            rank=prep.target_material_rank,
            quantity=old_gem.quantity,
            active_stars=old_gem.active_stars,
            contribution=new_contrib,
        )

        additional_socket_power = new_contrib - old_gem.contribution
        # Capture sacrifice copies before removal.
        prep_sacrificed = [working[si] for si in sacrifices]
        applied.append(UpgradeDelta(
            gem_id=old_gem.gem_id,
            star_rating=plan.star_rating,
            current_rank=prep.source_rank,
            target_rank=prep.target_material_rank,
            additional_gem_power=prep.gem_power_cost,
            additional_socket_power=additional_socket_power,
            net_gain=additional_socket_power - prep.gem_power_cost,
            inventory_index=prep_idx,
            copies_sacrificed=len(sacrifices),
            upgrade_type="preparation",
            sacrificed_gems=prep_sacrificed,
            pre_upgrade_gem=old_gem,
        ))
        total_upgrade_cost += prep.gem_power_cost

        # Remove sacrifice copies highest-index-first, adjusting tracked indices.
        for si in sorted(sacrifices, reverse=True):
            working.pop(si)
            _adjust(si)

    # Step 2: Remove material gems (highest-index-first).
    sacrificed_material_contrib: int = original_material_contrib
    consumed_materials = [working[mi] for mi in material_idxs]
    for mi in sorted(material_idxs, reverse=True):
        working.pop(mi)
        _adjust(mi)

    # Step 3: Upgrade the main gem.
    old_gem = working[upgrade_idx]
    new_contrib = compute_contribution(plan.star_rating, plan.target_rank, cost_table)
    working[upgrade_idx] = InventoryGem(
        gem_id=old_gem.gem_id,
        star_rating=old_gem.star_rating,
        rank=plan.target_rank,
        quantity=old_gem.quantity,
        active_stars=old_gem.active_stars,
        contribution=new_contrib,
    )

    additional_socket_power = new_contrib - old_gem.contribution
    # net_gain = delta_copies * BASE_POWER[star], matching the partial upgrade
    # formula.  additional_gem_power stays 0 because no GP is drawn from the
    # player's pool for the direct rank jump itself (only prep steps cost GP).
    _from_entry = cost_table[old_gem.rank]
    _to_entry = cost_table[plan.target_rank]
    _delta_copies = _to_entry.required_gems - _from_entry.required_gems
    applied.append(UpgradeDelta(
        gem_id=plan.gem_id,
        star_rating=plan.star_rating,
        current_rank=plan.current_rank,
        target_rank=plan.target_rank,
        additional_gem_power=0,
        additional_socket_power=additional_socket_power,
        net_gain=_delta_copies * BASE_POWER[plan.star_rating],
        inventory_index=upgrade_idx,
        copies_sacrificed=len(plan.material_indices),
        upgrade_type="direct",
        sacrificed_gems=consumed_materials,
        pre_upgrade_gem=old_gem,
    ))

    # Update estimated residual: gain from upgrade, lose from consumed materials.
    estimated_residual = max(
        0,
        estimated_residual
        - additional_socket_power
        + sacrificed_material_contrib,
    )

    return total_upgrade_cost, estimated_residual


def _select_high_potential_types(
    inventory: list[InventoryGem],
    socketable_star_ratings: frozenset[int],
) -> frozenset[tuple[int, int]]:
    """Pick the highest-potential ``(gem_id, star_rating)`` per socketable star.

    Potential is ``(copies - 1) * BASE_POWER[star]``: the leverage gained by
    consuming spare copies as upgrade fodder.  A gem type needs at least two
    inventory copies to be eligible (one to upgrade, one as fodder).  Ties
    break on lower ``gem_id`` for reproducibility.
    """
    copies_by_type: Counter[tuple[int, int]] = Counter()
    for gem in inventory:
        copies_by_type[(gem.gem_id, gem.star_rating)] += 1

    best_per_star: dict[int, tuple[int, int]] = {}
    for (gid, sr), count in copies_by_type.items():
        if sr not in socketable_star_ratings or count < 2:
            continue
        potential = (count - 1) * BASE_POWER[sr]
        cur = best_per_star.get(sr)
        if cur is None:
            best_per_star[sr] = (gid, sr)
            continue
        cur_potential = (copies_by_type[cur] - 1) * BASE_POWER[sr]
        if potential > cur_potential or (potential == cur_potential and gid < cur[0]):
            best_per_star[sr] = (gid, sr)

    return frozenset(best_per_star.values())


def _apply_free_upgrades(
    working: list[InventoryGem],
    main_gems: list[MainGem],
    baseline_result: OptimizationResult,
    applied: list[UpgradeDelta],
    available_power: int,
    total_upgrade_cost: int,
    estimated_residual: int,
) -> tuple[int, int]:
    """Apply zero-net-gain upgrades to gems assigned to 5-star main gem sockets.

    For each gem that the baseline placed into a 5-star main gem's socket,
    advances it to its "free ceiling": the highest rank reachable without
    consuming any extra copies (i.e. ``required_gems`` stays constant).  For
    2-star gems starting at rank 1 this ceiling is rank 3; for 5-star gems
    starting at rank 1 it is rank 2.

    These upgrades have ``net_gain == 0``: the gem-power cost is exactly
    recovered via the upgraded gem's higher contribution when it reduces the
    5-star main gem's awakening residual.  Applying them before the main
    greedy loop reveals more efficient subsequent paid upgrades — e.g., the
    rank 3→4 step for a 2-star gem has efficiency 4/25 = 0.16, compared with
    only 4/45 = 0.09 for the direct rank 1→4 path.

    A budget check (same formula as ``_find_best_feasible_upgrade``) guards
    against the edge case where the residual is already near zero and the
    upgrade would cost more gem power than it saves.

    Args:
        working: In-memory inventory to mutate in place.
        main_gems: All active main gems; used to identify 5-star slots.
        baseline_result: Optimization result before any upgrades; provides the
            baseline socket assignments that guide which gems to free-upgrade.
        applied: Upgrade log to append new ``UpgradeDelta`` entries to.
        available_power: Player's gem power pool (for budget check).
        total_upgrade_cost: Gem power already committed to upgrades.
        estimated_residual: Current optimistic residual estimate.

    Returns:
        Updated ``(total_upgrade_cost, estimated_residual)`` pair.
    """
    five_star_slots = {mg.slot_name for mg in main_gems if mg.star_rating == 5}

    # Count how many times each (gem_id, star_rating, rank) appears in 5-star sockets.
    gems_to_free_upgrade: Counter[tuple[int, int, str]] = Counter()
    for slot_name, assignments in baseline_result.gem_assignments.items():
        if slot_name not in five_star_slots:
            continue
        for assignment in assignments:
            if assignment.gem is not None and assignment.copy_id >= 0:
                g = assignment.gem
                gems_to_free_upgrade[(g.gem_id, g.star_rating, g.rank)] += 1

    for (gem_id, star_rating, current_rank), count in gems_to_free_upgrade.items():
        if star_rating == 2:
            table = COST_2STAR
        elif star_rating == 5:
            table = COST_5STAR
        else:
            continue  # 1-star gems are never in 5-star sockets

        sorted_ranks = get_sorted_ranks(star_rating)
        try:
            current_pos = sorted_ranks.index(current_rank)
        except ValueError:
            continue

        current_copies = table[current_rank].required_gems

        # Find the highest rank reachable without consuming extra copies.
        free_ceiling = current_rank
        for next_rank in sorted_ranks[current_pos + 1:]:
            if table[next_rank].required_gems == current_copies:
                free_ceiling = next_rank
            else:
                break  # required_gems increased; cannot go further for free

        if free_ceiling == current_rank:
            continue  # Already at the free ceiling

        delta_gp = (
            table[free_ceiling].required_gem_power - table[current_rank].required_gem_power
        )
        if delta_gp <= 0:
            continue  # Nothing to gain

        # Budget check: free upgrades are neutral only when residual >= delta_gp.
        # Gate intentionally strict (no shortfall relaxation): free upgrades unlock
        # cheaper paid upgrades but don't reduce obligation on their own, so
        # admitting them in shortfall would commit GP we don't have for zero benefit.
        new_estimated_residual = max(0, estimated_residual - delta_gp)
        if total_upgrade_cost + delta_gp + new_estimated_residual > available_power:
            continue

        new_contribution = compute_contribution(star_rating, free_ceiling, table)

        upgraded_count = 0
        for i, gem in enumerate(working):
            if upgraded_count >= count:
                break
            if (
                gem.gem_id == gem_id
                and gem.star_rating == star_rating
                and gem.rank == current_rank
            ):
                old_gem = working[i]
                working[i] = InventoryGem(
                    gem_id=gem_id,
                    star_rating=star_rating,
                    rank=free_ceiling,
                    quantity=old_gem.quantity,
                    active_stars=old_gem.active_stars,
                    contribution=new_contribution,
                )
                applied.append(UpgradeDelta(
                    gem_id=gem_id,
                    star_rating=star_rating,
                    current_rank=current_rank,
                    target_rank=free_ceiling,
                    additional_gem_power=delta_gp,
                    additional_socket_power=delta_gp,  # net_gain == 0
                    net_gain=0,
                    inventory_index=i,
                    copies_sacrificed=0,
                    upgrade_type="free",
                    pre_upgrade_gem=old_gem,
                ))
                total_upgrade_cost += delta_gp
                estimated_residual = new_estimated_residual
                upgraded_count += 1

    return total_upgrade_cost, estimated_residual


def apply_upgrades_greedy(
    inventory: list[InventoryGem],
    available_power: int,
    baseline_result: OptimizationResult,
    main_gems: list[MainGem],
    progress: ProgressReporter = NullReporter(),
) -> tuple[list[InventoryGem], list[UpgradeDelta], int]:
    """Greedily select and apply profitable gem upgrades within the gem power budget.

    Before the main loop, a pre-pass applies zero-net-gain "free" upgrades to
    gems already assigned to 5-star main gem sockets in the baseline result.
    These advance each such gem to its "free ceiling" rank (the highest rank
    reachable without consuming extra copies), unlocking more efficient
    subsequent paid upgrades for the main loop.

    The main loop then evaluates both partial rank upgrades (sub-rank stepping)
    and direct rank upgrades (whole-rank jump using material gems) and applies
    whichever is more efficient.  The process repeats until no further upgrade
    fits within the budget.

    Multi-step chains emerge naturally: after upgrading a gem from rank 3 to 4,
    that gem at rank 4 becomes a candidate for the 4 → 5 step (either partial
    or direct) in the next iteration.

    **Feasibility** is enforced on every iteration:

    - *Copy/material availability*: required spare copies or specific-rank
      material gems must exist in the current working inventory.
    - *Budget*: the combined effective cost must remain within ``available_power``::

          total_upgrade_cost + delta.additional_gem_power
          + max(0, estimated_residual - delta.additional_socket_power)
          <= available_power

    Args:
        inventory: The player's current gem inventory. This list is **not**
            mutated; a deep copy is made internally.
        available_power: The player's total gem power pool.
        baseline_result: The ``OptimizationResult`` from running the optimizer
            with the original inventory. Used to initialise the estimated residual.
        main_gems: Active main gems. Currently unused by the greedy logic but
            kept as a parameter for future extensions.

    Returns:
        A three-tuple ``(upgraded_inventory, applied_upgrades, total_upgrade_cost)``
        where:

          - ``upgraded_inventory``: A new list of ``InventoryGem`` instances.
            Upgraded gems have their new rank and contribution. Sacrificed copies
            are **removed** from the list.
          - ``applied_upgrades``: Ordered list of ``UpgradeDelta`` instances for
            each upgrade step applied, including preparation steps for direct
            upgrades.
          - ``total_upgrade_cost``: Sum of ``additional_gem_power`` across all
            applied upgrades.
    """
    # Work on a deep copy so the caller's inventory is never mutated.
    working: list[InventoryGem] = copy.deepcopy(inventory)
    applied: list[UpgradeDelta] = []
    total_upgrade_cost = 0
    estimated_residual = baseline_result.total_residual_cost

    # Only gems that can be socketed into 5-star main gem sockets reduce residual
    # (pipeline.py excludes 1/2-star main gems from the ILP).  Sockets 0-2 accept
    # 2-star gems; sockets 3-4 accept 5-star gems and require main-gem rank ≥ 6.
    # Upgrading a gem whose star rating has no available socket wastes GP: the
    # greedy loop would apply the upgrade, but filter_upgrades_to_socketed would
    # drop it, leaving the player worse off than the baseline.
    five_star_mgs = [mg for mg in main_gems if mg.star_rating == 5]
    _socketable: set[int] = set()
    if five_star_mgs:
        _socketable.add(2)  # sockets 0-2 always available on 5-star main gems
        for _mg in five_star_mgs:
            if int(_mg.target_rank.split(".")[0]) >= 6:
                _socketable.add(5)  # sockets 3-4 unlock at rank 6+
                break
    socketable_star_ratings: frozenset[int] = frozenset(_socketable)

    baseline_socketed_types = _select_high_potential_types(working, socketable_star_ratings)

    # Pre-pass: apply zero-net-gain upgrades to gems already in 5-star sockets.
    # These are budget-neutral when socketed (GP cost == additional contribution),
    # and they unlock more efficient subsequent paid upgrades (e.g. rank 3→4
    # at efficiency 0.16 instead of rank 1→4 at 0.09 for 2-star gems).
    progress.report("upgrades", "running", detail="Applying free upgrades...", force=True)
    total_upgrade_cost, estimated_residual = _apply_free_upgrades(
        working, main_gems, baseline_result, applied,
        available_power, total_upgrade_cost, estimated_residual,
    )

    upgrade_count = 0
    while True:
        # Evaluate both upgrade paths and pick the more efficient one.
        partial_result = _find_best_feasible_upgrade(
            working, available_power, total_upgrade_cost, estimated_residual,
            socketable_star_ratings,
            baseline_socketed_types,
        )
        direct_result = _find_best_feasible_direct_upgrade(
            working, available_power, total_upgrade_cost, estimated_residual,
            socketable_star_ratings,
            baseline_socketed_types,
        )

        if partial_result is None and direct_result is None:
            break

        # Compute efficiencies for comparison.
        if partial_result is not None:
            p_delta = partial_result[0]
            partial_eff = (
                float("inf") if p_delta.additional_gem_power == 0
                else p_delta.net_gain / p_delta.additional_gem_power
            )
            partial_socket = p_delta.additional_socket_power
        else:
            partial_eff = float("-inf")
            partial_socket = 0

        if direct_result is not None:
            direct_eff = (
                float("inf") if direct_result.total_gem_power_cost == 0
                else direct_result.net_gain / direct_result.total_gem_power_cost
            )
            direct_socket = direct_result.additional_socket_power
        else:
            direct_eff = float("-inf")
            direct_socket = 0

        # Prefer direct when at least as efficient and offers more socket power
        # on a tie; otherwise prefer partial.
        use_direct = (
            direct_result is not None
            and (
                direct_eff > partial_eff
                or (direct_eff == partial_eff and direct_socket >= partial_socket)
            )
        )

        upgrade_count += 1
        if use_direct:
            total_upgrade_cost, estimated_residual = _execute_direct_upgrade(
                working, direct_result, applied, total_upgrade_cost, estimated_residual
            )
            # After a direct upgrade the ILP re-solve typically finds far better
            # assignments than the greedy estimate predicts (the high-contribution
            # consolidated gem enables global optimisation the estimate can't see).
            # Cap estimated_residual to what the player can actually afford so
            # subsequent small upgrades aren't unfairly blocked by a stale
            # over-estimate.  The post-hoc improvement check in routes.py reverts
            # everything if the ILP doesn't actually improve things.
            estimated_residual = min(estimated_residual, max(0, available_power - total_upgrade_cost))
        else:
            best_delta, upgrade_idx, sacrifice_indices = partial_result
            if best_delta.star_rating == 1:
                table = COST_1STAR
            elif best_delta.star_rating == 2:
                table = COST_2STAR
            else:
                table = COST_5STAR

            # Upgrade the gem in-place before removing sacrifices, so that index
            # arithmetic stays consistent for the pop step below.
            old_gem = working[upgrade_idx]
            new_contribution = compute_contribution(
                best_delta.star_rating, best_delta.target_rank, table
            )
            working[upgrade_idx] = InventoryGem(
                gem_id=old_gem.gem_id,
                star_rating=old_gem.star_rating,
                rank=best_delta.target_rank,
                quantity=old_gem.quantity,
                active_stars=old_gem.active_stars,
                contribution=new_contribution,
            )

            # Capture sacrificed gems before removal (for inventory restoration).
            sacrificed_gem_copies = [working[si] for si in sacrifice_indices]

            # Compute sacrificed contribution before removing copies from the list.
            sacrificed_contribution = sum(
                working[si].contribution for si in sacrifice_indices
            )

            # Remove sacrificed copies highest-index-first to avoid index shifting.
            for si in sorted(sacrifice_indices, reverse=True):
                working.pop(si)

            total_upgrade_cost += best_delta.additional_gem_power
            # Adjust estimated residual: the upgrade adds socket power but the
            # sacrificed gems lose their contribution (opportunity cost).
            estimated_residual = max(
                0,
                estimated_residual
                - best_delta.additional_socket_power
                + sacrificed_contribution,
            )
            # Cap to what the player can actually afford after this upgrade, for
            # the same reason as the direct upgrade cap above.
            estimated_residual = min(estimated_residual, max(0, available_power - total_upgrade_cost))

            _partial_type = "direct" if float(best_delta.target_rank) <= 4 else "partial"
            applied.append(UpgradeDelta(
                gem_id=best_delta.gem_id,
                star_rating=best_delta.star_rating,
                current_rank=best_delta.current_rank,
                target_rank=best_delta.target_rank,
                additional_gem_power=best_delta.additional_gem_power,
                additional_socket_power=best_delta.additional_socket_power,
                net_gain=best_delta.net_gain,
                inventory_index=best_delta.inventory_index,
                copies_sacrificed=len(sacrifice_indices),
                upgrade_type=_partial_type,
                sacrificed_gems=sacrificed_gem_copies,
                pre_upgrade_gem=old_gem,
            ))


    return working, applied, total_upgrade_cost


def filter_upgrades_to_socketed(
    applied_upgrades: list[UpgradeDelta],
    gem_assignments: dict[str, list[SocketAssignment]],
) -> tuple[list[UpgradeDelta], list[tuple[list[UpgradeDelta], UpgradeDelta]], list[InventoryGem]]:
    """Return filtered upgrades, dropped operations, and gems to restore.

    Traces upgrade chains backward: if gem X is upgraded 3→4→5 and rank 5 is
    socketed, all three steps are kept.  Preparation steps are kept when their
    associated direct upgrade is kept.  Upgrades for gems that are never socketed
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
        for a in assignments:
            if a.gem is not None:
                needed[(a.gem.gem_id, a.gem.star_rating, a.gem.rank)] += 1

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
    for i in range(len(operations) - 1, -1, -1):
        _, main_delta = operations[i]
        key = (main_delta.gem_id, main_delta.star_rating, main_delta.target_rank)
        if needed[key] > 0:
            needed[key] -= 1
            relevant[i] = True
            # The pre-upgrade state feeds into this step, so it may be needed earlier.
            pre_key = (main_delta.gem_id, main_delta.star_rating, main_delta.current_rank)
            needed[pre_key] += 1

    filtered: list[UpgradeDelta] = []
    dropped_ops: list[tuple[list[UpgradeDelta], UpgradeDelta]] = []
    gems_to_restore: list[InventoryGem] = []

    for i, (preps, main_delta) in enumerate(operations):
        if relevant[i]:
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
                    (p.gem_id, p.star_rating, p.target_rank) for p in preps
                }
                for sg in main_delta.sacrificed_gems:
                    if (sg.gem_id, sg.star_rating, sg.rank) not in prepped_keys:
                        gems_to_restore.append(sg)  # non-prepped material
                for prep_delta in preps:
                    if prep_delta.pre_upgrade_gem is not None:
                        gems_to_restore.append(prep_delta.pre_upgrade_gem)
                    gems_to_restore.extend(prep_delta.sacrificed_gems)
            else:
                gems_to_restore.extend(main_delta.sacrificed_gems)

    return filtered, dropped_ops, gems_to_restore
