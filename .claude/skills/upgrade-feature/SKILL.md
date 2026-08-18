---
name: upgrade-feature
description: Describes the gem upgrade search (chain construction and depth walk). Use this to cross reference the implementation with the intended behavior of the upgrade feature.
---

# Gem Upgrade Feature

An optional pass (off by default) that spends spare inventory copies as fodder to raise a socketed
gem's rank, trading gem power and fodder for higher contribution. See `docs/SPEC.md` ("4. Upgrading
gems", "5. Feasibility") for the game rules; this skill covers the search's shape.

## Chain construction

A **chain** is one gem type at one star rating: a starting copy plus an ordered sequence of
sub-rank steps it could be raised through, each step snapshotting that type's sub-inventory at that
depth so any depth applies directly, without replaying earlier steps.

Only **5-star** main gem sockets count as upgrade targets — 1/2-star sockets never reduce residual,
so they can't justify an upgrade; gems of an unsocketable star are left untouched. Among the rest,
only the highest-value gem types are kept, one chain per available socket, ranked by contribution
then by copy count; the remainder stays ordinary inventory.

The highest-contribution copy in a chosen group is the upgrade target; the rest are fodder. Each
step advances the target to the next rank needing strictly more cumulative fodder, consuming
exactly that many of the cheapest spares. The chain stops once no rank needs more copies or spares
run out — it never proposes a step it can't fully fund.

## Depth search

A candidate is a chosen depth per chain, materialized into a working inventory and re-run through
the base assignment to see if the upgrade pays off.

Two-star chains are walked down to their lowest depth before any five-star chain is touched, since
five-star gems return far more socketed power per GP spent — their upgrade potential is preserved
as long as possible (`docs/SPEC.md` §4). Depth walks **downward** from maximum, peeling one step at
a time from the highest-contribution chain whose current result is actually socketed.

Only upgrades that end up socketed in a 5-star main gem count toward cost. That cost is added to
the base residual for the gross _effective residual_ shown to the player; recoverable power from
everything left unsocketed is then subtracted to get a _net residual_, which drives the search. A
two-star chain left above its lowest depth but unsocketed collapses back immediately and is
re-evaluated — its cost refunds but its fodder is gone, so restoring it always helps. The search
stops as soon as any candidate's net residual fits the player's original power pool, keeping the
best (lowest net residual) candidate seen — it does not keep searching to confirm that's the global
best, so a larger pool can stop the search earlier and settle for a worse depth combination than a
smaller pool would. This non-monotonicity is deliberate.

## Unwinding dropped upgrades

Each socketed rank is traced back through its chain twice, against two different definitions of
"socketed": a multi-step upgrade is kept in full (and charged) if its final rank is socketed in a
five-star main gem, or dropped in full (uncharged) if not. A dropped chain's fodder is only marked
for restoration if its final rank isn't socketed anywhere at all — a rank that landed in a 1/2-star
main gem's socket instead is uncharged but still in use, so its fodder isn't fabricated back into the
display inventory. The gems shown to the player revert each dropped upgrade's target rank to its
pre-upgrade rank, most recent step first, then
append the restored fodder — only unassigned copies are touched.
