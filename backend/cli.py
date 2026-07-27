"""CLI interface for the Diablo Immortal gem resonance optimizer.

Calls the same route handler functions as the FastAPI endpoints.
No server required — run from the backend/ directory.

Usage:
    python cli.py health
    python cli.py gem-data
    python cli.py optimize <json_body_or_file> [--enable_upgrades] [--convert_1star]
    python cli.py decode <import_string>
"""

import argparse
import base64
import json
import os
import sys

from fastapi import HTTPException
from pydantic import ValidationError

from app.api.routes import gem_data, health, optimize
from app.api.schemas import OptimizeRequest
from app.core.data import COST_TABLES, GEMS
from app.core.rules import compute_extractable_power

SLOT_ORDER = ["head", "chest", "shoulders", "legs", "main_hand", "off_hand", "alt_main_hand", "alt_off_hand"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _serialize(result) -> str:
    if isinstance(result, dict):
        return json.dumps(result, indent=2)
    if isinstance(result, list):
        return json.dumps([item.model_dump(mode="json") for item in result], indent=2)
    return result.model_dump_json(indent=2)


def _decode_rank(encoded: int) -> str:
    main = encoded // 18 + 1
    sub = encoded % 18
    return str(main) if sub == 0 else f"{main}.{sub}"


def _decode_import_string(import_string: str, subtract_dormant: bool = True) -> dict:
    """Port of setupCodec.ts decodeSetup() — decodes base64url binary to OptimizeRequest dict.

    Args:
        import_string: Base64url-encoded share code from the frontend.
        subtract_dormant: When True (default), subtract the GP recoverable
            from already-dormant inventory copies from ``gem_power``, mirroring
            what the frontend does before submitting an optimize request
            (``HomePage.tsx`` sends ``gem_power - dormantGP``). Set False to
            get the raw share-code ``gem_power`` value instead.
    """
    # Restore standard base64 padding
    s = import_string.replace("-", "+").replace("_", "/")
    s += "==" [: (4 - len(s) % 4) % 4]
    try:
        data = base64.b64decode(s)
    except Exception as exc:
        raise ValueError(f"Invalid import code: {exc}") from exc

    if len(data) < 4:
        raise ValueError("Invalid import code: too short")

    pos = 0
    version = data[pos]; pos += 1
    if version != 0x01:
        raise ValueError(f"Unsupported version ({version})")

    gem_power = (data[pos] << 8) | data[pos + 1]; pos += 2
    slot_count = data[pos]; pos += 1

    if len(data) < pos + slot_count * 5 + 1:
        raise ValueError("Invalid import code: unexpected data length")

    gem_setup: dict = {}
    for _ in range(slot_count):
        slot_idx = data[pos]; pos += 1
        gem_id = (data[pos] << 8) | data[pos + 1]; pos += 2
        encoded_rank = data[pos]; pos += 1
        active_stars = data[pos]; pos += 1

        if slot_idx >= len(SLOT_ORDER):
            continue
        if gem_id not in GEMS:
            continue

        gem_setup[SLOT_ORDER[slot_idx]] = {
            "gem_id": gem_id,
            "target_rank": _decode_rank(encoded_rank),
            "active_stars": active_stars,
        }

    stack_count = data[pos]; pos += 1

    if len(data) < pos + stack_count * 5:
        raise ValueError("Invalid import code: unexpected data length")

    inventory: list = []
    dormant_gp = 0
    for _ in range(stack_count):
        gem_id = (data[pos] << 8) | data[pos + 1]; pos += 2
        encoded_rank = data[pos]; pos += 1
        active_stars_byte = data[pos]; pos += 1
        quantity = data[pos]; pos += 1

        # High bit encodes dormant; the low 7 bits are the active-stars count
        # (setupCodec.ts:171-172). Reading the byte raw here previously fed
        # values like 130/133 into active_stars, which fails validation.
        dormant = bool(active_stars_byte & 0x80)
        active_stars = active_stars_byte & 0x7F

        if gem_id not in GEMS:
            continue

        rank = _decode_rank(encoded_rank)
        if dormant:
            star_rating = GEMS[gem_id].star_rating
            dormant_gp += quantity * compute_extractable_power(rank, COST_TABLES[star_rating])
        for _ in range(quantity):
            inventory.append({
                "gem_id": gem_id,
                "rank": rank,
                "active_stars": active_stars,
                "dormant": dormant,
            })

    if subtract_dormant:
        gem_power -= dormant_gp

    return {"gem_power": gem_power, "gem_setup": gem_setup, "inventory": inventory}


# ---------------------------------------------------------------------------
# Command handlers
# ---------------------------------------------------------------------------


def cmd_health(_args):
    print(_serialize(health()))


def cmd_gem_data(_args):
    print(_serialize(gem_data()))


def cmd_optimize(args):
    if args.json_input == "-":
        raw = sys.stdin.read()
    elif os.path.isfile(args.json_input):
        raw = open(args.json_input).read()
    else:
        raw = args.json_input
    data = json.loads(raw)
    request = OptimizeRequest(**data)
    print(_serialize(optimize(request, enable_upgrades=args.enable_upgrades, convert_1star=args.convert_1star)))


def cmd_decode(args):
    result = _decode_import_string(args.import_string, subtract_dormant=not args.raw_gem_power)
    print(json.dumps(result, indent=2))


# ---------------------------------------------------------------------------
# CLI setup
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(description="Diablo Immortal Gem Resonance Optimizer CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("health", help="Check service health")
    sub.add_parser("gem-data", help="List all known gems and socket bonus requirements")

    opt = sub.add_parser("optimize", help="Run the gem power optimizer")
    opt.add_argument("json_input", help="Path to a JSON file or an inline JSON string (OptimizeRequest body)")
    opt.add_argument("--enable_upgrades", action="store_true", default=False, help="Analyse profitable gem upgrades before optimizing")
    opt.add_argument("--convert_1star", action="store_true", default=False, help="Convert rank-1 1-star gems to gem power")

    dec = sub.add_parser("decode", help="Decode a frontend import/export string to OptimizeRequest JSON")
    dec.add_argument("import_string", help="Base64url-encoded import string from the frontend")
    dec.add_argument(
        "--raw_gem_power", action="store_true", default=False,
        help=(
            "Report the share code's raw gem_power without subtracting already-dormant "
            "GP. By default (like the frontend before submitting) dormant GP is subtracted."
        ),
    )

    args = parser.parse_args()

    handlers = {"health": cmd_health, "gem-data": cmd_gem_data, "optimize": cmd_optimize, "decode": cmd_decode}

    try:
        handlers[args.command](args)
    except HTTPException as exc:
        print(json.dumps({"error": exc.detail, "status_code": exc.status_code}, indent=2), file=sys.stderr)
        sys.exit(1)
    except ValidationError as exc:
        print(json.dumps({"error": "Validation error", "details": exc.errors()}, indent=2, default=str), file=sys.stderr)
        sys.exit(1)
    except (json.JSONDecodeError, ValueError) as exc:
        print(json.dumps({"error": str(exc)}, indent=2), file=sys.stderr)
        sys.exit(1)
    except Exception as exc:
        print(json.dumps({"error": f"Unexpected error: {exc}"}, indent=2), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
