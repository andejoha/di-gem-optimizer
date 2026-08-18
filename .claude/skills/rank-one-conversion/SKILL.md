---
name: rank-one-conversion
description: Describes the rank-1 1-star gem conversion option. Use this to cross reference the implementation with the intended behavior of that feature.
---

# Rank-1 1-Star Conversion

An optional, player-chosen pass that cashes in spare rank-1 1-star gems directly for a flat unit of
gem power instead of socketing or upgrading them — they're worthless as either otherwise. It's the
one instance, currently, of the general gem-conversion mechanic — any gem can in principle be
converted — exposed to the player. See `docs/SPEC.md` ("Gem conversion", "Rank-1 1-star conversion")
for the game rule; this skill covers how it's applied.

Rank-1 1-star gems are pulled out of inventory and added to the available power pool _before_ the
rest of the optimizer runs, so both the base assignment and, if enabled, the upgrade search see
that power up front and never treat those gems as spare copies or socket candidates.

Only as many of the converted gems as the plan actually needed are kept converted; the rest are
returned to the player's displayed inventory untouched. Any "without upgrades" baseline comparison
is reconciled against the same pre-conversion pool, so it isn't overstated by gems that were never
actually needed.
