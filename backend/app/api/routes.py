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
from app.core.upgrades import apply_upgrades_greedy, filter_upgrades_to_socketed

router = APIRouter(prefix="/api")


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

    # Iterative upgrade passes: after each re-solve the new socket
    # assignments may include gems that weren't socketed in the baseline,
    # making them eligible for upgrade in the next pass.  This handles cases
    # such as a second 5-star socket being "freed" when the first-pass upgrade
    # of a high-rank gem causes the greedy to move it to a different slot.
    _MAX_UPGRADE_PASSES = 4

    all_applied_raw = []        # Raw deltas from every committed pass (unfiltered)
    current_inventory = inventory
    current_result = baseline
    accumulated_upgrade_cost = 0  # Cumulative total_upgrade_cost across passes
    best_effective_residual = baseline.total_residual_cost  # Monotonically decreasing

    for pass_idx in range(_MAX_UPGRADE_PASSES):
        logger.info("upgrade pass %d: evaluating (baseline residual=%d)", pass_idx + 1, current_result.total_residual_cost)
        pass_inventory, pass_applied, pass_cost = apply_upgrades_greedy(
            inventory=current_inventory,
            available_power=available_power - accumulated_upgrade_cost,
            baseline_result=current_result,
            main_gems=main_gems,
            progress=progress if pass_idx == 0 else NullReporter(),
        )

        if not pass_applied:
            logger.info("upgrade pass %d: no upgrades found", pass_idx + 1)
            break

        logger.info(
            "upgrade pass %d: %d upgrade(s) applied, cost=%d — re-solving",
            pass_idx + 1, len(pass_applied), pass_cost,
        )
        if pass_idx == 0:
            progress.report("upgrades_rerun", "running", detail="Re-optimizing with upgrades...", force=True)
        re_solved = _run_pipeline(
            available_power, main_gems, skipped_slots, pass_inventory,
            progress=progress if pass_idx == 0 else NullReporter(),
            stage_prefix="rerun_" if pass_idx == 0 else f"rerun_pass{pass_idx}_",
        )

        # Only commit this pass if it strictly improves on the best result seen so
        # far (not just vs the original baseline), guaranteeing monotonic improvement
        # across passes.  A pass that is better than baseline but worse than the
        # previous committed pass would be a regression and must not be applied.
        candidate_raw = all_applied_raw + pass_applied
        candidate_filtered, _, _ = filter_upgrades_to_socketed(candidate_raw, re_solved.gem_assignments)
        candidate_filtered_cost = sum(d.additional_gem_power for d in candidate_filtered)
        pass_effective_residual = re_solved.total_residual_cost + candidate_filtered_cost
        if pass_effective_residual >= best_effective_residual:
            logger.info("upgrade pass %d: no improvement (effective_residual=%d), stopping", pass_idx + 1, pass_effective_residual)
            break

        logger.info(
            "upgrade pass %d: effective_residual %d→%d (re-solve residual=%d, upgrade cost=%d)",
            pass_idx + 1, best_effective_residual, pass_effective_residual,
            re_solved.total_residual_cost, pass_cost,
        )
        best_effective_residual = pass_effective_residual
        all_applied_raw = candidate_raw
        accumulated_upgrade_cost += pass_cost
        current_inventory = pass_inventory
        current_result = re_solved

    if not all_applied_raw:
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

    filtered_upgrades, dropped_ops, gems_to_restore = filter_upgrades_to_socketed(
        all_applied_raw, current_result.gem_assignments
    )
    filtered_cost = sum(d.additional_gem_power for d in filtered_upgrades)
    effective_residual = current_result.total_residual_cost + filtered_cost
    improvement = baseline.total_residual_cost - effective_residual

    upgrade_result = UpgradeOptimizationResult(
        baseline=baseline,
        upgraded=current_result,
        upgrades_applied=filtered_upgrades,
        total_upgrade_cost=filtered_cost,
        effective_residual=effective_residual,
        improvement=improvement,
    )

    # Build display inventory: start from the final pass's upgraded inventory,
    # revert ranks for dropped upgrade targets, append consumed copies to restore.
    assigned_ids = {
        a.copy_id
        for assignments in current_result.gem_assignments.values()
        for a in assignments
        if a.copy_id >= 0
    }
    display_inventory = copy.deepcopy(current_inventory)
    # Process dropped operations in reverse so multi-step chains unwind correctly
    # (e.g. rank 1→2→4.2 reverts 4.2→2 first, then 2→1).
    for _preps, main_delta in reversed(dropped_ops):
        if main_delta.pre_upgrade_gem is None:
            continue
        for i, gem in enumerate(display_inventory):
            if (
                i not in assigned_ids
                and gem.gem_id == main_delta.gem_id
                and gem.star_rating == main_delta.star_rating
                and gem.rank == main_delta.target_rank
            ):
                display_inventory[i] = main_delta.pre_upgrade_gem
                break
    display_inventory.extend(gems_to_restore)

    response = domain_to_response(current_result, upgrade_result=upgrade_result, inventory=display_inventory)
    return _finalize_r1_conversion(response, available_power_orig, r1_gems)


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
