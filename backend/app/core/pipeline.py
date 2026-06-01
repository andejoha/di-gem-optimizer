"""Core optimization pipeline for the gem resonance optimizer.

Provides ``_run_pipeline``: the in-memory orchestration function that runs
all four optimization phases (ILP assignment, greedy bonus swaps, intra-gem
reordering, leftover assignment) on pre-parsed data structures.

This module has no dependency on any web framework or I/O layer.
"""

import logging
import time

from app.core.config import ILP_TIME_LIMIT

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
    global_swap_for_bonuses,
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
    disable_time_limit: bool = False,
) -> OptimizationResult:
    """Execute the core optimization pipeline with pre-parsed data.

    Runs all four optimization phases (ILP assignment, greedy bonus swaps,
    intra-gem socket reordering, leftover assignment) on the provided
    in-memory data structures and returns a fully populated
    ``OptimizationResult``.

    This function is separated from any I/O so that the upgrade optimization
    feature can re-run the pipeline with a modified in-memory inventory
    (after applying gem upgrades) without re-reading any files.

    Args:
        available_power: The player's gem power pool size.
        main_gems: Active main gems to optimize sockets for.
        skipped_slots: Slot names that were excluded during parsing.
        inventory: Available gem copies to assign into sockets.

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

    _t0 = time.perf_counter()
    bonus_table: dict[int, list[int]] = {g.id: g.bonus_gem_ids for g in GEMS.values()}

    # --- Phase 1–3: ILP + swaps + reorder for 5-star main gems only ---
    five_star_gems = [mg for mg in main_gems if mg.star_rating == 5]
    low_star_gems = [mg for mg in main_gems if mg.star_rating != 5]

    all_copies = expand_inventory(inventory)

    effective_time_limit: int | None = None if disable_time_limit else ILP_TIME_LIMIT
    progress.report(f"{stage_prefix}ilp_assignment", "running", detail="Solving gem assignment...", time_limit=effective_time_limit, force=True)
    raw_assignments = solve_assignment(five_star_gems, inventory, time_limit=effective_time_limit)

    # Initialise per_slot_gems for ALL main gems. 5-star slots are populated by
    # the ILP result; 1/2-star slots start empty and are filled by fill_empty_sockets.
    per_slot_gems: dict[str, list[tuple[int, InventoryGem]]] = {
        mg.slot_name: [] for mg in main_gems
    }
    for (slot, s), copies in raw_assignments.items():
        for copy_id, gem in copies:
            per_slot_gems[slot].append((copy_id, gem))

    # --- Phase 2: Fill empty sockets for ALL gems ---
    # Runs before global swaps so the swap phase can redistribute any
    # suboptimally placed fill gems across 5-star slots.
    progress.report(f"{stage_prefix}fill_empty", "running", detail="Filling empty sockets...", force=True)
    per_slot_gems = fill_empty_sockets(main_gems, per_slot_gems, bonus_table, all_copies)

    # --- Phase 3: Global bonus swaps (5-star only) ---
    # Low-star gems are excluded: their residual is always required_power
    # regardless of socketed power, so the slot_residual formula used inside
    # global_swap_for_bonuses would produce misleading results for them.
    progress.report(f"{stage_prefix}global_swaps", "running", detail="Optimizing bonus activations...", force=True)
    five_star_per_slot = {mg.slot_name: per_slot_gems[mg.slot_name] for mg in five_star_gems}
    five_star_per_slot = global_swap_for_bonuses(
        five_star_gems, five_star_per_slot, bonus_table, all_copies, progress=progress,
        stage_prefix=stage_prefix,
    )
    per_slot_gems.update(five_star_per_slot)

    progress.report(f"{stage_prefix}reorder", "running", detail="Reordering sockets...", force=True)
    gem_assignments: dict[str, list[SocketAssignment]] = {}
    for mg in main_gems:
        gem_assignments[mg.slot_name] = reorder_for_bonuses(
            mg, per_slot_gems[mg.slot_name], bonus_table
        )

    # --- Build GemResult for all main gems ---
    gem_results: list[GemResult] = []
    total_socketed = 0
    total_required = 0
    total_residual = 0
    total_resonance = 0

    for mg in main_gems:
        assignments = gem_assignments.get(mg.slot_name, [])
        socketed = sum(a.contribution for a in assignments)
        # For 1/2-star main gems, socketed gem power does NOT offset awakening cost.
        if mg.star_rating == 5:
            residual = max(0, mg.required_power - socketed)
        else:
            residual = mg.required_power
        bonuses_active = sum(1 for a in assignments if a.bonus_activated)
        base_res, socket_res, slot_res = compute_slot_resonance(mg, assignments)

        total_socketed += socketed
        total_required += mg.required_power
        total_residual += residual
        total_resonance += slot_res

        gem_results.append(GemResult(
            slot_name=mg.slot_name,
            gem_id=mg.gem_id,
            target_rank=mg.target_rank,
            sockets_unlocked=mg.num_sockets,
            total_socketed_power=socketed,
            required_power=mg.required_power,
            residual_cost=residual,
            bonuses_activated=bonuses_active,
            bonuses_possible=mg.num_sockets,
            assignments=assignments,
            base_resonance=base_res,
            socket_resonance_bonus=socket_res,
            total_resonance=slot_res,
        ))

    total_bonuses = sum(r.bonuses_activated for r in gem_results)
    label = stage_prefix.rstrip("_") or "pipeline"
    logger.debug(
        "%s: residual=%d socketed=%d/%d bonuses=%d %.2fs",
        label, total_residual, total_socketed, total_required,
        total_bonuses, time.perf_counter() - _t0,
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
