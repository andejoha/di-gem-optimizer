"""FastAPI route definitions for the gem optimizer API."""

import asyncio
import copy
import json
import logging
import queue
import time

logger = logging.getLogger(__name__)

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.api.converters import domain_to_response, request_to_domain
from app.api.schemas import BonusSocket, ConvertedGemItem, GemInfo, OptimizeRequest, OptimizeResponse, RemainingInventoryItem
from app.core.config import SOCKET_UNLOCK_RANK
from app.core.data import GEMS
from app.core.models import UpgradeOptimizationResult
from app.core.pipeline import _run_pipeline
from app.core.progress import NullReporter, ProgressReporter, QueueReporter
from app.core.upgrades import (
    build_upgrade_chains,
    compute_socket_counts,
    filter_upgrades_to_socketed,
    materialize_upgrades,
)

router = APIRouter(prefix="/api")


def _gem_name(gem_id: int) -> str:
    """Return the display name for a gem ID, falling back to the ID as a string."""
    return GEMS[gem_id].name if gem_id in GEMS else str(gem_id)


@router.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    """Return a simple health-check response."""
    return {"status": "ok"}


@router.get("/gem-data", response_model=list[GemInfo], tags=["meta"])
def gem_data() -> list[GemInfo]:
    """Return all known gems with their socket bonus requirements.

    Each item includes the normalized gem name, its star rating, and the bonus
    gem required at each unlocked socket position. Useful for building
    autocomplete dropdowns and resonance planners in a frontend.
    """
    gems: list[GemInfo] = []
    for g in GEMS.values():
        unlock_ranks = SOCKET_UNLOCK_RANK[g.star_rating]
        bonus_sockets = [
            BonusSocket(unlock_rank=unlock_ranks[i], required_gem_id=req_id)
            for i, req_id in enumerate(g.bonus_gem_ids)
            if req_id
        ]
        gems.append(GemInfo(id=g.id, name=g.name, star_rating=g.star_rating, bonus_gems=bonus_sockets))
    return gems


def _finalize_r1_conversion(
    response: OptimizeResponse,
    available_power_orig: int,
    r1_gems: list,
) -> OptimizeResponse:
    """Reconcile pre-extracted R1 1-star gems with the optimization result.

    Before optimization, R1 1-star gems were removed from inventory and their
    count added to available_power so the optimizer (including the upgrade pass)
    could use that gem power. This function determines how many were actually
    needed, reports them as converted, and returns the rest to remaining_inventory.

    Args:
        response: The fully built OptimizeResponse (with effective_power).
        available_power_orig: The player's original gem power before pre-extraction.
        r1_gems: The InventoryGem objects that were pre-extracted.
    """
    if not r1_gems:
        return response

    total_residual = response.summary.total_residual_cost
    gems_used = min(len(r1_gems), max(0, total_residual - available_power_orig))

    # Restore unused R1 gems to remaining_inventory
    unused = r1_gems[gems_used:]
    restored = [
        RemainingInventoryItem(
            gem_id=g.gem_id,
            star_rating=g.star_rating,
            rank=g.rank,
            active_stars=g.active_stars,
            contribution=g.contribution,
        )
        for g in unused
    ]

    # Patch available_power to reflect only what was actually used
    new_available = available_power_orig + gems_used
    new_surplus = new_available - total_residual

    patched_summary = response.summary.model_copy(update={
        "available_power": new_available,
        "status": "feasible" if new_surplus >= 0 else "shortfall",
        "surplus_or_shortfall": new_surplus,
    })

    # Also patch the baseline_summary inside the upgrades block: it was
    # computed with the R1-inflated available_power and must be reconciled
    # the same way so the "Without upgrades" surplus is not overstated.
    patched_upgrades = response.upgrades
    if response.upgrades is not None:
        bl_residual = response.upgrades.baseline_summary.total_residual_cost
        bl_gems_used = min(len(r1_gems), max(0, bl_residual - available_power_orig))
        bl_new_available = available_power_orig + bl_gems_used
        bl_new_surplus = bl_new_available - bl_residual
        patched_baseline_summary = response.upgrades.baseline_summary.model_copy(update={
            "available_power": bl_new_available,
            "status": "feasible" if bl_new_surplus >= 0 else "shortfall",
            "surplus_or_shortfall": bl_new_surplus,
        })
        patched_upgrades = response.upgrades.model_copy(update={
            "baseline_summary": patched_baseline_summary,
        })

    if gems_used == 0:
        return response.model_copy(update={
            "summary": patched_summary,
            "upgrades": patched_upgrades,
            "remaining_inventory": response.remaining_inventory + restored,
        })

    id_to_qty: dict[int, int] = {}
    for g in r1_gems[:gems_used]:
        id_to_qty[g.gem_id] = id_to_qty.get(g.gem_id, 0) + 1

    converted_gems = [
        ConvertedGemItem(gem_id=gem_id, quantity=qty, gem_power_gained=qty)
        for gem_id, qty in id_to_qty.items()
    ]
    return response.model_copy(update={
        "summary": patched_summary,
        "upgrades": patched_upgrades,
        "remaining_inventory": response.remaining_inventory + restored,
        "converted_gems": converted_gems,
    })


def _run_optimization(
    request: OptimizeRequest,
    enable_upgrades: bool,
    convert_1star: bool,
    progress: ProgressReporter = NullReporter(),
) -> OptimizeResponse:
    """Core optimization logic shared by both the plain POST and SSE endpoints."""
    available_power, main_gems, skipped_slots, inventory = request_to_domain(request)

    if not main_gems:
        raise HTTPException(
            status_code=422,
            detail="No valid main gems found in gem_setup. Provide at least one slot with a valid gem_id and target_rank.",
        )

    # Pre-extract R1 1-star gems so the optimizer (including the upgrade pass)
    # sees their gem-power equivalent in available_power from the start.
    available_power_orig = available_power
    r1_gems = []
    if convert_1star:
        r1_gems = [g for g in inventory if g.star_rating == 1 and g.rank == "1"]
        inventory = [g for g in inventory if not (g.star_rating == 1 and g.rank == "1")]
        available_power = available_power + len(r1_gems)

    baseline = _run_pipeline(available_power, main_gems, skipped_slots, inventory, progress=progress)

    if not enable_upgrades:
        response = domain_to_response(baseline, upgrade_result=None, inventory=inventory)
        return _finalize_r1_conversion(response, available_power_orig, r1_gems)

    # Build upgrade chains (one per socketable gem type) and run the
    # max-out → optimize → downgrade walk.
    socket_counts = compute_socket_counts(main_gems)
    chains, leftover = build_upgrade_chains(inventory, socket_counts)

    for chain in chains:
        if chain.steps:
            rank_path = " → ".join(
                [chain.base_sub_inventory[0].rank] + [step.to_rank for step in chain.steps]
            )
            logger.debug(
                "upgrade chain: %s (gem_id=%d, %d-star)  %s  (%d steps, base_copies=%d)",
                _gem_name(chain.gem_id), chain.gem_id, chain.star_rating, rank_path,
                len(chain.steps), len(chain.base_sub_inventory),
            )
        else:
            logger.debug(
                "upgrade chain: %s (gem_id=%d, %d-star)  no steps (copies=%d)",
                _gem_name(chain.gem_id), chain.gem_id, chain.star_rating,
                len(chain.base_sub_inventory),
            )

    if not any(c.steps for c in chains):
        upgrade_result = UpgradeOptimizationResult(
            baseline=baseline,
            upgraded=baseline,
            upgrades_applied=[],
            total_upgrade_cost=0,
            effective_residual=baseline.total_residual_cost,
            improvement=0,
        )
        response = domain_to_response(baseline, upgrade_result=upgrade_result, inventory=inventory)
        return _finalize_r1_conversion(response, available_power_orig, r1_gems)

    progress.report("upgrades", "running", detail="Evaluating upgrade potential...", force=True)

    for chain in chains:
        if chain.steps:
            logger.info(
                "upgrade candidate: %s (gem_id=%d, %d-star)  %s → %s  (gem_power=%d)",
                _gem_name(chain.gem_id), chain.gem_id, chain.star_rating,
                chain.base_sub_inventory[0].rank,
                chain.steps[-1].to_rank,
                sum(step.gem_power_cost for step in chain.steps),
            )

    # Split chains by star rating.  The walk fully exhausts 2-star options before
    # touching any 5-star chain: 5-star gems have a higher gem-power-per-upgrade-cost
    # ratio (~0.64 vs ~0.26 for 2-star) so they should be preserved as long as possible.
    chains_2 = [c for c in chains if c.star_rating == 2]
    chains_5 = [c for c in chains if c.star_rating == 5]
    all_chains = chains_2 + chains_5  # order matters: 2-star depths first
    depths_5 = [len(c.steps) for c in chains_5]

    best_candidate: dict | None = None
    first_pipeline_run = True

    def _socketed_set(gem_assignments):
        return {
            (assignment.gem.gem_id, assignment.gem.star_rating, assignment.gem.rank)
            for assignments in gem_assignments.values()
            for assignment in assignments
            if assignment.gem is not None
        }

    def _find_peel(chain_list, depth_list, socketed):
        """Return the index of the highest-contribution socketed chain at depth > 0."""
        best_index, best_contribution = -1, -1
        for index, (chain, depth) in enumerate(zip(chain_list, depth_list)):
            if depth == 0:
                continue
            if (chain.gem_id, chain.star_rating, chain.steps[depth - 1].to_rank) not in socketed:
                continue
            contribution = chain.steps[depth - 1].contribution_after
            if contribution > best_contribution or (
                contribution == best_contribution and chain.gem_id < chain_list[best_index].gem_id
            ):
                best_contribution, best_index = contribution, index
        return best_index

    def _log_peel(chain, depth, effective_residual):
        step = chain.steps[depth - 1]
        contribution_after_removal = (
            chain.steps[depth - 2].contribution_after if depth > 1
            else chain.base_sub_inventory[0].contribution
        )
        logger.info(
            "upgrade walk: downgrade %s (gem_id=%d, %d-star)  %s → %s  (contrib %d → %d, shortfall=%d)",
            _gem_name(chain.gem_id), chain.gem_id, chain.star_rating,
            step.to_rank, step.from_rank,
            step.contribution_after, contribution_after_removal,
            effective_residual - available_power,
        )

    # Only sockets in 5-star main gems reduce residual. Gems placed in 2-star
    # main gem sockets don't offset awakening cost and must not be counted as
    # "used" when deciding which upgrades to keep or which chains to peel.
    five_star_slots = frozenset(mg.slot_name for mg in main_gems if mg.star_rating == 5)

    def _residual_assignments(gem_assignments):
        """Filter to only the slots where socketed gems actually reduce residual."""
        return {slot: asgns for slot, asgns in gem_assignments.items() if slot in five_star_slots}

    surplus_found = False
    while not surplus_found:
        # Restore 2-star chains to their maximum depth for this 5-star configuration.
        depths_2 = [len(c.steps) for c in chains_2]

        while True:
            working, applied, _ = materialize_upgrades(all_chains, depths_2 + depths_5, leftover)
            if not first_pipeline_run:
                progress.report("upgrades_rerun", "running", detail="Re-optimizing with upgrades...", force=True)
            result = _run_pipeline(
                available_power, main_gems, skipped_slots, working,
                progress=progress if first_pipeline_run else NullReporter(),
            )
            first_pipeline_run = False
            relevant = _residual_assignments(result.gem_assignments)
            filtered, dropped, restore = filter_upgrades_to_socketed(applied, relevant)
            upgrade_cost = sum(delta.additional_gem_power for delta in filtered)
            effective_residual = result.total_residual_cost + upgrade_cost

            # Collapse all non-socketed 2-star chains to depth 0 immediately.
            # A non-socketed chain at depth > 0 has its upgrade cost refunded by
            # filter_upgrades_to_socketed, but the rank-1 fodder copies it consumed
            # are gone from the inventory, inflating the residual. Restoring them
            # always improves the effective residual, so we re-evaluate before
            # recording the best candidate or checking for surplus.
            socketed = _socketed_set(relevant)
            non_socketed_indices = [
                index for index, (chain, depth) in enumerate(zip(chains_2, depths_2))
                if depth > 0
                and (chain.gem_id, chain.star_rating, chain.steps[depth - 1].to_rank) not in socketed
            ]
            if non_socketed_indices:
                for index in non_socketed_indices:
                    depths_2[index] = 0
                continue  # re-evaluate with fodder restored

            # All non-socketed chains are at depth 0 — this is a clean state.
            if best_candidate is None or effective_residual < best_candidate["effective_residual"]:
                logger.info(
                    "upgrade walk: new best  effective_residual=%d  residual=%d  upgrade_cost=%d  shortfall=%d",
                    effective_residual, result.total_residual_cost, upgrade_cost,
                    effective_residual - available_power_orig,
                )
                for slot_name, assignments in sorted(relevant.items()):
                    socketed_gems = [
                        f"{_gem_name(a.gem.gem_id)}@{a.gem.rank}({a.contribution})"
                        for a in assignments if a.gem is not None
                    ]
                    if socketed_gems:
                        logger.info("  %s: %s", slot_name, ", ".join(socketed_gems))
                best_candidate = {
                    "result": result, "filtered": filtered, "dropped": dropped,
                    "restore": restore, "effective_residual": effective_residual,
                    "upgrade_cost": upgrade_cost, "working": working,
                }

            if effective_residual <= available_power_orig:
                surplus_found = True
                break

            peel_index_2 = _find_peel(chains_2, depths_2, socketed)
            if peel_index_2 < 0:
                break  # All 2-star at depth 0 — fall through to peel one 5-star

            _log_peel(chains_2[peel_index_2], depths_2[peel_index_2], effective_residual)
            depths_2[peel_index_2] -= 1

        if surplus_found:
            break

        # All 2-star are exhausted for this 5-star configuration.
        # Use the socketed set from the last evaluation to pick which 5-star to peel.
        peel_index_5 = _find_peel(chains_5, depths_5, socketed)
        if peel_index_5 < 0:
            break  # no 5-star chains left to peel

        _log_peel(chains_5[peel_index_5], depths_5[peel_index_5], effective_residual)
        depths_5[peel_index_5] -= 1
        # depths_2 will be reset to maximum at the top of the outer loop

    # Unpack the chosen candidate.
    chosen_result = best_candidate["result"]
    filtered_upgrades = best_candidate["filtered"]
    dropped_ops = best_candidate["dropped"]
    gems_to_restore = best_candidate["restore"]
    effective_residual = best_candidate["effective_residual"]
    upgrade_cost = best_candidate["upgrade_cost"]
    chosen_working = best_candidate["working"]

    improvement = baseline.total_residual_cost - effective_residual

    upgrade_result = UpgradeOptimizationResult(
        baseline=baseline,
        upgraded=chosen_result,
        upgrades_applied=filtered_upgrades,
        total_upgrade_cost=upgrade_cost,
        effective_residual=effective_residual,
        improvement=improvement,
    )

    # Build display inventory: start from the chosen materialized inventory,
    # revert ranks for dropped upgrade targets, append consumed copies to restore.
    assigned_copy_ids = {
        assignment.copy_id
        for assignments in chosen_result.gem_assignments.values()
        for assignment in assignments
        if assignment.copy_id >= 0
    }
    display_inventory = copy.deepcopy(chosen_working)
    # Process dropped operations in reverse so multi-step chains unwind correctly
    # (e.g. rank 1→2→4.2 reverts 4.2→2 first, then 2→1).
    for _preps, main_delta in reversed(dropped_ops):
        if main_delta.pre_upgrade_gem is None:
            continue
        for index, gem in enumerate(display_inventory):
            if (
                index not in assigned_copy_ids
                and gem.gem_id == main_delta.gem_id
                and gem.star_rating == main_delta.star_rating
                and gem.rank == main_delta.target_rank
            ):
                display_inventory[index] = main_delta.pre_upgrade_gem
                break
    display_inventory.extend(gems_to_restore)

    response = domain_to_response(chosen_result, upgrade_result=upgrade_result, inventory=display_inventory)
    return _finalize_r1_conversion(response, available_power_orig, r1_gems)


def _log_assignment(response: OptimizeResponse) -> None:
    for slot_name, slot_data in response.gem_results.model_dump().items():
        if slot_data is None:
            continue
        contribs = [s["contribution"] for s in slot_data["sockets"] if s["contribution"]]
        logger.info(
            "assignment  %s: %s  residual=%d",
            slot_name,
            contribs if contribs else "(none)",
            slot_data["residual_cost"],
        )


@router.post("/optimize", response_model=OptimizeResponse, tags=["gem-power-optimizer"])
def optimize(
    request: OptimizeRequest,
    enable_upgrades: bool = False,
    convert_1star: bool = False,
) -> OptimizeResponse:
    """Run the gem power optimizer pipeline.

    Assigns inventory gems to awakening sockets of the equipped gems to
    minimise the total residual gem power the player must draw from their pool.
    Only slots provided in ``gem_setup`` are optimized; omitted slots are
    skipped.

    Set ``enable_upgrades=true`` to first analyse profitable in-inventory gem
    upgrades (those that consume spare copies to provide net gem-power leverage)
    and re-run the optimizer with the upgraded inventory.  The response
    ``upgrades`` field is populated whenever this query parameter is set.
    """
    logger.info(
        "POST /optimize  gems=%d inv=%d gp=%d upgrades=%s",
        sum(1 for v in request.gem_setup.model_dump().values() if v is not None), len(request.inventory), request.gem_power,
        enable_upgrades,
    )
    t0 = time.perf_counter()
    response = _run_optimization(request, enable_upgrades, convert_1star)
    bonuses = sum(
        s["bonuses_activated"]
        for s in response.gem_results.model_dump().values()
        if s is not None
    )
    _log_assignment(response)
    logger.info(
        "POST /optimize  done %.2fs — residual=%d surplus=%d bonuses=%d",
        time.perf_counter() - t0,
        response.summary.total_residual_cost,
        response.summary.surplus_or_shortfall,
        bonuses,
    )
    return response


@router.post("/optimize/stream", tags=["gem-power-optimizer"])
async def optimize_stream(
    request: OptimizeRequest,
    enable_upgrades: bool = False,
    convert_1star: bool = False,
) -> StreamingResponse:
    """Run the optimizer and stream progress events via Server-Sent Events.

    Yields ``event: progress`` messages during optimization, followed by a
    single ``event: result`` message containing the full ``OptimizeResponse``
    JSON, or an ``event: error`` message on failure.

    Use ``fetch()`` with a ``ReadableStream`` reader on the frontend rather
    than the browser's ``EventSource`` API (which only supports GET requests).
    """
    logger.info(
        "POST /optimize/stream  gems=%d inv=%d gp=%d upgrades=%s",
        sum(1 for v in request.gem_setup.model_dump().values() if v is not None),
        len(request.inventory), request.gem_power,
        enable_upgrades,
    )
    q: queue.Queue = queue.Queue()
    reporter = QueueReporter(q)
    loop = asyncio.get_running_loop()
    _t_start = time.perf_counter()

    # Sentinel object placed on the queue when the threadpool task finishes.
    _DONE = object()

    def _run_sync() -> None:
        try:
            result = _run_optimization(request, enable_upgrades, convert_1star, progress=reporter)
            bonuses = sum(s["bonuses_activated"] for s in result.gem_results.model_dump().values() if s is not None)
            _log_assignment(result)
            logger.info(
                "POST /optimize/stream  done %.2fs — residual=%d surplus=%d bonuses=%d",
                time.perf_counter() - _t_start,
                result.summary.total_residual_cost,
                result.summary.surplus_or_shortfall,
                bonuses,
            )
            q.put({"_type": "result", "data": result.model_dump()})
        except Exception as exc:
            detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
            q.put({"_type": "error", "data": {"detail": detail}})
        finally:
            q.put(_DONE)

    async def event_generator():
        task = loop.run_in_executor(None, _run_sync)
        try:
            # Poll the queue with a non-blocking get and yield control between
            # polls.  Never use task.done() to break: there is a TOCTOU window
            # between the queue.Empty check and the task.done() check where
            # _run_sync can finish and put (result, _DONE) onto the queue.
            # Breaking on task.done() would then exit without yielding the
            # result.  Instead we rely solely on the _DONE sentinel, which
            # _run_sync always puts via its finally block.
            while True:
                try:
                    event = q.get_nowait()
                except queue.Empty:
                    await asyncio.sleep(0.05)
                    continue

                if event is _DONE:
                    break
                if event.get("_type") == "result":
                    yield f"event: result\ndata: {json.dumps(event['data'])}\n\n"
                    return
                if event.get("_type") == "error":
                    yield f"event: error\ndata: {json.dumps(event['data'])}\n\n"
                    return
                yield f"event: progress\ndata: {json.dumps(event)}\n\n"
        finally:
            await task

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
