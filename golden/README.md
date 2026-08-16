# Golden regression corpus

A fixed set of `OptimizeRequest`/`OptimizeResponse` pairs used as a
regression suite for the optimizer core (`frontend/src/core/**`). Every
case is run through `runOptimization` and its result compared
byte-for-byte against the corresponding `*.expected.json` file --
see `frontend/src/core/__tests__/golden.test.ts`, which runs the whole
corpus on every test run.

Any intentional change to the optimizer's behavior should update the
affected `*.expected.json` files alongside the code change, with the
diff reviewed as carefully as the behavior change itself.

## Layout

- `<case>.request.json` — an `OptimizeRequest` body.
- `<case>.<enable_upgrades>-<convert_1star>.expected.json` — the expected
  `OptimizeResponse` for that flag combination (`0`/`1` for false/true).
- `<case>.<flags>.error.json` — the expected error output for cases where
  the request is invalid.
- `gem-data.json` — the expected gem catalog output.

## Cases

- `fixture-*` (48 cases × 4 flag combos): a real 430-gem player inventory,
  swept across `gem_power` deltas 0..+230 in steps of 5, plus the raw
  baseline.
- `edge-*` (12 cases × 4 combos): hand-picked edge cases — single item,
  all 8 slots, zero unlocked sockets, negative pool, huge surplus, duplicate
  ids, sub-ranks, 1-star-only mains, mixed dormant flags, and 3 invalid
  requests (unknown gem id, invalid rank, no valid main gems).
- `random-*` (300 cases × 4 combos): randomized valid setups, 1–8 slots,
  inventories from 1 to 450 gems, `gem_power` in [-2000, 20000], random
  dormant flags.
