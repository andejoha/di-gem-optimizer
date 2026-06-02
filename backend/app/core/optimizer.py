"""Greedy power-assignment and bonus optimization for the gem resonance optimizer.

The optimization pipeline has three phases:

1. **Greedy assignment** (``solve_assignment``): Assigns inventory gem copies to
   main-gem sockets using a closest-fit heuristic. Each step picks the 5-star
   main gem with the highest remaining residual cost and assigns it the compatible
   inventory gem whose provided power is closest to that residual. Residuals are
   recomputed after every assignment.

2. **Fill empty sockets** (``fill_empty_sockets``): Fills any sockets left empty
   by the greedy phase (residual already zero, or no matching gem available) with
   bonus-targeting or resonance-maximising gems from the remaining inventory.

3. **Intra-gem reordering** (``reorder_for_bonuses``): Brute-force permutation
   within each star-type group (sockets 0-2 for 2-star, sockets 3-4 for 5-star)
   to place the right gem in the right socket for maximum bonus activations.
"""

import logging
from itertools import permutations

logger = logging.getLogger(__name__)

from app.core.config import MAX_SOCKETS, SOCKET_STAR_TYPE
from app.core.models import InventoryGem, MainGem, SocketAssignment
from app.core.rules import compute_socket_resonance_bonus


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

    Each iteration picks the 5-star main gem with the highest remaining residual
    cost, then assigns it the compatible inventory gem whose provided power is
    closest to that residual (smallest ``|contribution - residual|``). On an exact
    tie, the larger gem wins so the residual is fully covered. Residuals are
    recomputed after every assignment; the loop exits when no main gem with
    positive residual has a compatible gem and a free socket left.

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

    # Copies with zero contribution never reduce residual cost, so exclude them.
    # The remaining copies form a mutable pool; each may be used at most once.
    available_copies = [
        (copy_id, gem)
        for copy_id, gem in expand_inventory(inventory)
        if gem.contribution > 0
    ]

    while True:
        # Find the main gem with the highest current residual that still has a
        # free compatible socket and at least one matching gem left in the pool.
        target_index = -1
        target_key: tuple | None = None
        for gem_index in range(len(five_star_gems)):
            if residuals[gem_index] <= 0:
                continue
            available_star_types = {
                star_type
                for star_type, count in free_socket_count[gem_index].items()
                if count > 0
            }
            if not available_star_types:
                continue
            if not any(gem.star_rating in available_star_types for _, gem in available_copies):
                continue
            # Highest residual wins; gem_index breaks ties for determinism across runs.
            key = (residuals[gem_index], -gem_index)
            if target_key is None or key > target_key:
                target_key, target_index = key, gem_index
        if target_index < 0:
            break

        available_star_types = {
            star_type
            for star_type, count in free_socket_count[target_index].items()
            if count > 0
        }

        # Pick the gem whose power is closest to the current residual.
        # On equal distance the larger gem wins to avoid under-filling the socket.
        # copy_id breaks remaining ties so output is byte-stable across runs.
        best_copy_index = -1
        best_selection_key: tuple | None = None
        for copy_index, (copy_id, gem) in enumerate(available_copies):
            if gem.star_rating not in available_star_types:
                continue
            selection_key = (
                abs(gem.contribution - residuals[target_index]),
                -gem.contribution,
                copy_id,
            )
            if best_selection_key is None or selection_key < best_selection_key:
                best_selection_key, best_copy_index = selection_key, copy_index

        copy_id, gem = available_copies.pop(best_copy_index)
        result[five_star_gems[target_index].slot_name].append((copy_id, gem))
        free_socket_count[target_index][gem.star_rating] -= 1
        residuals[target_index] = max(0, residuals[target_index] - gem.contribution)

    total_assigned = sum(len(slot_copies) for slot_copies in result.values())
    logger.info("greedy assignment: %d 5-star slots, %d gems assigned", len(five_star_gems), total_assigned)
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
