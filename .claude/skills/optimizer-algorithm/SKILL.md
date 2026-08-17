---
name: optimizer-algorithm
description: Describes the legendary optimizer algorithm. Use this to cross reference implementation with the intended behavior of the optimizer.
---

# Legendary Gem Optimizer

Finds a setup of socketed legendary gems that minimizes gem power (GP) drawn from the player's
pool: a set of main gems (star 1, 2, or 5, each at a rank) plus an inventory of gems to socket.
A documented heuristic, not provably optimal — setups are tiny (≤8 main gems, 5 sockets each), so
exactness isn't needed. See `docs/SPEC.md` for game rules; this skill covers the algorithm's shape.

## Algorithm Overview

Three stages, in order:

### Stage 1 — Greedy assignment

Only **5-star** main gems participate (1/2-star sockets start empty; stage 2 handles them).

1. Sort eligible 5-star main gems by residual GP cost, descending.
2. Two passes over the inventory: all 5-star gems, then all 2-star gems. Sockets only accept their
   allowed star type.
3. Per pass, pick the main gem with the highest residual and a free socket of that type, then the
   inventory copy whose contribution is closest to that residual.
4. On a **numeric tie** (same contribution, same active stars), prefer a copy that activates the
   target socket's bonus, then one no other main gem still needs as a bonus gem — see
   `docs/SPEC.md` ("Bonus activation"). Never trades GP or resonance for a bonus; only breaks ties.
5. Update the residual and repeat until sockets of that type are full or no copies remain.

### Stage 2 — Fill empty sockets

Fills sockets still empty after stage 1, including all 1/2-star main gem sockets. Per main gem,
per socket type, picks the highest-resonance remaining compatible copy (not closest-GP-match — that
only happens in stage 1). Same bonus tie-break as stage 1, applied to resonance ties.

### Stage 3 — Socket materialization

Each main gem has a decided _set_ of copies but not yet a socket _index_ per copy. Distributes that
set across the gem's own sockets to maximize activated bonuses — never changes which copies a main
gem holds or moves copies between main gems. Per star-type group: exact requirement matches placed
first, then remaining copies fill remaining sockets in ascending socket-index/copy-id order.
