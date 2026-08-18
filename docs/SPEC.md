# Gem Resonance Rules Spec

This document is the source of truth for the _game rules_ the optimizer is meant to model — how
gem power, sockets, bonuses, and resonance should work in Diablo Immortal. It describes intended
behavior, independent of whatever `src/core/` currently does. When code and this document disagree,
that's a bug in one of the two: fix the code to match the rule, or update this document and explain
why in the same change.

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
_only_ for a 5-star main gem. For a 1-star or 2-star main gem, the full required power is always
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

### Gem conversion

Instead of socketing or upgrading a spare gem copy, the player may choose to cash it in directly for
gem power, added straight to the available pool before optimization runs. This is a player choice
(an optional input flag per conversion kind), not something that happens automatically. Conversion
is a general mechanic — any gem, of any star rating and rank, is eligible in principle, recovering
the same amount as dormant power above (the cumulative gem power spent upgrading it to its current
rank) since a converted gem is never socketed either. Whichever conversions the player enables, the
optimizer must report how many of the eligible gems were actually needed, and return the rest to the
display inventory untouched.

#### Rank-1 1-star conversion (`convert1Star`)

The one conversion currently exposed to the player targets rank-1 1-star gems specifically. On their
own, these are worthless both as a socketed gem (near-zero contribution) and as upgrade fodder
unless paired with more copies, and — since rank 1 costs 0 gem power — they would otherwise recover
nothing as dormant power either. The optimizer instead cashes each one in for a flat 1 unit of gem
power, as a special case of the general conversion mechanic above.

## 3. Resonance

Resonance is a separate stat from gem power/awakening cost — it is not spent from or drawn against
the power pool, and it does not affect whether a plan is feasible. It is purely additive: a main
gem's total resonance sums a base value from the gem's own rank plus a bonus contributed by each of
its sockets.

### Base resonance

The base resonance of an equipped gem depends on its own star tier, rank, and (for 5-star gems only)
how many stars are currently active on it:

- 1-star and 2-star gems: base resonance is a function of rank alone.
- 5-star gems: base resonance is a function of rank _and_ active star count (2 through 5 stars).

### Socket resonance bonus

Each socketed gem contributes a resonance bonus to its host main gem, scaled by the socketed gem's
own integer rank (sub-rank decimals are truncated — a rank `"5.4"` gem counts as rank 5 for this
purpose):

| Socketed gem tier                       | Bonus per socket   |
| --------------------------------------- | ------------------ |
| 1-star                                  | `1 × integerRank`  |
| 2-star                                  | `2 × integerRank`  |
| 5-star, 2/3/4 active stars              | `10 × integerRank` |
| 5-star, 5 active stars (fully awakened) | `11 × integerRank` |

A main gem's total resonance is `baseResonance + sum(socketResonanceBonus for each occupied socket)`.

### Bonus activation ("set" bonuses)

Independent of the resonance-per-rank formula above, each main gem also defines a **required gem
identity per socket index** — a specific gem the player is meant to place in that exact socket to
activate a bonus. This is per main-gem-type and per-socket-position, not a shared/global
requirement: main gem A's socket 0 may require gem X while main gem B's socket 0 requires gem Y, and
a main gem's own 5 requirements generally reference 5 _different_ gems (3 two-star + 2 five-star,
matching that main gem's socket tiers). In the shipped catalog every socket of every gem defines a
requirement (none are absent), and a requirement's tier always matches its socket's tier.

A socket's bonus is activated if and only if the gem copy placed there has the exact gem ID required
for that socket index on that main gem — matching gem tier and rank are _not_ sufficient; it must be
the specific gem the requirement names. An empty socket, or a socket holding a gem other than the
one required for its position, does not activate a bonus.

In bonus mode `off` (see "Bonus activation modes" below — the default, and the only mode the rest of
this section describes), bonus activation is a _tie-break_, never an objective. The optimizer
chooses which gem copy to socket by the criteria above (gem-power cost) and the resonance rules
above alone; it never trades gem power or resonance for a bonus. When two or more candidate copies
are **numerically indistinguishable** for a socket — identical contribution, identical resonance
bonus, identical recoverable dormant power — the optimizer must prefer, in order: one whose gem id
the target main gem still requires; then one that no _other_ main gem still requires as a bonus gem,
so a scarce bonus gem is conserved for the main gem that can activate it. Numeric equality is exact;
no tolerance applies. Because a socketed gem's contribution and resonance depend only on its tier,
rank and active star count and never on its identity, such ties are common, and this rule activates
most bonuses that are activatable at no cost.

Which socket _within_ a main gem's group of same-tier sockets a copy occupies is free — it affects
no cost or resonance — so the optimizer must distribute an already-chosen set of copies across
those sockets to maximize that main gem's activated bonuses. In bonus mode `off`, it must **not**
change _which_ copies a main gem holds, nor move copies between main gems, in pursuit of bonuses —
the two other modes below relax exactly this restriction, deliberately.

### Bonus activation modes (`bonusMode`)

Bonus activation is also an optional, player-chosen strategy — a third setting alongside upgrades
(§4) and gem conversion (§2) — with three modes:

- **`off`** (default) — the tie-break-only behavior described above; never spends gem power or
  resonance on a bonus.
- **`budget`** — a pass that runs strictly after the rest of the optimizer has finished, including
  the upgrade search (§4) if enabled, dormant-power accounting, and rank-1 conversion (§2). The
  plan's surplus gem power at that point is the budget: the pass walks every unactivated socket —
  5-star sockets before 2-star before 1-star, and, when several sockets of the same star level are
  still open, one pass across every main gem before returning to a second socket of that level on
  any one of them — and tries swapping in the gem that socket requires, sourced from either a
  dormant inventory copy or a copy currently socketed in a _different_ main gem (highest rank first,
  trying every available copy before giving up on that socket). A swap is kept only if, afterward,
  the plan's surplus is still `>= 0` **and** the total number of activated bonuses strictly
  increases; otherwise it's reverted and the next socket is tried. There is no resonance guard — a
  kept swap can lower a main gem's total resonance (§3). Because every kept swap leaves surplus
  `>= 0`, `budget` can never turn a feasible plan into a shortfall, and it is a no-op on a plan
  that's already in shortfall (no swap can raise a negative surplus to non-negative from within it).
  A swap can displace an already-applied upgrade out of its socket, in which case that upgrade's cost
  is refunded but its fodder is not recovered (§4's "kept only if socketed" rule re-applies after the
  swap, not before) — so the "Suggested Upgrades" comparison reflects the plan's final state,
  including any budget swaps, not the upgrade search's result in isolation.
- **`forced`** — instead of a post-pass, this changes _selection_ inside the optimizer itself: at
  every pick the optimizer makes (both the closest-fit and highest-resonance passes), it restricts
  the candidate pool to copies that would activate the socket's requirement, whenever at least one
  such copy is currently available — falling back to the full pool only once none remain. Unlike
  `budget`, this can select a much worse power fit or a much lower-resonance gem purely to chase a
  bonus, so it does **not** guarantee feasibility: a plan achievable without `forced` can become a
  shortfall with it enabled.

The three modes are mutually exclusive — `forced` does not additionally run the `budget` pass.

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
- **`preparation`** — a partial-rank upgrade applied to a _different_ gem solely so that gem can
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
cost incurred (§4), any gem conversion applied (§2), and any bonus activation cost incurred (§3).
Bonus mode `off` and `budget` never spend more than the plan can afford, so a plan feasible without
bonus activation stays feasible under either; bonus mode `forced` has no such guarantee and can turn
a feasible plan into a **shortfall**, reported
as the (negative) difference.
