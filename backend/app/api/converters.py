"""Conversion helpers between API schemas and core domain objects."""

from collections import Counter
from typing import Optional

from fastapi import HTTPException

from app.api.schemas import (
    DormantGemItem,
    GemResults,
    OptimizeRequest,
    OptimizeResponse,
    RemainingInventoryItem,
    SlotResponse,
    SocketResponse,
    SummaryResponse,
    UpgradeItem,
    UpgradesResponse,
    GemSetup,
)
from app.core.config import MAX_SOCKETS, SOCKET_STAR_TYPE
from app.core.data import COST_1STAR, COST_2STAR, COST_5STAR, GEMS
from app.core.models import (
    InventoryGem,
    MainGem,
    OptimizationResult,
    UpgradeOptimizationResult,
)
from app.core.rules import (
    compute_contribution,
    compute_extractable_power,
    compute_socket_resonance_bonus,
    num_sockets_unlocked,
)

_COST_TABLES: dict[int, dict] = {1: COST_1STAR, 2: COST_2STAR, 5: COST_5STAR}


def request_to_domain(
    request: OptimizeRequest,
) -> tuple[int, list[MainGem], list[str], list[InventoryGem]]:
    """Convert a validated API request into internal domain objects.

    Args:
        request: Validated Pydantic request model.

    Returns:
        Four-tuple of ``(available_power, main_gems, skipped_slots, inventory)``.
    """
    available_power = request.gem_power
    main_gems: list[MainGem] = []
    skipped_slots: list[str] = []

    cost_tables = {1: COST_1STAR, 2: COST_2STAR, 5: COST_5STAR}

    for slot in GemSetup.model_fields:
        item = getattr(request.gem_setup, slot)
        if item is None:
            skipped_slots.append(slot)
            continue

        gem_def = GEMS.get(item.gem_id)
        if gem_def is None:
            raise HTTPException(
                status_code=422,
                detail=f"Unknown gem_id {item.gem_id} for slot '{slot}'.",
            )

        rank = item.target_rank.strip()
        star_rating = gem_def.star_rating
        cost_table = cost_tables[star_rating]

        if rank not in cost_table:
            valid = sorted(cost_table.keys(), key=lambda r: (
                cost_table[r].required_gems, cost_table[r].required_gem_power))
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Invalid target_rank '{rank}' for slot '{slot}' "
                    f"(gem_id={item.gem_id}, star_rating={star_rating}). "
                    f"Valid {star_rating}-star ranks: {valid}"
                ),
            )

        entry = cost_table[rank]
        main_gems.append(MainGem(
            slot_name=slot,
            gem_id=item.gem_id,
            star_rating=star_rating,
            target_rank=rank,
            required_power=entry.required_gem_power,
            num_sockets=num_sockets_unlocked(rank, star_rating),
            active_stars=item.active_stars,
        ))

    inventory: list[InventoryGem] = []
    for i, inv_item in enumerate(request.inventory):
        gem_def = GEMS.get(inv_item.gem_id)
        if gem_def is None:
            raise HTTPException(
                status_code=422,
                detail=f"Unknown gem_id {inv_item.gem_id} for inventory item {i}.",
            )

        rank = inv_item.rank.strip()
        star_rating = gem_def.star_rating
        cost_table = cost_tables[star_rating]

        if rank not in cost_table:
            valid = sorted(cost_table.keys(), key=lambda r: (
                cost_table[r].required_gems, cost_table[r].required_gem_power))
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Invalid rank '{rank}' for inventory item {i} "
                    f"(gem_id={inv_item.gem_id}, star_rating={star_rating}). "
                    f"Valid {star_rating}-star ranks: {valid}"
                ),
            )

        contribution = compute_contribution(star_rating, rank, cost_table)
        inventory.append(InventoryGem(
            gem_id=inv_item.gem_id,
            star_rating=star_rating,
            rank=rank,
            quantity=1,
            active_stars=inv_item.active_stars,
            contribution=contribution,
        ))

    return available_power, main_gems, skipped_slots, inventory


def already_dormant_counter(request: OptimizeRequest) -> Counter:
    """Count inventory copies the player already marked dormant before submitting.

    Keyed by ``(gem_id, star_rating, rank, active_stars)`` — the same identity
    ``domain_to_response`` uses for ``dormant_gems`` — so already-dormant copies
    can be matched against the optimizer's unassigned-copy list and excluded
    from "make this dormant" recommendations.
    """
    counter: Counter = Counter()
    for inv_item in request.inventory:
        if not inv_item.dormant:
            continue
        gem_def = GEMS.get(inv_item.gem_id)
        if gem_def is None:
            continue
        key = (inv_item.gem_id, gem_def.star_rating, inv_item.rank.strip(), inv_item.active_stars)
        counter[key] += 1
    return counter


def domain_to_response(
    result: OptimizationResult,
    upgrade_result: Optional[UpgradeOptimizationResult],
    inventory: list[InventoryGem],
    already_dormant: Optional[Counter] = None,
) -> OptimizeResponse:
    """Convert internal domain objects into a JSON-serialisable response model."""
    residual = result.total_residual_cost
    # When upgrades are applied, use the effective residual (per-slot residual +
    # upgrade GP cost) so the summary surplus reflects what the player truly has
    # left after paying for both awakening and upgrades.
    summary_residual = upgrade_result.effective_residual if upgrade_result is not None else residual
    # Dormant GP is computed below once we know which gems are unassigned.
    # We defer building the summary until after the remaining-inventory pass.

    slot_map: dict[str, SlotResponse] = {}
    bonus_table = result.bonus_table

    mg_star_map = {mg.slot_name: mg.star_rating for mg in result.main_gems}
    mg_active_stars_map = {mg.slot_name: mg.active_stars for mg in result.main_gems}

    for gr in result.gem_results:
        bonus_reqs: list[int] = bonus_table.get(gr.gem_id, [])
        assignments = result.gem_assignments.get(gr.slot_name, [])
        gem_star_rating = mg_star_map.get(gr.slot_name, 5)
        gem_active_stars = mg_active_stars_map.get(gr.slot_name, gem_star_rating)
        socket_type_map = SOCKET_STAR_TYPE[gem_star_rating]

        sockets: list[SocketResponse] = []
        for s in range(MAX_SOCKETS[gem_star_rating]):
            bonus_gem_id = bonus_reqs[s] if s < len(bonus_reqs) else None
            star_type = socket_type_map[s]

            if s >= gr.sockets_unlocked:
                sockets.append(SocketResponse(
                    socket_index=s + 1,
                    socket_star_type=star_type,
                    status="locked",
                    bonus_gem_required_id=bonus_gem_id,
                ))
            else:
                assignment = next(
                    (a for a in assignments if a.socket_index == s), None)
                if assignment is None or assignment.gem is None:
                    sockets.append(SocketResponse(
                        socket_index=s + 1,
                        socket_star_type=star_type,
                        status="empty",
                        bonus_gem_required_id=bonus_gem_id,
                    ))
                else:
                    gem = assignment.gem
                    sock_res = compute_socket_resonance_bonus(
                        gem.star_rating, gem.active_stars, gem.rank)
                    sockets.append(SocketResponse(
                        socket_index=s + 1,
                        socket_star_type=star_type,
                        status="assigned",
                        assigned_gem_id=gem.gem_id,
                        assigned_gem_star_rating=gem.star_rating,
                        assigned_gem_rank=gem.rank,
                        assigned_gem_active_stars=gem.active_stars,
                        contribution=assignment.contribution,
                        bonus_gem_required_id=bonus_gem_id,
                        bonus_activated=assignment.bonus_activated,
                        socket_resonance=sock_res,
                    ))

        slot_map[gr.slot_name] = SlotResponse(
            gem_id=gr.gem_id,
            star_rating=gem_star_rating,
            active_stars=gem_active_stars,
            target_rank=gr.target_rank,
            sockets_unlocked=gr.sockets_unlocked,
            required_power=gr.required_power,
            total_socketed_power=gr.total_socketed_power,
            residual_cost=gr.residual_cost,
            bonuses_activated=gr.bonuses_activated,
            bonuses_possible=gr.bonuses_possible,
            base_resonance=gr.base_resonance,
            socket_resonance_bonus=gr.socket_resonance_bonus,
            total_resonance=gr.total_resonance,
            sockets=sockets,
        )

    gem_results = GemResults(**slot_map)

    upgrades_response: Optional[UpgradesResponse] = None
    if upgrade_result is not None:
        bl = upgrade_result.baseline
        bl_residual = bl.total_residual_cost
        bl_D = bl.total_dormant_power
        bl_effective_available = bl.available_power + bl_D
        bl_feasible = bl_residual <= bl_effective_available
        baseline_summary = SummaryResponse(
            total_socketed_power=bl.total_socketed_power,
            total_required_power=bl.total_required_power,
            total_residual_cost=bl_residual,
            available_power=bl.available_power,
            status="feasible" if bl_feasible else "shortfall",
            surplus_or_shortfall=bl_effective_available - bl_residual,
            skipped_slots=bl.skipped_slots,
            total_resonance=bl.total_resonance,
            dormant_gem_power=bl_D,
            newly_dormant_gem_power=bl_D,
        )
        upgrades_response = UpgradesResponse(
            upgrades_applied=[
                UpgradeItem(
                    upgrade_type=d.upgrade_type,
                    gem_id=d.gem_id,
                    star_rating=d.star_rating,
                    current_rank=d.current_rank,
                    target_rank=d.target_rank,
                    gem_power_cost=d.additional_gem_power,
                    socketed_power_gain=d.additional_socket_power,
                    net_gain=d.net_gain,
                    copies_sacrificed=d.copies_sacrificed,
                )
                for d in upgrade_result.upgrades_applied
            ],
            total_upgrade_cost=upgrade_result.total_upgrade_cost,
            baseline_residual_cost=upgrade_result.baseline.total_residual_cost,
            upgraded_residual_cost=upgrade_result.upgraded.total_residual_cost,
            baseline_summary=baseline_summary,
        )

    # Compute remaining inventory and dormant gems in a single pass over the
    # unassigned copies.  Dormant GP is the sum of GP recoverable by making
    # every unsocketed gem dormant (rank-1 gems contribute 0 and are omitted
    # from dormant_gems but still appear in remaining_inventory).
    assigned_ids = {
        a.copy_id
        for assignments in result.gem_assignments.values()
        for a in assignments
        if a.copy_id >= 0
    }
    remaining_inventory: list[RemainingInventoryItem] = []
    dormant_map: dict[tuple, list[int]] = {}  # (gem_id, star, rank, active) -> [gp per copy]
    for i, gem in enumerate(inventory):
        if i in assigned_ids:
            continue
        remaining_inventory.append(RemainingInventoryItem(
            gem_id=gem.gem_id,
            star_rating=gem.star_rating,
            rank=gem.rank,
            active_stars=gem.active_stars,
            contribution=gem.contribution,
        ))
        gp = compute_extractable_power(gem.rank, _COST_TABLES[gem.star_rating])
        if gp > 0:
            key = (gem.gem_id, gem.star_rating, gem.rank, gem.active_stars)
            dormant_map.setdefault(key, []).append(gp)

    total_dormant_power = sum(gp for gplist in dormant_map.values() for gp in gplist)

    # Split each key's unassigned copies into "already dormant on input" (no-op,
    # excluded from the recommendation) and "newly" dormant (an actual action
    # the player still needs to take). already_dormant copies are consumed
    # highest-GP-first so a partially-upgraded stack's newest copy is the one
    # reported as newly dormant.
    already_dormant = already_dormant or Counter()
    dormant_gems: list[DormantGemItem] = []
    total_newly_dormant_power = 0
    for k, gplist in dormant_map.items():
        gplist_sorted = sorted(gplist, reverse=True)
        already_count = min(already_dormant.get(k, 0), len(gplist_sorted))
        already_gp = gplist_sorted[:already_count]
        newly_gp = gplist_sorted[already_count:]
        total_newly_dormant_power += sum(newly_gp)
        dormant_gems.append(DormantGemItem(
            gem_id=k[0],
            star_rating=k[1],
            rank=k[2],
            active_stars=k[3],
            quantity=len(newly_gp),
            gem_power_gained=sum(newly_gp),
            already_dormant_quantity=already_count,
        ))

    # Build summary now that we know the dormant GP.
    D = total_dormant_power
    effective_available = result.available_power + D
    feasible = summary_residual <= effective_available
    summary = SummaryResponse(
        total_socketed_power=result.total_socketed_power,
        total_required_power=result.total_required_power,
        total_residual_cost=summary_residual,
        available_power=result.available_power,
        status="feasible" if feasible else "shortfall",
        surplus_or_shortfall=effective_available - summary_residual,
        skipped_slots=result.skipped_slots,
        total_resonance=result.total_resonance,
        dormant_gem_power=D,
        newly_dormant_gem_power=total_newly_dormant_power,
    )

    return OptimizeResponse(
        summary=summary,
        gem_results=gem_results,
        upgrades=upgrades_response,
        remaining_inventory=remaining_inventory,
        dormant_gems=dormant_gems,
    )
