---
name: bonus-activation
description: Describes the bonus activation modes (off/budget/forced). Use this to cross reference the implementation with the intended behavior of that feature.
---

# Bonus Activation Modes

A player-selectable strategy (`bonusMode`, alongside `enableUpgrades` and `convert1Star`) for how
aggressively the optimizer chases activatable "set" bonuses, on top of the always-on, cost-free
tie-break described in `docs/SPEC.md` ("Bonus activation"). See `docs/SPEC.md` ("Bonus activation
modes") for the game rule; this skill covers how each mode is applied.

## Off (tie-break only)

The default and the behavior `docs/SPEC.md`'s core "Bonus activation" section describes: a bonus is
only ever activated when it's free — a numeric tie between candidate copies. Never spends gem power
or resonance on a bonus, never moves a copy between main gems for one.

## Forced mode

A pre-filter on the candidate pool inside the pipeline itself, applied before the normal
closest-fit/highest-resonance argmin runs in both `solveAssignment` and `fillEmptySockets`: at every
pick, restrict the pool to copies that would activate the target main gem's still-unsatisfied
requirement in the socket group being filled, falling back to the full pool only when no such copy
is currently available. "Currently available" means the live candidate pool at that pick — copies
already spent by an earlier pick don't count. Because the argmin then runs within that restricted
pool, a bonus-activating copy is always preferred over a better power fit or higher resonance, which
is why forced mode gives up the feasibility guarantee: it can pick a far worse gem than `off` would,
purely to chase a bonus.

## Budget mode

A single post-pipeline swap search (`bonusBudget.ts`) that runs after everything else has settled —
the base pipeline, the upgrade depth search if enabled, and (implicitly, since it operates on the
same surplus the response reports) rank-1 conversion. The plan's surplus gem power at that point is
the budget, and the guarantee is exactly that: because every kept swap must leave surplus `>= 0`,
this pass can never turn a feasible plan into a shortfall, and it's a provable no-op when the plan is
already in shortfall (no swap can raise a negative surplus to non-negative).

### Socket visit order

Sockets are visited star type descending (5-star, then 2-star, then 1-star), and within a star type,
round-robin by socket rank across main gems: the 1st unlocked socket of that type on every main gem
that has one, then each main gem's 2nd, then 3rd, and so on — never a main gem's 2nd socket of a
level before every main gem's 1st. Main gems are ordered by equipment slot (`SLOT_ORDER`). A socket
already activated is skipped.

### Candidates and ordering

For an unactivated socket requiring gem X, candidates are every copy of X currently dormant or
socketed in a _different_ main gem (a copy already in the target's own bag would already be
activated by phase 3's exact-match pass, so it's never a candidate). Candidates are tried highest
rank first — equivalently, highest contribution first, since contribution is strictly increasing
along a tier's rank order — with the lowest copy id breaking ties for determinism. Every candidate is
tried in that order before giving up on a socket.

### The swap and its guards

A swap moves the candidate into the target socket's main gem and, if the socket held a gem, moves
that displaced gem into the candidate's old spot (into the donor main gem's bag if the candidate came
from one, or to dormancy if it came from the dormant pool). The whole optimizer result is
re-materialized after every trial swap, and the trial is kept only if, afterward, surplus is still
`>= 0` **and** the total number of activated bonuses across every main gem strictly increases —
otherwise it's reverted and the next candidate (or socket) is tried. There is no resonance guard: a
kept swap can lower a main gem's total resonance. The bonus-count guard is what
makes a same-tier "steal" from another main gem sound: taking an activated gem away from one main gem
to activate a different main gem's socket is only kept when it nets a real gain overall (e.g. the
displaced gem itself lands on and activates a _different_ still-open socket at the donor) — a swap
that would just relocate the same single activation elsewhere is rejected.

### Interaction with the upgrade search

Because budget mode runs after the upgrade search has already chosen a depth and result, a swap can
displace an upgraded gem out of a 5-star main gem's socket. When that happens, the upgrade's cost is
refunded (it's no longer socketed in a five-star main gem, so §4's "kept only if socketed" rule drops
it). Its fodder is only also recovered if the displaced gem ends up fully dormant -- if the swap
instead moved it into a different main gem's socket, the gem is still genuinely in use, so its
fodder isn't fabricated back into the display inventory (see `filterUpgradesToSocketed` in
`upgrades.ts`). The upgrade bookkeeping and display inventory are fully re-derived from the
post-swap assignments, not patched, so both cases fall out correctly rather than needing
special-casing.
