# Golden differential corpus

A frozen snapshot of the Python backend's exact output, captured at the
commit recorded in `SOURCE_COMMIT` by a since-deleted generator script
(`backend/tools/gen_corpus.py`, removed along with the rest of `backend/`
once the migration to a client-side-only optimizer was complete and
verified). It was used to prove the TypeScript port
(`frontend/src/core/**`) reproduces the Python optimizer byte-for-byte
before any Python code was deleted -- see `frontend/src/core/__tests__/golden.test.ts`,
which still runs against this corpus on every test run as a permanent
regression suite.

Verified deterministic at generation time: regenerating under
`PYTHONHASHSEED=0` and `PYTHONHASHSEED=42` produced byte-identical output.

**This corpus can no longer be regenerated** (that required the Python
source, which no longer exists) -- it is now a fixed historical baseline.
Any future intentional change to the optimizer's behavior should update
the affected `*.expected.json` files by hand (or via a throwaway script)
alongside the code change, with the diff reviewed as carefully as the
behavior change itself.

## Layout

- `<case>.request.json` — an `OptimizeRequest` body.
- `<case>.<enable_upgrades>-<convert_1star>.expected.json` — captured
  `OptimizeResponse` for that flag combination (`0`/`1` for false/true).
- `<case>.<flags>.error.json` — captured `{status, detail}` for cases that
  raise a 422 instead of returning a response.
- `gem-data.json` — captured `GET /api/gem-data` response.

## Cases

- `fixture-*` (48 cases × 4 flag combos): the real 430-gem player fixture
  (`backend/tests/fixtures/reported_shortfall_setup.json`) swept across
  `gem_power` deltas 0..+230 in steps of 5 (matching
  `test_optimizer_monotonicity.py`), plus the raw baseline.
- `edge-*` (12 cases × 4 combos): hand-picked edge cases — single item,
  all 8 slots, zero unlocked sockets, negative pool, huge surplus, duplicate
  ids, sub-ranks, 1-star-only mains, mixed dormant flags, and 3 invalid
  requests (unknown gem id, invalid rank, no valid main gems).
- `random-*` (300 cases × 4 combos, seed 1337): randomized valid setups,
  1–8 slots, inventories from 1 to 450 gems, `gem_power` in [-2000, 20000],
  random dormant flags.

