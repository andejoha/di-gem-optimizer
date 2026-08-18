---
name: bonus-activation
description: Describes the bonus activation modes (off/budget/forced). Use this to cross reference the implementation with the intended behavior of that feature.
---

# Bonus Activation Modes

A player-selectable setting (`bonusMode`, alongside `enableUpgrades` and `convert1Star`) for how
aggressively the optimizer chases activatable "set" bonuses, on top of the always-on, cost-free
tie-break described in `docs/SPEC.md` ("Bonus activation"). See `docs/SPEC.md` ("Bonus activation
modes") for the game rule; this skill covers how each mode is applied.

## Off (tie-break only)

The default: a bonus is only activated when it's free — a numeric tie between candidate copies.
Never spends gem power or resonance on a bonus, never moves a copy between main gems for one.

## Forced mode

A pre-filter on the candidate pool, applied inside `solveAssignment` and `fillEmptySockets` before
the normal closest-fit/highest-resonance argmin: at every pick, restrict the pool to copies that
would activate the target main gem's still-unsatisfied requirement, falling back to the full pool
only when no such copy is currently available (i.e. not already spent by an earlier pick). This
gives up the feasibility guarantee — it can pick a far worse gem than `off` would, purely to chase a
bonus.

## Budget mode

A single post-pipeline swap search (`bonusBudget.ts`) that runs after everything else has settled:
the base pipeline, the upgrade depth search if enabled, and rank-1 conversion. The plan's surplus gem
power at that point is the budget — every kept swap must leave surplus `>= 0`, so this pass can never
turn a feasible plan into a shortfall, and is a no-op when the plan is already in shortfall.

### Socket visit order

Star type descending (5-star, then 2-star, then 1-star), round-robin by socket rank across main gems
(each main gem's 1st unlocked socket of that type, then each one's 2nd, etc.), in `SLOT_ORDER`.
Already-activated sockets are skipped.

### Candidates and ordering

For an unactivated socket requiring gem X, candidates are every copy of X that's dormant or socketed
in a different main gem, tried highest rank first (equivalently, highest contribution first) with
lowest copy id breaking ties.

### The swap and its guards

A swap moves the candidate into the target socket's main gem; a displaced occupant goes into the
donor's bag (if the candidate came from one) or to dormancy. The result is re-materialized after
every trial, and kept only if surplus stays `>= 0` **and** total activated bonuses strictly
increase — otherwise reverted and the next candidate (or socket) is tried. There is no resonance
guard. The bonus-count guard is what makes a same-tier "steal" from another main gem sound: it's
only kept when it nets a real gain overall (e.g. the displaced gem activates a different socket at
the donor), not when it would just relocate the same activation elsewhere.

### Interaction with the upgrade search

A swap can displace an upgraded gem out of a 5-star socket, refunding its cost (no longer socketed
in a five-star main gem). Its spare copies are recovered too only if it ends up fully dormant — if
the swap moved it into a different main gem's socket instead, it's still in use, so its spare copies
aren't restored (see `filterUpgradesToSocketed` in `upgrades.ts`). Both cases fall out correctly
because the upgrade bookkeeping and display inventory are fully re-derived from the post-swap
assignments, not patched.
