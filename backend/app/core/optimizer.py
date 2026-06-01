"""ILP solver and bonus optimization for the gem resonance optimizer.

The optimization pipeline has three phases:

1. **ILP assignment** (``solve_assignment``): Uses PuLP/CBC to assign inventory
   gem copies to main-gem sockets, minimizing total residual gem power cost.

2. **Global bonus swaps** (``global_swap_for_bonuses``): Greedy hill-climbing
   that exchanges gems between slots or replaces assigned gems with unassigned
   inventory copies to improve bonus activations without worsening residual cost.

3. **Intra-gem reordering** (``reorder_for_bonuses``): Brute-force permutation
   within each star-type group (sockets 0-2 for 2-star, sockets 3-4 for 5-star)
   to place the right gem in the right socket for maximum bonus activations.
"""

import logging
import time
from itertools import permutations

logger = logging.getLogger(__name__)

import pulp

from app.core.config import MAX_SOCKETS, SOCKET_STAR_TYPE, SOCKET_UNLOCK_RANK
from app.core.models import InventoryGem, MainGem, SocketAssignment
from app.core.progress import NullReporter, ProgressReporter
from app.core.rules import compute_socket_resonance_bonus


def expand_inventory(
    inventory: list[InventoryGem],
) -> list[tuple[int, InventoryGem]]:
    """Expand an inventory list into individual (copy_id, gem) pairs.

    Gems with ``quantity > 1`` are expanded into multiple entries with distinct
    ``copy_id`` values. This enables the ILP to treat each physical copy as an
    independent decision variable.

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
    time_limit: int | None = None,
) -> dict[tuple[str, int], list[tuple[int, InventoryGem]]]:
    """Assign inventory gem copies to main-gem sockets via Integer Linear Programming.

    Formulates and solves a binary ILP that minimizes total residual gem power
    cost — the sum over all main gems of ``max(0, required_power - socketed_power)``.
    The ``max(0, ...)`` is linearized by introducing non-negative auxiliary
    variables and adding ``residual[g] >= required[g] - socketed[g]`` constraints;
    minimization forces each auxiliary to its lower bound.

    Constraints:
      - Each inventory copy may be used in at most one socket globally.
      - Each socket may receive at most one gem.
      - Only 2-star gems go into sockets 0-2; only 5-star gems go into sockets 3-4.
      - Only sockets unlocked at the target rank are available.

    If the solver returns a non-optimal status, a warning is emitted and the
    best feasible solution found so far is returned.

    Args:
        main_gems: Active main gems to optimize sockets for.
        inventory: Available gem copies (each with ``quantity=1`` in typical use).

    Returns:
        Dictionary mapping ``(slot_name, socket_index)`` to a single-element
        list ``[(copy_id, gem)]`` for each socket that received an assignment.
        Empty sockets and locked sockets are absent from the result.
        Returns an empty dict if either ``main_gems`` or ``inventory`` is empty.
    """
    # Only 5-star main gems participate in the ILP — socketed gem power does not
    # offset awakening cost for 1/2-star main gems, so they are excluded.
    five_star_gems = [mg for mg in main_gems if mg.star_rating == 5]

    if not five_star_gems or not inventory:
        return {}

    copies = expand_inventory(inventory)

    prob = pulp.LpProblem("GemSocketAssignment", pulp.LpMinimize)

    # Decision variables: x[g_idx, s, copy_id] in {0,1}
    # Only created where compatible (star type + socket unlocked).
    x: dict[tuple[int, int, int], pulp.LpVariable] = {}

    for g_idx, mg in enumerate(five_star_gems):
        for s in range(mg.num_sockets):
            required_star = SOCKET_STAR_TYPE[5][s]
            for copy_id, gem in copies:
                if gem.star_rating == required_star:
                    var = pulp.LpVariable(f"x_{g_idx}_{s}_{copy_id}", cat="Binary")
                    x[(g_idx, s, copy_id)] = var

    copy_lookup = {cid: gem for cid, gem in copies}

    # Pre-build index structures for O(n) constraint construction.
    # vars_by_gem[g_idx]       → list of (cid, var) for the residual expression
    # vars_by_gem_socket[g,s]  → list of var for the at-most-one-per-socket constraint
    # vars_by_copy[cid]        → list of var for the at-most-one-per-copy constraint
    vars_by_gem: dict[int, list[tuple[int, pulp.LpVariable]]] = {}
    vars_by_gem_socket: dict[tuple[int, int], list[pulp.LpVariable]] = {}
    vars_by_copy: dict[int, list[pulp.LpVariable]] = {}
    for (gi, si, cid), var in x.items():
        vars_by_gem.setdefault(gi, []).append((cid, var))
        vars_by_gem_socket.setdefault((gi, si), []).append(var)
        vars_by_copy.setdefault(cid, []).append(var)

    # Residual variables: residual[g] = max(0, required[g] - socketed[g])
    # Constraint  residual[g] >= required[g] - socketed[g]  combined with
    # residual[g] >= 0  forces residual[g] = max(0, required[g] - socketed[g])
    # when the objective minimises the sum.
    residual_vars = {}
    for g_idx, mg in enumerate(five_star_gems):
        r = pulp.LpVariable(f"residual_{g_idx}", lowBound=0)
        residual_vars[g_idx] = r
        socketed = pulp.lpSum(
            copy_lookup[cid].contribution * var
            for cid, var in vars_by_gem.get(g_idx, [])
        )
        prob += r >= mg.required_power - socketed

    # Objective: minimise total gem power needed from the player's pool.
    # Tiebreaker: encode the full (g_idx, s, copy_id) triple as a unique integer
    # coefficient so that among solutions with the same total residual, the ILP
    # always picks the same per-slot assignment regardless of platform or solver
    # build.  The old coefficient (copy_id only) was position-agnostic, meaning
    # solutions that swapped the same gems between sockets had identical
    # tiebreaker values and CBC could legitimately return either one.
    #
    # Epsilon bound: the tiebreaker sum must stay < 1 (the integer gap in residual
    # costs) so it can never promote a suboptimal primary solution.
    # Max sum ≈ epsilon × (num_slots × max_sockets × n_copies) × (num_slots × max_sockets)
    #         = epsilon × num_slots² × max_sockets² × n_copies   < 1.
    max_copy_id = max((cid for cid, _ in copies), default=0)
    n_copies = max_copy_id + 1
    num_slots = len(five_star_gems)
    max_sockets = max((mg.num_sockets for mg in five_star_gems), default=4)
    epsilon = 0.5 / max(num_slots ** 2 * max_sockets ** 2 * n_copies, 1)
    tiebreaker = pulp.lpSum(
        epsilon * (g_idx * max_sockets * n_copies + s * n_copies + copy_id) * var
        for (g_idx, s, copy_id), var in x.items()
    )
    prob += pulp.lpSum(residual_vars.values()) + tiebreaker

    # Constraint: each copy used at most once globally
    for terms in vars_by_copy.values():
        prob += pulp.lpSum(terms) <= 1

    # Constraint: at most one gem per socket
    for terms in vars_by_gem_socket.values():
        prob += pulp.lpSum(terms) <= 1

    solver = (
        pulp.PULP_CBC_CMD(msg=0)
        if time_limit is None
        else pulp.PULP_CBC_CMD(msg=0, timeLimit=time_limit)
    )
    t0 = time.perf_counter()
    prob.solve(solver)

    if prob.status != 1:  # 1 = Optimal in PuLP
        logger.warning("ILP non-optimal status: %s", pulp.LpStatus[prob.status])

    # Extract solution: keep variables assigned (value > 0.5) as the result
    result: dict[tuple[str, int], list[tuple[int, InventoryGem]]] = {}
    for (g_idx, s, copy_id), var in x.items():
        if pulp.value(var) is not None and pulp.value(var) > 0.5:
            key = (five_star_gems[g_idx].slot_name, s)
            result[key] = [(copy_id, copy_lookup[copy_id])]

    logger.info("ILP: %d vars, %d assigned, %.2fs", len(x), len(result), time.perf_counter() - t0)
    return result


# ---------------------------------------------------------------------------
# Post-ILP greedy phases (unchanged)
# ---------------------------------------------------------------------------


def count_achievable_bonuses(
    mg: MainGem,
    gem_copies: list[tuple[int, InventoryGem]],
    bonus_table: dict[int, list[int]],
) -> int:
    """Count how many resonance bonuses can be activated with the given gem set.

    Assumes that optimal intra-gem reordering will be applied afterward, so a
    bonus is achievable as long as the required gem is present among the
    assigned copies — regardless of which socket it currently occupies.
    Each physical gem copy can satisfy at most one bonus requirement.

    Args:
        mg: The main gem whose bonus requirements are looked up.
        gem_copies: List of ``(copy_id, gem)`` pairs currently assigned to
            ``mg``'s sockets.
        bonus_table: Full bonus lookup table mapping gem_id to required gem_ids.

    Returns:
        Number of bonuses achievable with optimal socket ordering, in the
        range ``[0, mg.num_sockets]``.
    """
    bonus_reqs = bonus_table.get(mg.gem_id, [0] * MAX_SOCKETS[mg.star_rating])
    available = [g.gem_id for _, g in gem_copies]
    used = [False] * len(available)
    count = 0
    for s in range(mg.num_sockets):
        req = bonus_reqs[s] if s < len(bonus_reqs) else 0
        if not req:
            continue
        for k, gem_id in enumerate(available):
            if not used[k] and gem_id == req:
                count += 1
                used[k] = True
                break
    return count


def global_swap_for_bonuses(
    main_gems: list[MainGem],
    per_slot_gems: dict[str, list[tuple[int, InventoryGem]]],
    bonus_table: dict[int, list[int]],
    all_copies: list[tuple[int, InventoryGem]],
    progress: ProgressReporter = NullReporter(),
    stage_prefix: str = "",
) -> dict[str, list[tuple[int, InventoryGem]]]:
    """Greedily improve bonus activations without worsening total residual cost.

    Performs hill-climbing over two categories of moves:

    1. **Cross-gem swap**: Exchange one assigned gem between two different main
       gems. Accepted only if star ratings match, total residual across both
       slots does not increase, and total achievable bonus count increases.

    2. **Inventory replacement**: Replace an assigned gem with an unassigned
       inventory copy. Accepted only if star ratings match, the slot's residual
       does not increase, and the slot's achievable bonus count increases.

    Repeats both move types until no improving move is found.

    Args:
        main_gems: Active main gems (defines the set of slots to consider).
        per_slot_gems: Current assignment mapping ``slot_name`` to a list of
            ``(copy_id, gem)`` pairs. Modified in place (on a copy) and returned.
        bonus_table: Full bonus lookup table from ``parse_socket_bonuses``.
        all_copies: All inventory copies (including unassigned ones) as
            ``(copy_id, gem)`` pairs from ``expand_inventory``.

    Returns:
        Updated ``per_slot_gems`` mapping after all beneficial swaps have been
        applied.
    """
    def slot_residual(mg: MainGem, gems: list[tuple[int, InventoryGem]]) -> int:
        return max(0, mg.required_power - sum(g.contribution for _, g in gems))

    mg_by_slot = {mg.slot_name: mg for mg in main_gems}
    current = {slot: list(gems) for slot, gems in per_slot_gems.items()}

    improved = True
    pass_count = 0
    while improved:
        improved = False
        pass_count += 1
        slots = list(current.keys())

        # --- Move 1: cross-gem swaps ---
        for i, slot_a in enumerate(slots):
            for slot_b in slots[i + 1:]:
                mg_a = mg_by_slot[slot_a]
                mg_b = mg_by_slot[slot_b]
                gems_a = current[slot_a]
                gems_b = current[slot_b]

                for ai, (cid_a, gem_a) in enumerate(gems_a):
                    for bi, (cid_b, gem_b) in enumerate(gems_b):
                        if gem_a.star_rating != gem_b.star_rating:
                            continue

                        new_a = list(gems_a)
                        new_b = list(gems_b)
                        new_a[ai] = (cid_b, gem_b)
                        new_b[bi] = (cid_a, gem_a)

                        old_res = slot_residual(mg_a, gems_a) + slot_residual(mg_b, gems_b)
                        new_res = slot_residual(mg_a, new_a) + slot_residual(mg_b, new_b)
                        if new_res > old_res:
                            continue

                        old_bonus = (
                            count_achievable_bonuses(mg_a, gems_a, bonus_table)
                            + count_achievable_bonuses(mg_b, gems_b, bonus_table)
                        )
                        new_bonus = (
                            count_achievable_bonuses(mg_a, new_a, bonus_table)
                            + count_achievable_bonuses(mg_b, new_b, bonus_table)
                        )
                        if new_bonus > old_bonus:
                            current[slot_a] = new_a
                            current[slot_b] = new_b
                            gems_a = new_a
                            gems_b = new_b
                            improved = True

        # --- Move 2: replace assigned gem with unassigned inventory copy ---
        assigned_ids = {cid for gems in current.values() for cid, _ in gems}
        unassigned = [(cid, gem) for cid, gem in all_copies if cid not in assigned_ids]

        for slot_a in slots:
            mg_a = mg_by_slot[slot_a]
            gems_a = current[slot_a]

            for ai, (cid_a, gem_a) in enumerate(gems_a):
                for cid_u, gem_u in unassigned:
                    if gem_u.star_rating != gem_a.star_rating:
                        continue

                    new_a = list(gems_a)
                    new_a[ai] = (cid_u, gem_u)

                    old_res = slot_residual(mg_a, gems_a)
                    new_res = slot_residual(mg_a, new_a)
                    if new_res > old_res:
                        continue

                    old_bonus = count_achievable_bonuses(mg_a, gems_a, bonus_table)
                    new_bonus = count_achievable_bonuses(mg_a, new_a, bonus_table)
                    if new_bonus > old_bonus:
                        current[slot_a] = new_a
                        gems_a = new_a
                        # update unassigned: cid_u is now used, cid_a is now free
                        assigned_ids.add(cid_u)
                        assigned_ids.discard(cid_a)
                        unassigned = [
                            (cid, gem) for cid, gem in all_copies
                            if cid not in assigned_ids
                        ]
                        improved = True

    return current


def fill_empty_sockets(
    main_gems: list[MainGem],
    per_slot_gems: dict[str, list[tuple[int, InventoryGem]]],
    bonus_table: dict[int, list[int]],
    all_copies: list[tuple[int, InventoryGem]],
) -> dict[str, list[tuple[int, InventoryGem]]]:
    """Fill empty sockets with leftover inventory gems using a two-pass strategy.

    After the ILP phase, 5-star gem sockets may be left empty because filling
    them does not reduce residual cost (residual already 0). For 1/2-star gems
    no prior phase has assigned anything. This function fills all remaining
    empty positions before the global bonus-swap phase runs, giving the swap
    phase more material to work with.

    Two-pass algorithm:

    1. **Bonus pass**: For every main gem and star-type group, collect bonus
       requirements that are not yet satisfiable by already-assigned gems.
       Scan all main gems for bonus requirements *before* filling any non-bonus
       positions, so a scarce gem is never wasted on a neutral socket when
       another slot needs it to activate a bonus.

    2. **Resonance pass**: Fill any positions still empty after the bonus pass
       with the highest-``compute_socket_resonance_bonus`` compatible gem
       available in the remaining unassigned pool.

    Args:
        main_gems: All active main gems (any star rating).
        per_slot_gems: Current flat assignment mapping ``slot_name`` to a list
            of ``(copy_id, gem)`` pairs. May contain empty lists (for slots not
            yet assigned anything) or partial lists (for 5-star slots where the
            ILP left some sockets unfilled). Modified on a copy and returned.
        bonus_table: Full bonus lookup table mapping gem_id to required gem_ids.
        all_copies: All inventory copies as ``(copy_id, gem)`` pairs from
            ``expand_inventory``.

    Returns:
        Updated ``per_slot_gems`` mapping after all available fills have been
        applied.
    """
    current = {slot: list(gems) for slot, gems in per_slot_gems.items()}
    used_ids: set[int] = {cid for gems in current.values() for cid, _ in gems}

    def get_unassigned() -> list[tuple[int, InventoryGem]]:
        return [(cid, gem) for cid, gem in all_copies if cid not in used_ids]

    def empty_slots_by_type(mg: MainGem) -> dict[int, int]:
        """Return {star_type: empty_count} for each socket type of this gem."""
        socket_type_map = SOCKET_STAR_TYPE[mg.star_rating]
        capacity: dict[int, int] = {}
        for s in range(mg.num_sockets):
            st = socket_type_map[s]
            capacity[st] = capacity.get(st, 0) + 1
        assigned_by_type: dict[int, int] = {}
        for _, gem in current[mg.slot_name]:
            assigned_by_type[gem.star_rating] = assigned_by_type.get(gem.star_rating, 0) + 1
        return {st: max(0, cap - assigned_by_type.get(st, 0)) for st, cap in capacity.items()}

    def unsatisfied_bonus_reqs(mg: MainGem, star_type: int) -> list[int]:
        """Return bonus gem_ids for star_type sockets not yet satisfiable."""
        socket_type_map = SOCKET_STAR_TYPE[mg.star_rating]
        bonus_reqs = bonus_table.get(mg.gem_id, [])
        reqs = [
            bonus_reqs[s] if s < len(bonus_reqs) else 0
            for s in range(mg.num_sockets)
            if socket_type_map[s] == star_type
        ]
        available = [g.gem_id for _, g in current[mg.slot_name] if g.star_rating == star_type]
        used_match = [False] * len(available)
        unsatisfied = []
        for req in reqs:
            if not req:
                continue
            matched = False
            for k, gid in enumerate(available):
                if not used_match[k] and gid == req:
                    used_match[k] = True
                    matched = True
                    break
            if not matched:
                unsatisfied.append(req)
        return unsatisfied

    # --- Pass 1: Bonus fill ---
    unassigned = get_unassigned()
    for mg in main_gems:
        empties = empty_slots_by_type(mg)
        for star_type, empty_count in empties.items():
            if empty_count <= 0:
                continue
            for req_gem_id in unsatisfied_bonus_reqs(mg, star_type):
                if empty_count <= 0:
                    break
                for i, (cid, gem) in enumerate(unassigned):
                    if gem.star_rating == star_type and gem.gem_id == req_gem_id:
                        current[mg.slot_name].append((cid, gem))
                        used_ids.add(cid)
                        unassigned.pop(i)
                        empty_count -= 1
                        break

    # --- Pass 2: Resonance fill ---
    unassigned = get_unassigned()
    for mg in main_gems:
        empties = empty_slots_by_type(mg)
        for star_type, empty_count in empties.items():
            if empty_count <= 0:
                continue
            compatible = sorted(
                ((cid, gem) for cid, gem in unassigned if gem.star_rating == star_type),
                key=lambda cg: compute_socket_resonance_bonus(
                    cg[1].star_rating, cg[1].active_stars, cg[1].rank
                ),
                reverse=True,
            )
            for cid, gem in compatible:
                if empty_count <= 0:
                    break
                current[mg.slot_name].append((cid, gem))
                used_ids.add(cid)
                empty_count -= 1
        unassigned = [(cid, gem) for cid, gem in unassigned if cid not in used_ids]

    return current


def reorder_for_bonuses(
    mg: MainGem,
    gem_copies: list[tuple[int, InventoryGem]],
    bonus_table: dict[int, list[int]],
) -> list[SocketAssignment]:
    """Assign gem copies to specific sockets to maximize activated bonuses.

    Independently permutes gems within the 2-star group (sockets 0-2) and
    the 5-star group (sockets 3-4), selecting the ordering that activates the
    most resonance bonuses. Worst-case complexity is 3! × 2! = 12 permutations
    per main gem, so this is fast even without caching.

    Args:
        mg: The main gem whose sockets are being assigned.
        gem_copies: List of ``(copy_id, gem)`` pairs to distribute across
            ``mg``'s unlocked sockets, as returned by ``global_swap_for_bonuses``.
        bonus_table: Full bonus lookup table mapping gem_id to required gem_ids.

    Returns:
        List of ``SocketAssignment`` instances of length ``mg.num_sockets``,
        ordered by socket index (0 to ``mg.num_sockets - 1``). Empty sockets
        (no gem available for that star type) have ``gem=None``.
    """
    socket_type_map = SOCKET_STAR_TYPE[mg.star_rating]
    bonus_reqs = bonus_table.get(mg.gem_id, [0] * MAX_SOCKETS[mg.star_rating])

    # Group gem copies and slots by the star type they accept.
    # For each unique accepted star type, collect the gems and slots for that group.
    accepted_star_types = sorted(set(socket_type_map.values()))
    gems_by_type: dict[int, list[tuple[int, InventoryGem]]] = {
        t: [(cid, gem) for cid, gem in gem_copies if gem.star_rating == t]
        for t in accepted_star_types
    }
    slots_by_type: dict[int, list[int]] = {
        t: [s for s in range(mg.num_sockets) if socket_type_map[s] == t]
        for t in accepted_star_types
    }

    def count_bonuses_for_ordering(
        slots: list[int],
        gems: list[tuple[int, InventoryGem]],
    ) -> int:
        """Count bonuses activated by pairing ``slots[i]`` with ``gems[i]``."""
        return sum(
            1
            for slot, (_, gem) in zip(slots, gems)
            if (req := (bonus_reqs[slot] if slot < len(bonus_reqs) else 0))
            and gem.gem_id == req
        )

    def best_permutation(
        slots: list[int],
        gems: list[tuple[int, InventoryGem]],
    ) -> list[tuple[int, InventoryGem]]:
        """Return the permutation of ``gems`` that maximizes bonus count."""
        best, best_count = list(gems), count_bonuses_for_ordering(slots, gems)
        for perm in permutations(gems):
            c = count_bonuses_for_ordering(slots, list(perm))
            if c > best_count:
                best_count, best = c, list(perm)
        return best

    # Find the best gem ordering per star-type group.
    ordered_by_type: dict[int, list[tuple[int, InventoryGem]]] = {
        t: best_permutation(slots_by_type[t], gems_by_type[t])
        for t in accepted_star_types
    }
    iters_by_type = {t: iter(ordered_by_type[t]) for t in accepted_star_types}

    result: list[SocketAssignment] = []
    for s in range(mg.num_sockets):
        accepted = socket_type_map[s]
        entry = next(iters_by_type[accepted], None)
        if entry is None:
            result.append(SocketAssignment(socket_index=s))
        else:
            cid, gem = entry
            req = bonus_reqs[s] if s < len(bonus_reqs) else 0
            activated = bool(req and gem.gem_id == req)
            result.append(SocketAssignment(
                socket_index=s,
                gem=gem,
                copy_id=cid,
                contribution=gem.contribution,
                bonus_activated=activated,
            ))

    return result


def assign_leftover_gems(
    low_star_gems: list[MainGem],
    unassigned_copies: list[tuple[int, InventoryGem]],
    bonus_table: dict[int, list[int]],
) -> dict[str, list[SocketAssignment]]:
    """Assign leftover inventory gems to 1- and 2-star main gem sockets.

    Called after the ILP optimization for 5-star gems. Since socketed gem
    power does not offset the awakening cost of 1/2-star main gems, the only
    goal here is to maximize bonus activations. Gems are assigned greedily:
    each socket first tries to find a matching bonus gem; if none is available,
    any compatible gem is assigned instead.

    Each inventory copy can be used at most once across all slots.

    Args:
        low_star_gems: 1- and 2-star main gems to assign sockets for.
        unassigned_copies: Inventory copies not yet used by 5-star optimization,
            as ``(copy_id, gem)`` pairs.
        bonus_table: Merged bonus lookup table covering all star ratings.

    Returns:
        Dictionary mapping ``slot_name`` to a list of ``SocketAssignment``
        objects, one per unlocked socket of each 1/2-star main gem.
    """
    result: dict[str, list[SocketAssignment]] = {}
    used_ids: set[int] = set()

    for mg in low_star_gems:
        socket_type_map = SOCKET_STAR_TYPE[mg.star_rating]
        bonus_reqs = bonus_table.get(mg.gem_id, [])
        assignments: list[SocketAssignment] = []

        for s in range(mg.num_sockets):
            accepted_star = socket_type_map[s]
            bonus_req = bonus_reqs[s] if s < len(bonus_reqs) else 0

            # Prefer a gem that matches the bonus requirement.
            chosen: tuple[int, InventoryGem] | None = None
            if bonus_req:
                for cid, gem in unassigned_copies:
                    if cid not in used_ids and gem.star_rating == accepted_star:
                        if gem.gem_id == bonus_req:
                            chosen = (cid, gem)
                            break

            # Fall back to any compatible gem.
            if chosen is None:
                for cid, gem in unassigned_copies:
                    if cid not in used_ids and gem.star_rating == accepted_star:
                        chosen = (cid, gem)
                        break

            if chosen is None:
                assignments.append(SocketAssignment(socket_index=s))
            else:
                cid, gem = chosen
                used_ids.add(cid)
                raw_req = bonus_reqs[s] if s < len(bonus_reqs) else 0
                activated = bool(raw_req and gem.gem_id == raw_req)
                assignments.append(SocketAssignment(
                    socket_index=s,
                    gem=gem,
                    copy_id=cid,
                    contribution=gem.contribution,
                    bonus_activated=activated,
                ))

        result[mg.slot_name] = assignments

    return result
