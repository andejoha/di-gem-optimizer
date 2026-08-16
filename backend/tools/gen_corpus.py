"""Generates the differential golden corpus used to verify the TS port.

Produces, under ``golden/`` (repo root), for each case:
    NNNN.request.json                       -- the OptimizeRequest body
    NNNN.<enable_upgrades>-<convert_1star>.expected.json  -- captured response,
        one per flag combination (4 per case), OR an .error.json if the
        request is invalid (422 path).

Also emits ``golden/gem-data.json`` (GET /api/gem-data) and
``golden/SOURCE_COMMIT`` (the freeze SHA).

Usage (from backend/):
    .venv/bin/python tools/gen_corpus.py

Read-only with respect to app/ -- this script only calls existing route
handler functions, exactly like cli.py does.
"""

import json
import random
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import HTTPException

from app.api.routes import _run_optimization, gem_data
from app.api.schemas import OptimizeRequest
from app.core.data import COST_TABLES, GEMS

ROOT = Path(__file__).resolve().parent.parent.parent
OUT = ROOT / "golden"
FIXTURE = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "reported_shortfall_setup.json"

SLOT_ORDER = ["head", "chest", "shoulders", "legs", "main_hand", "off_hand", "alt_main_hand", "alt_off_hand"]
FLAG_COMBOS = [(False, False), (False, True), (True, False), (True, True)]

FIVE_STAR_IDS = sorted(g.id for g in GEMS.values() if g.star_rating == 5)
TWO_STAR_IDS = sorted(g.id for g in GEMS.values() if g.star_rating == 2)
ONE_STAR_IDS = sorted(g.id for g in GEMS.values() if g.star_rating == 1)


def _dump(obj) -> str:
    if hasattr(obj, "model_dump_json"):
        return obj.model_dump_json(indent=2)
    return json.dumps(obj, indent=2)


def _write_case(case_id: str, request_dict: dict) -> None:
    (OUT / f"{case_id}.request.json").write_text(json.dumps(request_dict, indent=2) + "\n")
    for enable_upgrades, convert_1star in FLAG_COMBOS:
        flag_key = f"{int(enable_upgrades)}-{int(convert_1star)}"
        try:
            request = OptimizeRequest(**request_dict)
            response = _run_optimization(request, enable_upgrades, convert_1star)
            (OUT / f"{case_id}.{flag_key}.expected.json").write_text(_dump(response) + "\n")
        except HTTPException as exc:
            (OUT / f"{case_id}.{flag_key}.error.json").write_text(
                json.dumps({"status": exc.status_code, "detail": exc.detail}, indent=2) + "\n"
            )


def _rank_for(star: int, rng: random.Random) -> str:
    return rng.choice(sorted(COST_TABLES[star].keys()))


def gen_real_fixture_sweep() -> None:
    """Fixture, swept across the flag matrix and the monotonicity test's GP range."""
    base = json.loads(FIXTURE.read_text())
    base_gp = base["gem_power"]
    # Matches test_optimizer_monotonicity.py's 0..+230 sweep in steps of 5,
    # plus the raw baseline.
    deltas = [0] + list(range(0, 235, 5))
    for i, delta in enumerate(sorted(set(deltas))):
        case = {**base, "gem_power": base_gp + delta}
        _write_case(f"fixture-{i:03d}", case)


def gen_edge_cases() -> None:
    cases = {}

    cases["single-slot-single-item"] = {
        "gem_power": 100,
        "gem_setup": {"head": {"gem_id": FIVE_STAR_IDS[0], "target_rank": "5", "active_stars": 5}},
        "inventory": [{"gem_id": TWO_STAR_IDS[0], "rank": "3", "active_stars": 2}],
    }

    cases["all-eight-slots"] = {
        "gem_power": 500,
        "gem_setup": {
            slot: {"gem_id": FIVE_STAR_IDS[i % len(FIVE_STAR_IDS)], "target_rank": "5", "active_stars": 5}
            for i, slot in enumerate(SLOT_ORDER)
        },
        "inventory": [
            {"gem_id": TWO_STAR_IDS[i % len(TWO_STAR_IDS)], "rank": "4", "active_stars": 2}
            for i in range(40)
        ],
    }

    cases["zero-sockets-target-rank-1"] = {
        "gem_power": 50,
        "gem_setup": {"head": {"gem_id": FIVE_STAR_IDS[0], "target_rank": "1", "active_stars": 2}},
        "inventory": [{"gem_id": TWO_STAR_IDS[0], "rank": "3", "active_stars": 2, "dormant": True}],
    }

    cases["negative-gem-power"] = {
        "gem_power": -500,
        "gem_setup": {"head": {"gem_id": FIVE_STAR_IDS[0], "target_rank": "6", "active_stars": 5}},
        "inventory": [{"gem_id": TWO_STAR_IDS[0], "rank": "5", "active_stars": 2}],
    }

    cases["huge-surplus"] = {
        "gem_power": 50000,
        "gem_setup": {"head": {"gem_id": FIVE_STAR_IDS[0], "target_rank": "4", "active_stars": 4}},
        "inventory": [{"gem_id": TWO_STAR_IDS[0], "rank": "2", "active_stars": 2}],
    }

    cases["duplicate-gem-id-tie"] = {
        "gem_power": 100,
        "gem_setup": {"head": {"gem_id": FIVE_STAR_IDS[0], "target_rank": "6", "active_stars": 5}},
        "inventory": [
            {"gem_id": TWO_STAR_IDS[0], "rank": "5", "active_stars": 2}
            for _ in range(10)
        ],
    }

    cases["sub-ranks"] = {
        "gem_power": 300,
        "gem_setup": {"head": {"gem_id": FIVE_STAR_IDS[0], "target_rank": "8.5", "active_stars": 5}},
        "inventory": [{"gem_id": TWO_STAR_IDS[0], "rank": "7.3", "active_stars": 2}],
    }

    cases["only-one-star-mains"] = {
        "gem_power": 30,
        "gem_setup": {"head": {"gem_id": ONE_STAR_IDS[0], "target_rank": "7", "active_stars": 1}},
        "inventory": [{"gem_id": ONE_STAR_IDS[1], "rank": "3", "active_stars": 1}],
    }

    cases["mixed-dormant"] = {
        "gem_power": 80,
        "gem_setup": {"head": {"gem_id": FIVE_STAR_IDS[0], "target_rank": "5", "active_stars": 4}},
        "inventory": [
            {"gem_id": TWO_STAR_IDS[0], "rank": "4", "active_stars": 2, "dormant": True},
            {"gem_id": TWO_STAR_IDS[0], "rank": "4", "active_stars": 2, "dormant": False},
        ],
    }

    # Invalid cases (422 path).
    cases["unknown-gem-id"] = {
        "gem_power": 100,
        "gem_setup": {"head": {"gem_id": 999999, "target_rank": "5", "active_stars": 5}},
        "inventory": [{"gem_id": TWO_STAR_IDS[0], "rank": "3", "active_stars": 2}],
    }
    cases["invalid-target-rank"] = {
        "gem_power": 100,
        "gem_setup": {"head": {"gem_id": FIVE_STAR_IDS[0], "target_rank": "99", "active_stars": 5}},
        "inventory": [{"gem_id": TWO_STAR_IDS[0], "rank": "3", "active_stars": 2}],
    }
    cases["no-valid-main-gems"] = {
        "gem_power": 100,
        "gem_setup": {},
        "inventory": [{"gem_id": TWO_STAR_IDS[0], "rank": "3", "active_stars": 2}],
    }

    for name, case in cases.items():
        _write_case(f"edge-{name}", case)


def gen_random_cases(rng: random.Random, n: int) -> None:
    for i in range(n):
        num_slots = rng.randint(1, 8)
        slots = rng.sample(SLOT_ORDER, num_slots)
        setup = {}
        for slot in slots:
            star = rng.choice([5, 5, 5, 2, 1])  # weight toward 5-star mains
            ids = {5: FIVE_STAR_IDS, 2: TWO_STAR_IDS, 1: ONE_STAR_IDS}[star]
            setup[slot] = {
                "gem_id": rng.choice(ids),
                "target_rank": _rank_for(star, rng),
                "active_stars": rng.randint(1 if star == 1 else 2, 5 if star == 5 else star),
            }

        inv_size = rng.choice([1, 5, 20, 60] if i % 20 else [400, 450])
        inventory = []
        for _ in range(inv_size):
            star = rng.choice([2, 2, 5, 1])
            ids = {5: FIVE_STAR_IDS, 2: TWO_STAR_IDS, 1: ONE_STAR_IDS}[star]
            inventory.append({
                "gem_id": rng.choice(ids),
                "rank": _rank_for(star, rng),
                "active_stars": rng.randint(1 if star == 1 else 2, 5 if star == 5 else star),
                "dormant": rng.random() < 0.1,
            })

        case = {
            "gem_power": rng.randint(-2000, 20000),
            "gem_setup": setup,
            "inventory": inventory,
        }
        _write_case(f"random-{i:04d}", case)


def gen_gem_data() -> None:
    (OUT / "gem-data.json").write_text(
        json.dumps([g.model_dump(mode="json") for g in gem_data()], indent=2) + "\n"
    )


def write_source_commit() -> None:
    sha = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout.strip()
    (OUT / "SOURCE_COMMIT").write_text(sha + "\n")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    rng = random.Random(1337)

    print("Generating fixture sweep...")
    gen_real_fixture_sweep()
    print("Generating edge cases...")
    gen_edge_cases()
    print("Generating random cases...")
    gen_random_cases(rng, 300)
    print("Generating gem-data snapshot...")
    gen_gem_data()
    write_source_commit()

    n_requests = len(list(OUT.glob("*.request.json")))
    n_expected = len(list(OUT.glob("*.expected.json")))
    n_errors = len(list(OUT.glob("*.error.json")))
    print(f"Done: {n_requests} requests, {n_expected} expected responses, {n_errors} error captures.")


if __name__ == "__main__":
    main()
