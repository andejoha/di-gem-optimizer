"""Domain constants for the Diablo Immortal gem resonance optimizer.

All game-rule constants are defined here. Import from this module rather
than hard-coding magic numbers elsewhere in the package.
"""

BASE_POWER: dict[int, int] = {1: 1, 2: 4, 5: 32}
"""Gem power contributed per copy of a socketed gem, keyed by star rating.

A rank-N gem contributes ``required_gems * BASE_POWER[star] + required_gem_power``
towards the main gem's required power. These values encode the game's gem-power
economy per star tier.

Keys:
    1: Base power per 1-star gem copy (1 GP).
    2: Base power per 2-star gem copy (4 GP).
    5: Base power per 5-star gem copy (32 GP).
"""

SOCKET_STAR_TYPE: dict[int, dict[int, int]] = {
    1: {0: 1, 1: 1},
    2: {0: 1, 1: 2, 2: 2},
    5: {0: 2, 1: 2, 2: 2, 3: 5, 4: 5},
}
"""Maps main gem star rating → socket index → accepted socketable gem star rating.

Keys are the star rating of the equipped main gem (1, 2, or 5).
Values map each socket index to the star rating of gem it accepts:
  - 1-star main gems: 2 sockets, both accepting 1-star gems.
  - 2-star main gems: 3 sockets — socket 0 accepts 1-star, sockets 1-2 accept 2-star.
  - 5-star main gems: 5 sockets — sockets 0-2 accept 2-star, sockets 3-4 accept 5-star.
"""

SOCKET_UNLOCK_RANK: dict[int, dict[int, int]] = {
    1: {0: 3, 1: 7},
    2: {0: 3, 1: 5, 2: 7},
    5: {0: 3, 1: 4, 2: 5, 3: 6, 4: 7},
}
"""Maps main gem star rating → socket index → minimum major rank to unlock.

Keys are the star rating of the equipped main gem (1, 2, or 5).
Values map each socket index to the minimum major rank at which it unlocks.
Locked sockets are excluded from assignments and displayed as ``[locked]``.
"""

MAX_SOCKETS: dict[int, int] = {1: 2, 2: 3, 5: 5}
"""Maximum number of awakening sockets per equipped gem, keyed by star rating."""
