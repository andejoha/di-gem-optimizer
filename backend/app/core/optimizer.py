"""Greedy power-assignment and bonus optimization for the gem resonance optimizer.

The optimization pipeline has four phases:

1. **Greedy assignment** (``solve_assignment``): Assigns inventory gem copies to
   main-gem sockets using a closest-fit heuristic. Each step picks the 5-star
   main gem with the highest remaining residual cost and assigns it the compatible
   inventory gem whose provided power is closest to that residual. Residuals are
   recomputed after every assignment.

2. **Fill empty sockets** (``fill_empty_sockets``): Fills any sockets left empty
   by the greedy phase (residual already zero, or no matching gem available) with
   bonus-targeting or resonance-maximising gems from the remaining inventory.

3. **Cross-gem redistribution** (``redistribute_for_bonuses``): Swaps gem
   ownership between main gems (and pulls in unused inventory gems) to activate
   more resonance bonuses, as long as the plan stays feasible.  Operates on
   ownership only; per-socket placement is delegated to the next phase.

4. **Intra-gem reordering** (``reorder_for_bonuses``): Brute-force permutation
   within each star-type group (sockets 0-2 for 2-star, sockets 3-4 for 5-star)
   to place the right gem in the right socket for maximum bonus activations.
"""

import logging
from itertools import permutations

logger = logging.getLogger(__name__)

from app.core.config import MAX_SOCKETS, SOCKET_STAR_TYPE
from app.core.data import COST_TABLES
from app.core.models import InventoryGem, MainGem, SocketAssignment
from app.core.rules import compute_extractable_power, compute_socket_resonance_bonus


def expand_inventory(
    inventory: list[InventoryGem],
) -> list[tuple[int, InventoryGem]]:
    """Expand an inventory list into individual (copy_id, gem) pairs.

    Gems with ``quantity > 1`` are expanded into multiple entries with distinct
    ``copy_id`` values so that each physical copy can be treated independently.

    Args:
        inventory: List of ``InventoryGem`` instances, potentially with
            ``quantity > 1``.

    Returns:
        Flat list of ``(copy_id, gem)`` tuples where ``copy_id`` is a unique
        integer assigned sequentially across all copies.
    """
    copies: list[tuple[int, InventoryGem]] = []
    copy_id = 0
    for gem in inventory:
        for _ in range(gem.quantity):
            copies.append((copy_id, gem))
            copy_id += 1
    return copies


def solve_assignment(
    main_gems: list[MainGem],
    inventory: list[InventoryGem],
) -> dict[str, list[tuple[int, InventoryGem]]]:
    """Assign inventory gem copies to main-gem sockets via a greedy closest-fit heuristic.

    Assignment runs in two sequential passes — 5-star inventory gems first, then
    2-star — so that high-value 5-star gems are placed against the largest
    residuals before 2-star gems fill the remaining sockets.  Within each pass
    the same closest-fit heuristic applies: pick the 5-star main gem with the
    highest remaining residual and assign it the pool gem whose contribution is
    closest to that residual (smallest ``|contribution - residual|``). On an
    exact tie, the larger gem wins so the residual is fully covered. Residuals
    are recomputed after every assignment.

    Constraints respected:
      - Each inventory copy may be used in at most one socket globally.
      - Only sockets unlocked at the target rank are available
        (``main_gem.num_sockets`` governs the count; socket indices 0 to
        ``num_sockets - 1``).
      - Only 2-star gems go into sockets 0-2; only 5-star gems go into sockets
        3-4 (``SOCKET_STAR_TYPE[5]``).
      - Only 5-star main gems participate — socketed gem power does not offset
        awakening cost for 1/2-star main gems.

    Gems left over (residual already zero, or no compatible socket free) are not
    assigned here; ``fill_empty_sockets`` handles them in the next phase.

    Args:
        main_gems: Active main gems to optimize sockets for.
        inventory: Available gem copies (each with ``quantity=1`` in typical use).

    Returns:
        Dictionary mapping ``slot_name`` to a list of ``(copy_id, gem)`` pairs
        for the gems assigned to that 5-star main gem's sockets. 1/2-star main
        gems are absent from the result. Returns an empty dict if either
        ``main_gems`` has no 5-star gems or ``inventory`` is empty.
    """
    five_star_gems = [main_gem for main_gem in main_gems if main_gem.star_rating == 5]
    if not five_star_gems or not inventory:
        return {}

    # Count free sockets per main gem per accepted star type, restricted to
    # unlocked sockets. SOCKET_STAR_TYPE[5] = {0: 2, 1: 2, 2: 2, 3: 5, 4: 5}.
    free_socket_count: list[dict[int, int]] = []
    for main_gem in five_star_gems:
        socket_capacity: dict[int, int] = {}
        for socket_index in range(main_gem.num_sockets):
            star_type = SOCKET_STAR_TYPE[5][socket_index]
            socket_capacity[star_type] = socket_capacity.get(star_type, 0) + 1
        free_socket_count.append(socket_capacity)

    residuals = [main_gem.required_power for main_gem in five_star_gems]
    result: dict[str, list[tuple[int, InventoryGem]]] = {
        main_gem.slot_name: [] for main_gem in five_star_gems
    }

    # All candidate copies, excluding zero-contribution gems.  Each copy may be
    # used in at most one socket globally; used_copy_ids tracks assignments across
    # both star-type passes.
    all_copies = [
        (copy_id, gem)
        for copy_id, gem in expand_inventory(inventory)
        if gem.contribution > 0
    ]
    used_copy_ids: set[int] = set()

    # Two sequential passes: 5-star inventory gems first, then 2-star.  Within
    # each pass the inner loop is the same closest-fit heuristic as before —
    # pick the main gem with the highest residual and assign it the pool gem
    # whose contribution is closest to that residual.
    for star_pass in (5, 2):
        available_copies = [
            (copy_id, gem) for copy_id, gem in all_copies
            if gem.star_rating == star_pass and copy_id not in used_copy_ids
        ]

        while available_copies:
            # Find the main gem with the highest current residual that still has
            # a free socket of this star type.
            target_index = -1
            target_key: tuple | None = None
            for gem_index in range(len(five_star_gems)):
                if residuals[gem_index] <= 0:
                    continue
                if free_socket_count[gem_index].get(star_pass, 0) <= 0:
                    continue
                key = (residuals[gem_index], -gem_index)
                if target_key is None or key > target_key:
                    target_key, target_index = key, gem_index
            if target_index < 0:
                break

            # Pick the gem whose power is closest to the current residual.
            # On equal distance the larger gem wins to avoid under-filling the socket.
            # copy_id breaks remaining ties so output is byte-stable across runs.
            best_copy_index = -1
            best_selection_key: tuple | None = None
            for copy_index, (copy_id, gem) in enumerate(available_copies):
                selection_key = (
                    abs(gem.contribution - residuals[target_index]),
                    -gem.contribution,
                    copy_id,
                )
                if best_selection_key is None or selection_key < best_selection_key:
                    best_selection_key, best_copy_index = selection_key, copy_index

            copy_id, gem = available_copies.pop(best_copy_index)
            used_copy_ids.add(copy_id)
            result[five_star_gems[target_index].slot_name].append((copy_id, gem))
            free_socket_count[target_index][gem.star_rating] -= 1
            residuals[target_index] = max(0, residuals[target_index] - gem.contribution)

    return result


# ---------------------------------------------------------------------------
# Post-assignment phases
# ---------------------------------------------------------------------------


def fill_empty_sockets(
    main_gems: list[MainGem],
    per_slot_gems: dict[str, list[tuple[int, InventoryGem]]],
    bonus_table: dict[int, list[int]],
    all_copies: list[tuple[int, InventoryGem]],
) -> dict[str, list[tuple[int, InventoryGem]]]:
    """Fill empty sockets with leftover inventory gems using a two-pass strategy.

    After the greedy assignment phase, 5-star gem sockets may be left empty
    because filling them does not reduce residual cost (residual already zero). For
    1/2-star gems no prior phase has assigned anything. This function fills all
    remaining empty positions, giving the reorder phase more material to work with.

    Two-pass algorithm:

    1. **Bonus pass**: For every main gem and star-type group, collect bonus
       requirements that are not yet satisfiable by already-assigned gems.
       All bonus requirements are scanned before filling any neutral positions so
       a scarce gem is never wasted on a neutral socket when another slot needs it
       to activate a bonus.

    2. **Resonance pass**: Fill any positions still empty after the bonus pass
       with the highest-``compute_socket_resonance_bonus`` compatible gem
       available in the remaining unassigned pool.

    Args:
        main_gems: All active main gems (any star rating).
        per_slot_gems: Current flat assignment mapping ``slot_name`` to a list
            of ``(copy_id, gem)`` pairs. May contain empty lists (for 1/2-star
            slots) or partial lists (for 5-star slots the greedy left unfilled).
            Modified on a copy and returned.
        bonus_table: Full bonus lookup table mapping gem_id to required gem_ids.
        all_copies: All inventory copies as ``(copy_id, gem)`` pairs from
            ``expand_inventory``.

    Returns:
        Updated ``per_slot_gems`` mapping after all available fills have been
        applied.
    """
    current = {slot: list(gems) for slot, gems in per_slot_gems.items()}
    used_copy_ids: set[int] = {copy_id for gems in current.values() for copy_id, _ in gems}

    def get_unassigned() -> list[tuple[int, InventoryGem]]:
        return [(copy_id, gem) for copy_id, gem in all_copies if copy_id not in used_copy_ids]

    def empty_slot_count_by_star_type(main_gem: MainGem) -> dict[int, int]:
        """Return {star_type: empty_count} for each socket type of this gem."""
        socket_type_map = SOCKET_STAR_TYPE[main_gem.star_rating]
        socket_capacity: dict[int, int] = {}
        for socket_index in range(main_gem.num_sockets):
            star_type = socket_type_map[socket_index]
            socket_capacity[star_type] = socket_capacity.get(star_type, 0) + 1
        assigned_by_star_type: dict[int, int] = {}
        for _, gem in current[main_gem.slot_name]:
            assigned_by_star_type[gem.star_rating] = assigned_by_star_type.get(gem.star_rating, 0) + 1
        return {
            star_type: max(0, capacity - assigned_by_star_type.get(star_type, 0))
            for star_type, capacity in socket_capacity.items()
        }

    def unsatisfied_bonus_requirements(main_gem: MainGem, star_type: int) -> list[int]:
        """Return bonus gem_ids for star_type sockets not yet satisfiable."""
        socket_type_map = SOCKET_STAR_TYPE[main_gem.star_rating]
        bonus_reqs = bonus_table.get(main_gem.gem_id, [])
        requirements = [
            bonus_reqs[socket_index] if socket_index < len(bonus_reqs) else 0
            for socket_index in range(main_gem.num_sockets)
            if socket_type_map[socket_index] == star_type
        ]
        already_assigned = [
            gem.gem_id for _, gem in current[main_gem.slot_name] if gem.star_rating == star_type
        ]
        already_matched = [False] * len(already_assigned)
        unsatisfied = []
        for requirement in requirements:
            if not requirement:
                continue
            matched = False
            for match_index, assigned_gem_id in enumerate(already_assigned):
                if not already_matched[match_index] and assigned_gem_id == requirement:
                    already_matched[match_index] = True
                    matched = True
                    break
            if not matched:
                unsatisfied.append(requirement)
        return unsatisfied

    # Pass 1: fill sockets where a bonus gem is needed but not yet present.
    unassigned = get_unassigned()
    for main_gem in main_gems:
        empty_counts = empty_slot_count_by_star_type(main_gem)
        for star_type, empty_count in empty_counts.items():
            if empty_count <= 0:
                continue
            for required_gem_id in unsatisfied_bonus_requirements(main_gem, star_type):
                if empty_count <= 0:
                    break
                for position, (copy_id, gem) in enumerate(unassigned):
                    if gem.star_rating == star_type and gem.gem_id == required_gem_id:
                        current[main_gem.slot_name].append((copy_id, gem))
                        used_copy_ids.add(copy_id)
                        unassigned.pop(position)
                        empty_count -= 1
                        break

    # Pass 2: fill remaining empty sockets with the highest-resonance compatible gem.
    unassigned = get_unassigned()
    for main_gem in main_gems:
        empty_counts = empty_slot_count_by_star_type(main_gem)
        for star_type, empty_count in empty_counts.items():
            if empty_count <= 0:
                continue
            compatible = sorted(
                (entry for entry in unassigned if entry[1].star_rating == star_type),
                key=lambda entry: compute_socket_resonance_bonus(
                    entry[1].star_rating, entry[1].active_stars, entry[1].rank
                ),
                reverse=True,
            )
            for copy_id, gem in compatible:
                if empty_count <= 0:
                    break
                current[main_gem.slot_name].append((copy_id, gem))
                used_copy_ids.add(copy_id)
                empty_count -= 1
        unassigned = [(copy_id, gem) for copy_id, gem in unassigned if copy_id not in used_copy_ids]

    return current


def total_residual_for(
    main_gems: list[MainGem],
    per_slot_gems: dict[str, list[tuple[int, InventoryGem]]],
) -> int:
    """Compute total residual power cost across all main gems.

    5-star main gems have their residual reduced by the sum of their socketed
    gem contributions; 1/2-star main gems always carry their full
    ``required_power`` as residual (socketed power does not offset awakening
    cost for lower-star gems).

    Args:
        main_gems: All active main gems.
        per_slot_gems: Current ownership mapping ``slot_name`` to a list of
            ``(copy_id, gem)`` pairs.

    Returns:
        Sum of per-main residual costs.
    """
    total = 0
    for mg in main_gems:
        socketed = sum(gem.contribution for _, gem in per_slot_gems.get(mg.slot_name, []))
        if mg.star_rating == 5:
            total += max(0, mg.required_power - socketed)
        else:
            total += mg.required_power
    return total


def dormant_power_for(
    all_copies: list[tuple[int, InventoryGem]],
    owned_copy_ids: set[int],
) -> int:
    """Compute GP recoverable by making every unowned copy in ``all_copies`` dormant.

    Mirrors the dormant-GP accounting in ``pipeline._run_pipeline`` (there
    applied to the final socket assignment; here applied to an in-progress
    ownership set during ``redistribute_for_bonuses``), so that a move which
    pulls an unassigned gem into a socket is charged for the dormant GP it
    displaces, not just the residual it changes.

    Args:
        all_copies: All inventory copies as ``(copy_id, gem)`` pairs.
        owned_copy_ids: copy_ids currently assigned to some main gem.

    Returns:
        Total GP recoverable from copies not in ``owned_copy_ids``.
    """
    return sum(
        compute_extractable_power(gem.rank, COST_TABLES[gem.star_rating])
        for copy_id, gem in all_copies
        if copy_id not in owned_copy_ids
    )


def max_bonuses_for_owned(
    main_gem: MainGem,
    owned: list[tuple[int, InventoryGem]],
    bonus_table: dict[int, list[int]],
) -> int:
    """Count the maximum bonuses activatable for a main gem given an owned set.

    Performs a per-socket-star-type greedy multiset match between the socket
    bonus requirements and the gem_ids of the owned gems.  For each star type,
    bonus requirements are collected from ``bonus_table`` and each non-zero
    requirement is matched to one unused owned gem with an equal ``gem_id``.

    Because bonus matching is pure equality on ``gem_id``, the greedy approach
    is optimal: each distinct id contributes ``min(#requirements, #owned)``
    matches, and no reordering can improve that.

    Args:
        main_gem: The main gem whose bonus requirements are checked.
        owned: List of ``(copy_id, gem)`` pairs the main gem currently holds.
        bonus_table: Mapping of ``gem_id`` to a per-socket list of required
            gem_ids (0 = no requirement for that socket).

    Returns:
        Maximum number of bonuses that can be activated.
    """
    socket_type_map = SOCKET_STAR_TYPE[main_gem.star_rating]
    bonus_requirements = bonus_table.get(main_gem.gem_id, [0] * MAX_SOCKETS[main_gem.star_rating])
    accepted_star_types = set(socket_type_map.values())
    total = 0
    for star_type in accepted_star_types:
        # Required gem_ids for sockets of this star type, excluding zeroes.
        requirements = [
            bonus_requirements[socket_index]
            for socket_index in range(main_gem.num_sockets)
            if socket_type_map[socket_index] == star_type
            and socket_index < len(bonus_requirements)
            and bonus_requirements[socket_index]
        ]
        if not requirements:
            continue
        # Available gem_ids from owned gems of this star type.
        available: list[int] = [gem.gem_id for _, gem in owned if gem.star_rating == star_type]
        # Greedy match: consume one available id per requirement.
        used = [False] * len(available)
        for req in requirements:
            for idx, avail_id in enumerate(available):
                if not used[idx] and avail_id == req:
                    used[idx] = True
                    total += 1
                    break
    return total


def redistribute_for_bonuses(
    main_gems: list[MainGem],
    per_slot_gems: dict[str, list[tuple[int, InventoryGem]]],
    bonus_table: dict[int, list[int]],
    budget: int,
    all_copies: list[tuple[int, InventoryGem]],
) -> dict[str, list[tuple[int, InventoryGem]]]:
    """Swap gem ownership between main gems to activate more resonance bonuses.

    Performs a best-improvement hill-climbing search over candidate moves until
    no improving move exists (fixpoint).  All moves are same-star-type only,
    respecting ``SOCKET_STAR_TYPE`` constraints.

    Three candidate move kinds per pair of main gems:
    - **Swap**: exchange one owned gem from main A with one owned gem from main B.
    - **Transfer**: move a gem from A to B when B has a free socket of that type
      (no gem returned to A).
    - **Swap with unassigned**: exchange an owned gem of any main with an
      unassigned inventory copy of the same star type (the displaced gem returns
      to the unassigned pool).

    Feasibility guard:
    - Define ``cost = total_residual - dormant_power``, where ``dormant_power``
      is the GP recoverable by making every currently-unowned copy dormant
      (``dormant_power_for``). This is the same quantity the API surfaces as
      ``available_power + dormant_gem_power - residual`` in the response
      summary, so a move accepted here can never make the *displayed* surplus
      worse than the ceiling below.
    - A move is accepted only when ``bonus_gain > 0`` and the resulting
      ``new_cost <= max(budget, starting_cost)``. This allows cost to rise into
      spare budget, but never makes things worse than the incoming plan when
      the plan starts over budget. Swap and transfer moves only reassign
      ownership between two already-owned mains, so they never change
      ``dormant_power``; only the swap-with-unassigned move does, because it
      moves a copy across the owned/unowned boundary.

    Within each sweep the best move (highest ``(bonus_gain, -new_cost)``,
    tie-broken by ``(slot_name_A, copy_id_A, slot_name_B, copy_id_B)``) is
    applied and the sweep restarts.  Swaps involving only 1/2-star main gems
    never change residual (no power offset applies to those mains), so they are
    accepted whenever they gain any bonus.

    This is a documented heuristic, not a provably globally optimal assignment.
    Sizes are tiny (≤~8 main gems, ≤5 sockets each), so convergence is fast.

    Args:
        main_gems: All active main gems (any star rating).
        per_slot_gems: Current ownership mapping ``slot_name`` to a list of
            ``(copy_id, gem)`` pairs as produced by ``fill_empty_sockets``.
            Not mutated; a working copy is made internally.
        bonus_table: Full bonus lookup table mapping gem_id to required gem_ids.
        budget: GP the player can still spend on this phase — i.e. the pool,
            net of any GP already committed elsewhere (such as an applied
            upgrade plan). Used for the feasibility ceiling above.
        all_copies: All inventory copies as ``(copy_id, gem)`` pairs from
            ``expand_inventory`` (used to pull in unassigned gems and to
            compute dormant power).

    Returns:
        Updated ``per_slot_gems`` mapping after all improving moves have been
        applied.  Ownership only — per-socket placement is handled by the
        subsequent ``reorder_for_bonuses`` phase.
    """
    # Build a working copy of per_slot_gems (lists copied; gem objects shared).
    current: dict[str, list[tuple[int, InventoryGem]]] = {
        slot: list(gems) for slot, gems in per_slot_gems.items()
    }

    # Set of copy_ids that are currently owned by any main gem. Declared here
    # (rather than after bonus_counts below) because it is needed to compute
    # the starting dormant power for the cost ceiling.
    owned_copy_ids: set[int] = {
        copy_id for gems in current.values() for copy_id, _ in gems
    }

    starting_residual = total_residual_for(main_gems, current)
    starting_dormant = dormant_power_for(all_copies, owned_copy_ids)
    starting_cost = starting_residual - starting_dormant
    cost_ceiling = max(budget, starting_cost)
    # Dormant power only changes for swap-with-unassigned moves; tracked
    # incrementally as the working state's ownership boundary shifts.
    current_dormant = starting_dormant

    def socket_capacity_by_star_type(main_gem: MainGem) -> dict[int, int]:
        """Total socket slots per star type for this main gem."""
        socket_type_map = SOCKET_STAR_TYPE[main_gem.star_rating]
        capacity: dict[int, int] = {}
        for socket_index in range(main_gem.num_sockets):
            st = socket_type_map[socket_index]
            capacity[st] = capacity.get(st, 0) + 1
        return capacity

    def free_socket_count(main_gem: MainGem, star_type: int) -> int:
        """Number of unoccupied sockets of ``star_type`` in ``main_gem``."""
        capacity = socket_capacity_by_star_type(main_gem).get(star_type, 0)
        assigned = sum(1 for _, gem in current[main_gem.slot_name] if gem.star_rating == star_type)
        return max(0, capacity - assigned)

    def gem_residual(main_gem: MainGem) -> int:
        """Residual for a single main gem from the current working state."""
        if main_gem.star_rating != 5:
            return main_gem.required_power
        socketed = sum(gem.contribution for _, gem in current[main_gem.slot_name])
        return max(0, main_gem.required_power - socketed)

    # Pre-compute per-main-gem bonus counts from current state so we can
    # compute deltas without rescanning all gems on every candidate move.
    bonus_counts: dict[str, int] = {
        mg.slot_name: max_bonuses_for_owned(mg, current[mg.slot_name], bonus_table)
        for mg in main_gems
    }

    improved = True
    while improved:
        improved = False
        best_key: tuple | None = None
        best_move: tuple | None = None  # Encoded as ('swap', mg_a, idx_a, mg_b, idx_b)
                                        # or ('transfer', mg_a, idx_a, mg_b)
                                        # or ('unassigned', mg_a, idx_a, copy_id_b, gem_b)

        # ------------------------------------------------------------------
        # Candidate A: swaps / transfers between two already-owned gems
        # ------------------------------------------------------------------
        for i, mg_a in enumerate(main_gems):
            for j, mg_b in enumerate(main_gems):
                if j <= i:
                    continue
                slot_a = mg_a.slot_name
                slot_b = mg_b.slot_name

                # For each star type present in BOTH gems' sockets, try swaps.
                star_types_a = set(socket_capacity_by_star_type(mg_a))
                star_types_b = set(socket_capacity_by_star_type(mg_b))
                shared_star_types = star_types_a & star_types_b

                for star_type in shared_star_types:
                    gems_a = [(idx, copy_id, gem) for idx, (copy_id, gem) in enumerate(current[slot_a]) if gem.star_rating == star_type]
                    gems_b = [(idx, copy_id, gem) for idx, (copy_id, gem) in enumerate(current[slot_b]) if gem.star_rating == star_type]

                    for idx_a, copy_id_a, gem_a in gems_a:
                        # Swap gem_a with each gem_b.
                        for idx_b, copy_id_b, gem_b in gems_b:
                            # Quick-reject: if gem_ids are the same, swapping
                            # cannot change bonus counts (and contribution
                            # change only matters if residual differs, which
                            # we still check, but skip identical gem_ids).
                            if gem_a.gem_id == gem_b.gem_id and gem_a.contribution == gem_b.contribution:
                                continue
                            # Simulate the swap.
                            new_a = [g for g in current[slot_a] if g[0] != copy_id_a] + [(copy_id_b, gem_b)]
                            new_b = [g for g in current[slot_b] if g[0] != copy_id_b] + [(copy_id_a, gem_a)]
                            bonus_a_new = max_bonuses_for_owned(mg_a, new_a, bonus_table)
                            bonus_b_new = max_bonuses_for_owned(mg_b, new_b, bonus_table)
                            bonus_gain = (bonus_a_new + bonus_b_new) - (bonus_counts[slot_a] + bonus_counts[slot_b])
                            if bonus_gain <= 0:
                                continue
                            # Residual delta (only 5-star mains change).
                            old_res_a = gem_residual(mg_a)
                            old_res_b = gem_residual(mg_b)
                            if mg_a.star_rating == 5:
                                new_res_a = max(0, mg_a.required_power - sum(g.contribution for _, g in new_a))
                            else:
                                new_res_a = mg_a.required_power
                            if mg_b.star_rating == 5:
                                new_res_b = max(0, mg_b.required_power - sum(g.contribution for _, g in new_b))
                            else:
                                new_res_b = mg_b.required_power
                            new_total_residual = (
                                total_residual_for(main_gems, current)
                                - old_res_a - old_res_b
                                + new_res_a + new_res_b
                            )
                            # Swaps only reassign ownership between two already-
                            # owned mains, so dormant power is unaffected.
                            new_cost = new_total_residual - current_dormant
                            if new_cost > cost_ceiling:
                                continue
                            key = (bonus_gain, -new_cost, slot_a, copy_id_a, slot_b, copy_id_b)
                            if best_key is None or key > best_key:
                                best_key = key
                                best_move = ('swap', mg_a, idx_a, copy_id_a, gem_a, mg_b, idx_b, copy_id_b, gem_b)

                        # Transfer gem_a into a free socket of mg_b (no gem returned).
                        if free_socket_count(mg_b, star_type) > 0:
                            new_a = [g for g in current[slot_a] if g[0] != copy_id_a]
                            new_b = current[slot_b] + [(copy_id_a, gem_a)]
                            bonus_a_new = max_bonuses_for_owned(mg_a, new_a, bonus_table)
                            bonus_b_new = max_bonuses_for_owned(mg_b, new_b, bonus_table)
                            bonus_gain = (bonus_a_new + bonus_b_new) - (bonus_counts[slot_a] + bonus_counts[slot_b])
                            if bonus_gain <= 0:
                                continue
                            old_res_a = gem_residual(mg_a)
                            old_res_b = gem_residual(mg_b)
                            if mg_a.star_rating == 5:
                                new_res_a = max(0, mg_a.required_power - sum(g.contribution for _, g in new_a))
                            else:
                                new_res_a = mg_a.required_power
                            if mg_b.star_rating == 5:
                                new_res_b = max(0, mg_b.required_power - sum(g.contribution for _, g in new_b))
                            else:
                                new_res_b = mg_b.required_power
                            new_total_residual = (
                                total_residual_for(main_gems, current)
                                - old_res_a - old_res_b
                                + new_res_a + new_res_b
                            )
                            # Transfers only reassign ownership between two
                            # already-owned mains, so dormant power is unaffected.
                            new_cost = new_total_residual - current_dormant
                            if new_cost > cost_ceiling:
                                continue
                            key = (bonus_gain, -new_cost, slot_a, copy_id_a, slot_b, -1)
                            if best_key is None or key > best_key:
                                best_key = key
                                best_move = ('transfer', mg_a, idx_a, copy_id_a, gem_a, mg_b)

        # ------------------------------------------------------------------
        # Candidate B: swap an owned gem with an unassigned inventory copy
        # ------------------------------------------------------------------
        unassigned = [
            (copy_id, gem) for copy_id, gem in all_copies
            if copy_id not in owned_copy_ids
        ]
        for mg_a in main_gems:
            slot_a = mg_a.slot_name
            star_types_a = set(socket_capacity_by_star_type(mg_a))
            for star_type in star_types_a:
                gems_a = [(idx, copy_id, gem) for idx, (copy_id, gem) in enumerate(current[slot_a]) if gem.star_rating == star_type]
                for idx_a, copy_id_a, gem_a in gems_a:
                    for copy_id_b, gem_b in unassigned:
                        if gem_b.star_rating != star_type:
                            continue
                        if gem_a.gem_id == gem_b.gem_id and gem_a.contribution == gem_b.contribution:
                            continue
                        new_a = [g for g in current[slot_a] if g[0] != copy_id_a] + [(copy_id_b, gem_b)]
                        bonus_a_new = max_bonuses_for_owned(mg_a, new_a, bonus_table)
                        bonus_gain = bonus_a_new - bonus_counts[slot_a]
                        if bonus_gain <= 0:
                            continue
                        old_res_a = gem_residual(mg_a)
                        if mg_a.star_rating == 5:
                            new_res_a = max(0, mg_a.required_power - sum(g.contribution for _, g in new_a))
                        else:
                            new_res_a = mg_a.required_power
                        new_total_residual = (
                            total_residual_for(main_gems, current)
                            - old_res_a + new_res_a
                        )
                        # gem_a leaves ownership (becomes dormant-eligible);
                        # gem_b enters it (no longer dormant-eligible).
                        new_dormant = (
                            current_dormant
                            + compute_extractable_power(gem_a.rank, COST_TABLES[gem_a.star_rating])
                            - compute_extractable_power(gem_b.rank, COST_TABLES[gem_b.star_rating])
                        )
                        new_cost = new_total_residual - new_dormant
                        if new_cost > cost_ceiling:
                            continue
                        key = (bonus_gain, -new_cost, slot_a, copy_id_a, "", copy_id_b)
                        if best_key is None or key > best_key:
                            best_key = key
                            best_move = ('unassigned', mg_a, idx_a, copy_id_a, gem_a, copy_id_b, gem_b)

        if best_move is None:
            break

        # Apply the best move found this sweep.
        move_type = best_move[0]
        if move_type == 'swap':
            _, mg_a, _, copy_id_a, gem_a, mg_b, _, copy_id_b, gem_b = best_move
            current[mg_a.slot_name] = [g for g in current[mg_a.slot_name] if g[0] != copy_id_a] + [(copy_id_b, gem_b)]
            current[mg_b.slot_name] = [g for g in current[mg_b.slot_name] if g[0] != copy_id_b] + [(copy_id_a, gem_a)]
            bonus_counts[mg_a.slot_name] = max_bonuses_for_owned(mg_a, current[mg_a.slot_name], bonus_table)
            bonus_counts[mg_b.slot_name] = max_bonuses_for_owned(mg_b, current[mg_b.slot_name], bonus_table)
        elif move_type == 'transfer':
            _, mg_a, _, copy_id_a, gem_a, mg_b = best_move
            current[mg_a.slot_name] = [g for g in current[mg_a.slot_name] if g[0] != copy_id_a]
            current[mg_b.slot_name] = current[mg_b.slot_name] + [(copy_id_a, gem_a)]
            # copy_id_a is still owned (now by mg_b), so owned_copy_ids is unchanged.
            bonus_counts[mg_a.slot_name] = max_bonuses_for_owned(mg_a, current[mg_a.slot_name], bonus_table)
            bonus_counts[mg_b.slot_name] = max_bonuses_for_owned(mg_b, current[mg_b.slot_name], bonus_table)
        else:  # 'unassigned'
            _, mg_a, _, copy_id_a, gem_a, copy_id_b, gem_b = best_move
            current[mg_a.slot_name] = [g for g in current[mg_a.slot_name] if g[0] != copy_id_a] + [(copy_id_b, gem_b)]
            owned_copy_ids.discard(copy_id_a)
            owned_copy_ids.add(copy_id_b)
            current_dormant += (
                compute_extractable_power(gem_a.rank, COST_TABLES[gem_a.star_rating])
                - compute_extractable_power(gem_b.rank, COST_TABLES[gem_b.star_rating])
            )
            bonus_counts[mg_a.slot_name] = max_bonuses_for_owned(mg_a, current[mg_a.slot_name], bonus_table)

        improved = True

    return current


def reorder_for_bonuses(
    main_gem: MainGem,
    gem_copies: list[tuple[int, InventoryGem]],
    bonus_table: dict[int, list[int]],
) -> list[SocketAssignment]:
    """Assign gem copies to specific sockets to maximize activated bonuses.

    Independently permutes gems within the 2-star group (sockets 0-2) and
    the 5-star group (sockets 3-4), selecting the ordering that activates the
    most resonance bonuses. Worst-case complexity is 3! × 2! = 12 permutations
    per main gem, so this is fast even without caching.

    Args:
        main_gem: The main gem whose sockets are being assigned.
        gem_copies: List of ``(copy_id, gem)`` pairs to distribute across
            ``main_gem``'s unlocked sockets, as returned by ``fill_empty_sockets``.
        bonus_table: Full bonus lookup table mapping gem_id to required gem_ids.

    Returns:
        List of ``SocketAssignment`` instances of length ``main_gem.num_sockets``,
        ordered by socket index (0 to ``main_gem.num_sockets - 1``). Empty sockets
        (no gem available for that star type) have ``gem=None``.
    """
    socket_type_map = SOCKET_STAR_TYPE[main_gem.star_rating]
    bonus_requirements = bonus_table.get(main_gem.gem_id, [0] * MAX_SOCKETS[main_gem.star_rating])

    accepted_star_types = sorted(set(socket_type_map.values()))
    gems_by_star_type: dict[int, list[tuple[int, InventoryGem]]] = {
        star_type: [(copy_id, gem) for copy_id, gem in gem_copies if gem.star_rating == star_type]
        for star_type in accepted_star_types
    }
    sockets_by_star_type: dict[int, list[int]] = {
        star_type: [
            socket_index
            for socket_index in range(main_gem.num_sockets)
            if socket_type_map[socket_index] == star_type
        ]
        for star_type in accepted_star_types
    }

    def count_activated_bonuses(
        socket_positions: list[int],
        gems: list[tuple[int, InventoryGem]],
    ) -> int:
        """Count bonuses activated by pairing socket_positions[i] with gems[i]."""
        return sum(
            1
            for socket_position, (_, gem) in zip(socket_positions, gems)
            if (
                bonus_requirement := (
                    bonus_requirements[socket_position]
                    if socket_position < len(bonus_requirements)
                    else 0
                )
            )
            and gem.gem_id == bonus_requirement
        )

    def best_permutation(
        socket_positions: list[int],
        gems: list[tuple[int, InventoryGem]],
    ) -> list[tuple[int, InventoryGem]]:
        """Return the permutation of gems that maximizes activated bonuses."""
        best_ordering = list(gems)
        best_bonus_count = count_activated_bonuses(socket_positions, gems)
        for permutation in permutations(gems):
            bonus_count = count_activated_bonuses(socket_positions, list(permutation))
            if bonus_count > best_bonus_count:
                best_bonus_count, best_ordering = bonus_count, list(permutation)
        return best_ordering

    best_ordering_by_star_type: dict[int, list[tuple[int, InventoryGem]]] = {
        star_type: best_permutation(sockets_by_star_type[star_type], gems_by_star_type[star_type])
        for star_type in accepted_star_types
    }
    gem_iterators_by_star_type = {
        star_type: iter(best_ordering_by_star_type[star_type])
        for star_type in accepted_star_types
    }

    result: list[SocketAssignment] = []
    for socket_index in range(main_gem.num_sockets):
        accepted_star_type = socket_type_map[socket_index]
        next_gem = next(gem_iterators_by_star_type[accepted_star_type], None)
        if next_gem is None:
            result.append(SocketAssignment(socket_index=socket_index))
        else:
            copy_id, gem = next_gem
            bonus_requirement = (
                bonus_requirements[socket_index]
                if socket_index < len(bonus_requirements)
                else 0
            )
            result.append(SocketAssignment(
                socket_index=socket_index,
                gem=gem,
                copy_id=copy_id,
                contribution=gem.contribution,
                bonus_activated=bool(bonus_requirement and gem.gem_id == bonus_requirement),
            ))

    return result
