# Gem Resonance Rules Spec

This document is the source of truth for the *game rules* the optimizer is meant to model — how
gem power, sockets, bonuses, and resonance should work in Diablo Immortal. It describes intended
behavior, independent of whatever `src/core/` currently does. When code and this document disagree,
that's a bug in one of the two: fix the code to match the rule, or update this document and explain
why in the same change (and regenerate the affected `test/golden/*.expected.json` files, reviewing
that diff as carefully as the rule change itself).

For how these rules are currently implemented, see the "Core pipeline" section of `CLAUDE.md` and
the referenced source files. This document does not restate implementation details (data structures,
algorithms) except where needed to state a rule precisely.

## 1. Main gems, sockets, and star tiers

A main gem is an equipped legendary gem being awakened to a target rank. Its star tier (1, 2, or 5)
determines how many awakening sockets it has and what star tier of gem each socket accepts:

| Main gem tier | Sockets | Socket 0 | Socket 1 | Socket 2 | Socket 3 | Socket 4 |
| ------------- | ------- | -------- | -------- | -------- | -------- | -------- |
| 1-star        | 2       | 1-star   | 1-star   | —        | —        | —        |
| 2-star        | 3       | 1-star   | 2-star   | 2-star   | —        | —        |
| 5-star        | 5       | 2-star   | 2-star   | 2-star   | 5-star   | 5-star   |

A socket only accepts a gem copy of the exact star tier assigned to its index — a 2-star socket
cannot hold a 1-star or 5-star gem copy, regardless of rank or gem power.

### Socket unlock schedule

Sockets unlock progressively as the main gem's own rank increases; a socket at or below its unlock
rank is locked and excluded from assignment entirely (never counted as available, never displayed
as fillable — shown as "[locked]"):

| Main gem tier | Socket 0 | Socket 1 | Socket 2 | Socket 3 | Socket 4 |
| ------------- | -------- | -------- | -------- | -------- | -------- |
| 1-star        | rank 3   | rank 7   | —        | —        | —        |
| 2-star        | rank 3   | rank 5   | rank 7   | —        | —        |
| 5-star        | rank 3   | rank 4   | rank 5   | rank 6   | rank 7   |

Sub-rank decimals (e.g. `"4.3"`) do not unlock additional sockets — only the integer/major rank
counts. A gem at rank `"6.10"` has the same sockets unlocked as one at rank `"6"`.

## 2. Gem power and awakening cost

Awakening a main gem to its target rank has a **required power** cost (`MainGem.requiredPower`).
Socketing gem copies into that main gem's unlocked sockets contributes gem power toward that cost:

```
contribution(gem) = requiredGems(gem.rank) * BASE_POWER[gem.starRating] + requiredGemPower(gem.rank)
```

where `requiredGems`/`requiredGemPower` come from that star tier's cumulative upgrade cost table
(the cumulative copies and gem power spent to reach that gem's own rank), and `BASE_POWER` is the
per-copy base value for the socketed gem's tier: 1 for 1-star, 4 for 2-star, 32 for 5-star.

### Only 5-star main gems get an offset

**This is the central rule of the whole system**: socketed gem power reduces the awakening cost
*only* for a 5-star main gem. For a 1-star or 2-star main gem, the full required power is always
due regardless of what's socketed — the residual cost for a 1/2-star main gem never drops below
`requiredPower`, and socketing gems into it does not spend the player's power pool at all (its
sockets exist only for the resonance bonuses described below).

```
residual(mainGem) = mainGem.starRating === 5
  ? max(0, requiredPower - totalSocketedContribution)
  : requiredPower
```

The player's total power draw across all equipped gems is the sum of every main gem's residual.
That total must not exceed the player's available power pool for the plan to be feasible.

### Dormant power

Any inventory gem copy not placed in any socket can be made "dormant" (broken back down), recovering
the cumulative gem power spent upgrading it to its current rank (`requiredGemPower` from the cost
table — not the copies consumed to get there, and not anything for a rank-1 gem, since rank 1 costs
0 gem power). This recoverable amount is available as extra power toward the overall plan even
though it's never socketed.

### Rank-1 1-star conversion (`convert1Star`)

A rank-1 1-star gem is worthless both as a socketed gem (near-zero contribution) and, on its own,
as upgrade fodder unless paired with more copies. The player may instead choose to cash each one in
directly for 1 unit of gem power, added straight to the available pool before optimization runs.
This is a player choice (an optional input flag), not something that happens automatically — the
optimizer must also report how many of those converted gems were actually needed, and return the
rest to the display inventory untouched.

## 3. Resonance

Resonance is a separate stat from gem power/awakening cost — it is not spent from or drawn against
the power pool, and it does not affect whether a plan is feasible. It is purely additive: a main
gem's total resonance sums a base value from the gem's own rank plus a bonus contributed by each of
its sockets.

### Base resonance

The base resonance of an equipped gem depends on its own star tier, rank, and (for 5-star gems only)
how many stars are currently active on it:

- 1-star and 2-star gems: base resonance is a function of rank alone.
- 5-star gems: base resonance is a function of rank *and* active star count (2 through 5 stars).

### Socket resonance bonus

Each socketed gem contributes a resonance bonus to its host main gem, scaled by the socketed gem's
own integer rank (sub-rank decimals are truncated — a rank `"5.4"` gem counts as rank 5 for this
purpose):

| Socketed gem tier                       | Bonus per socket           |
| ---------------------------------------- | --------------------------- |
| 1-star                                   | `1 × integerRank`           |
| 2-star                                   | `2 × integerRank`           |
| 5-star, 2/3/4 active stars               | `10 × integerRank`          |
| 5-star, 5 active stars (fully awakened)  | `11 × integerRank`          |

A main gem's total resonance is `baseResonance + sum(socketResonanceBonus for each occupied socket)`.

### Bonus activation ("set" bonuses)

Independent of the resonance-per-rank formula above, each main gem also defines a **required gem
identity per socket index** — a specific gem the player is meant to place in that exact socket to
activate a bonus. This is per main-gem-type and per-socket-position, not a shared/global
requirement: main gem A's socket 0 may require gem X while main gem B's socket 0 requires gem Y, and
a main gem's own 5 requirements generally reference 5 *different* gems (3 two-star + 2 five-star,
matching that main gem's socket tiers).

A socket's bonus is activated if and only if the gem copy placed there has the exact gem ID required
for that socket index on that main gem — matching gem tier and rank are *not* sufficient; it must be
the specific gem the requirement names. An empty socket, or a socket holding a gem other than the
one required for its position, does not activate a bonus.

The optimizer should prefer orderings of correctly-typed gems across a main gem's sockets that
maximize the count of activated bonuses, without changing *which* gems are assigned to that main gem
overall — i.e. bonus activation should be resolved by socket ordering (permutation) alone, on top of
whatever assignment/redistribution already decided.

## 4. Upgrading gems

The player can spend spare copies of a gem as fodder to raise a socketed (or about-to-be-socketed)
gem's rank, at a gem-power cost defined by that star tier's cost table. This trades some of the
player's inventory (fodder copies) plus gem power for a higher-contribution gem in one socket.

Conceptually, an upgrade step can be one of four kinds (see `UpgradeDelta.upgradeType`):

- **`partial`** — a sub-rank step: the gem advances to the next rank tier that requires strictly
  more cumulative fodder copies than its current rank, consuming exactly that many additional
  rank-1 copies of itself.
- **`direct`** — a whole-rank jump performed in a single step rather than as a sequence of
  sub-rank steps.
- **`preparation`** — a partial-rank upgrade applied to a *different* gem solely so that gem can
  then be sacrificed as fodder for a subsequent direct upgrade (i.e. the prep step's own resulting
  rank, not its original rank, is what's needed as material).
- **`free`** — an upgrade with zero net gain (gem power cost equals the additional socket power it
  provides) applied to a gem already sitting in a 5-star main gem's socket — worth doing because it
  costs the player nothing net, even though it doesn't improve the residual.

An upgrade should only be kept in the final plan if its resulting rank actually ends up socketed in
a 5-star main gem (upgrades into 1/2-star main gem sockets are cost-neutral per §2 and should not be
paid for). If a chain of upgrade steps was applied to reach a rank that ultimately isn't socketed,
none of that chain's gem-power cost should be charged, and its fodder should be returned to the
display inventory.

Two-star upgrade material should be preferred over five-star upgrade material when a choice exists,
since five-star gems return substantially more socketed power per unit of gem power spent — five-star
upgrade potential should be preserved as long as possible before falling back to it.

## 5. Feasibility

A plan is **feasible** when the total residual cost across all main gems (§2) is covered by the sum
of the player's available power pool and total dormant power (§2), after accounting for any upgrade
cost incurred (§4) and any rank-1 conversion applied (§2). Otherwise it is a **shortfall**, reported
as the (negative) difference.
