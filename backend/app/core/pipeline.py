"""Core optimization pipeline for the gem resonance optimizer.

Provides ``_run_pipeline``: the in-memory orchestration function that runs
all three optimization phases (greedy assignment, socket fill, intra-gem
reordering) on pre-parsed data structures.

This module has no dependency on any web framework or I/O layer.
"""

import logging
import time

logger = logging.getLogger(__name__)

from app.core.data import GEMS
from app.core.models import (
    GemResult,
    InventoryGem,
    OptimizationResult,
    SocketAssignment,
)
from app.core.optimizer import (
    expand_inventory,
    fill_empty_sockets,
    redistribute_for_bonuses,
    reorder_for_bonuses,
    solve_assignment,
)
from app.core.progress import NullReporter, ProgressReporter
from app.core.rules import compute_slot_resonance


def _run_pipeline(
    available_power: int,
    main_gems: list,
    skipped_slots: list[str],
    inventory: list[InventoryGem],
    progress: ProgressReporter = NullReporter(),
    stage_prefix: str = "",
    skip_bonus_phases: bool = False,
) -> OptimizationResult:
    """Execute the core optimization pipeline with pre-parsed data.

    Runs all four optimization phases (greedy closest-fit assignment, empty
    socket fill, cross-gem bonus redistribution, intra-gem socket reordering)
    on the provided in-memory data structures and returns a fully populated
    ``OptimizationResult``.

    This function is separated from any I/O so that the upgrade optimization
    feature can re-run the pipeline with a modified in-memory inventory
    (after applying gem upgrades) without re-reading any files.

    Args:
        available_power: The player's gem power pool size.
        main_gems: Active main gems to optimize sockets for.
        skipped_slots: Slot names that were excluded during parsing.
        inventory: Available gem copies to assign into sockets.
        skip_bonus_phases: When ``True``, skip the ``redistribute_for_bonuses``
            and ``reorder_for_bonuses`` phases and instead produce a flat
            socket assignment (gems placed in socket order without permutation
            or bonus scoring).  Use this for upgrade-walk iterations where only
            the residual cost matters; the caller is responsible for running the
            full pipeline on the final chosen inventory.

    Returns:
        ``OptimizationResult`` with per-slot ``GemResult`` objects and global
        totals. If ``main_gems`` is empty, returns a zero-value result.
    """
    if not main_gems:
        return OptimizationResult(
            gem_results=[],
            total_socketed_power=0,
            total_required_power=0,
            total_residual_cost=0,
            available_power=available_power,
            skipped_slots=skipped_slots,
            gem_assignments={},
            bonus_table={},
            main_gems=[],
            total_resonance=0,
        )

    start_time = time.perf_counter()
    bonus_table: dict[int, list[int]] = {gem_def.id: gem_def.bonus_gem_ids for gem_def in GEMS.values()}

    five_star_gems = [main_gem for main_gem in main_gems if main_gem.star_rating == 5]
    all_copies = expand_inventory(inventory)

    progress.report(f"{stage_prefix}assignment", "running", detail="Solving gem assignment...", force=True)
    raw_assignments = solve_assignment(five_star_gems, inventory)

    # 5-star slots are populated by the greedy result; 1/2-star slots start
    # empty and are filled by fill_empty_sockets.
    per_slot_gems: dict[str, list[tuple[int, InventoryGem]]] = {
        main_gem.slot_name: [] for main_gem in main_gems
    }
    for slot, copies in raw_assignments.items():
        per_slot_gems[slot].extend(copies)

    progress.report(f"{stage_prefix}fill_empty", "running", detail="Filling empty sockets...", force=True)
    per_slot_gems = fill_empty_sockets(main_gems, per_slot_gems, bonus_table, all_copies)

    gem_assignments: dict[str, list[SocketAssignment]] = {}
    if skip_bonus_phases:
        # Flat assignment: place gems into compatible sockets in their existing
        # order without permutation or bonus scoring.  Contribution and gem
        # identity are correct for residual and upgrade-filter purposes; bonus
        # fields are left at their zero defaults.
        from app.core.config import SOCKET_STAR_TYPE
        for main_gem in main_gems:
            socket_type_map = SOCKET_STAR_TYPE[main_gem.star_rating]
            gems_by_star: dict[int, list[tuple[int, InventoryGem]]] = {}
            for copy_id, gem in per_slot_gems[main_gem.slot_name]:
                gems_by_star.setdefault(gem.star_rating, []).append((copy_id, gem))
            iters = {st: iter(copies) for st, copies in gems_by_star.items()}
            sockets: list[SocketAssignment] = []
            for socket_index in range(main_gem.num_sockets):
                st = socket_type_map[socket_index]
                nxt = next(iters.get(st, iter([])), None)
                if nxt is None:
                    sockets.append(SocketAssignment(socket_index=socket_index))
                else:
                    copy_id, gem = nxt
                    sockets.append(SocketAssignment(
                        socket_index=socket_index,
                        gem=gem,
                        copy_id=copy_id,
                        contribution=gem.contribution,
                    ))
            gem_assignments[main_gem.slot_name] = sockets
    else:
        progress.report(f"{stage_prefix}redistribute", "running", detail="Redistributing for bonuses...", force=True)
        per_slot_gems = redistribute_for_bonuses(
            main_gems, per_slot_gems, bonus_table, available_power, all_copies
        )

        progress.report(f"{stage_prefix}reorder", "running", detail="Reordering sockets...", force=True)
        for main_gem in main_gems:
            gem_assignments[main_gem.slot_name] = reorder_for_bonuses(
                main_gem, per_slot_gems[main_gem.slot_name], bonus_table
            )

    gem_results: list[GemResult] = []
    total_socketed = 0
    total_required = 0
    total_residual = 0
    total_resonance = 0

    for main_gem in main_gems:
        assignments = gem_assignments.get(main_gem.slot_name, [])
        socketed_power = sum(assignment.contribution for assignment in assignments)
        # For 1/2-star main gems, socketed gem power does NOT offset awakening cost.
        if main_gem.star_rating == 5:
            residual = max(0, main_gem.required_power - socketed_power)
        else:
            residual = main_gem.required_power
        bonuses_activated = sum(1 for assignment in assignments if assignment.bonus_activated)
        base_resonance, socket_resonance, slot_resonance = compute_slot_resonance(main_gem, assignments)

        total_socketed += socketed_power
        total_required += main_gem.required_power
        total_residual += residual
        total_resonance += slot_resonance

        gem_results.append(GemResult(
            slot_name=main_gem.slot_name,
            gem_id=main_gem.gem_id,
            target_rank=main_gem.target_rank,
            sockets_unlocked=main_gem.num_sockets,
            total_socketed_power=socketed_power,
            required_power=main_gem.required_power,
            residual_cost=residual,
            bonuses_activated=bonuses_activated,
            bonuses_possible=main_gem.num_sockets,
            assignments=assignments,
            base_resonance=base_resonance,
            socket_resonance_bonus=socket_resonance,
            total_resonance=slot_resonance,
        ))

    total_bonuses = sum(gem_result.bonuses_activated for gem_result in gem_results)
    label = stage_prefix.rstrip("_") or "pipeline"
    logger.debug(
        "%s: residual=%d socketed=%d/%d bonuses=%d %.2fs",
        label, total_residual, total_socketed, total_required,
        total_bonuses, time.perf_counter() - start_time,
    )

    return OptimizationResult(
        gem_results=gem_results,
        total_socketed_power=total_socketed,
        total_required_power=total_required,
        total_residual_cost=total_residual,
        available_power=available_power,
        skipped_slots=skipped_slots,
        gem_assignments=gem_assignments,
        bonus_table=bonus_table,
        main_gems=main_gems,
        total_resonance=total_resonance,
    )
