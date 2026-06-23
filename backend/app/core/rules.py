"""Domain rules for the gem resonance optimizer.

Contains pure functions that encode game mechanics: gem power contribution
formulas, socket unlock schedules, and gem-name normalization. These functions
are used by io, optimizer, and output modules and are therefore placed here
(rather than in io.py) to keep the import graph unidirectional.
"""

from typing import TYPE_CHECKING

from app.core.config import BASE_POWER, SOCKET_UNLOCK_RANK
from app.core.models import UpgradeCostEntry

if TYPE_CHECKING:
    from app.core.models import MainGem, SocketAssignment


def num_sockets_unlocked(rank_str: str, star_rating: int = 5) -> int:
    """Return how many awakening sockets are unlocked at the given target rank.

    Socket unlock schedules differ by star rating (from ``SOCKET_UNLOCK_RANK``):
      - 5-star: sockets unlock at ranks 3, 4, 5, 6, 7 (up to 5 sockets).
      - 2-star: sockets unlock at ranks 3, 5, 7 (up to 3 sockets).
      - 1-star: sockets unlock at ranks 3, 7 (up to 2 sockets).

    Sub-rank decimals (e.g. ``"4.3"``) are truncated to their major rank for
    this calculation because sub-ranks do not unlock additional sockets.

    Args:
        rank_str: Rank string as it appears in the CSV (e.g. ``"5"``,
            ``"4.3"``, ``"10"``).
        star_rating: Star tier of the main gem (``1``, ``2``, or ``5``).
            Defaults to ``5`` for backward compatibility.

    Returns:
        Number of unlocked sockets. Returns ``0`` for ranks below 3 or for
        unparseable strings.
    """
    try:
        major = int(float(rank_str))
    except (ValueError, TypeError):
        return 0
    unlock_ranks = SOCKET_UNLOCK_RANK[star_rating]
    return sum(1 for unlock_rank in unlock_ranks.values() if major >= unlock_rank)


def is_socket_unlocked(socket_idx: int, rank_str: str, star_rating: int = 5) -> bool:
    """Return whether a specific socket index is unlocked at the given rank.

    A convenience predicate built on top of ``num_sockets_unlocked``.

    Args:
        socket_idx: Zero-based socket index (0-4).
        rank_str: Rank string as it appears in the CSV.
        star_rating: Star tier of the main gem (``1``, ``2``, or ``5``).

    Returns:
        ``True`` if the socket at ``socket_idx`` is unlocked at ``rank_str``,
        ``False`` otherwise.
    """
    return socket_idx < num_sockets_unlocked(rank_str, star_rating)


def compute_extractable_power(
    rank: str,
    cost_table: dict[str, UpgradeCostEntry],
) -> int:
    """Return the GP recovered when a gem at ``rank`` is made dormant.

    Making a gem dormant returns the cumulative gem power spent upgrading it
    (``required_gem_power``), but NOT the gem copies consumed as fodder.
    Rank-1 gems have ``required_gem_power == 0`` and return nothing.

    Args:
        rank: Current rank of the gem (e.g. ``"5"`` or ``"5.3"``).
        cost_table: Upgrade cost lookup table for the gem's star rating.

    Returns:
        GP recovered (``>= 0``). Returns ``0`` for unknown ranks.
    """
    entry = cost_table.get(rank)
    return entry.required_gem_power if entry else 0


def compute_contribution(
    star_rating: int,
    rank: str,
    cost_table: dict[str, UpgradeCostEntry],
) -> int:
    """Compute the total gem power a socketed gem contributes.

    Uses the upgrade cost table to determine how many gem copies and how much
    gem power have been invested at the given rank, then applies the formula::

        contribution = required_gems * BASE_POWER[star_rating] + required_gem_power

    This represents the gem power offset that a socketed copy provides towards
    the main gem's ``required_power``.

    Args:
        star_rating: Star tier of the gem (``2`` or ``5``).
        rank: Rank string as it appears in the inventory CSV
            (e.g. ``"5"`` or ``"5.3"``).
        cost_table: Upgrade cost lookup table for the gem's star rating,
            as returned by ``parse_upgrade_costs``.

    Returns:
        Total gem power contribution of one copy of this gem when socketed.

    Raises:
        ValueError: If ``rank`` is not found in ``cost_table``. This typically
            means the inventory CSV contains a rank that does not exist in the
            upgrade cost table.
    """
    entry = cost_table.get(rank)
    if entry is None:
        raise ValueError(
            f"Rank '{rank}' not found in upgrade cost table. "
            f"Available ranks: {sorted(cost_table.keys())}"
        )
    base = BASE_POWER[star_rating]
    return entry.required_gems * base + entry.required_gem_power


def compute_base_resonance(rank: str, active_stars: int, star_rating: int = 5) -> int:
    """Return the base resonance of an equipped gem at the given rank.

    Args:
        rank: Rank string (e.g. ``"5"`` or ``"4.3"``).
        active_stars: Number of active stars (2–5 for 5-star gems; ignored for
            1-star and 2-star gems which have a fixed resonance per rank).
        star_rating: Star tier of the main gem (``1``, ``2``, or ``5``).
            Defaults to ``5`` for backward compatibility.

    Returns:
        Base resonance value, or ``0`` if the rank is not found.
    """
    from app.core.data import RESONANCE_1STAR, RESONANCE_2STAR, RESONANCE_5STAR
    if star_rating == 1:
        return RESONANCE_1STAR.get(rank, 0)
    if star_rating == 2:
        return RESONANCE_2STAR.get(rank, 0)
    rank_entry = RESONANCE_5STAR.get(rank)
    if rank_entry is None:
        return 0
    return rank_entry.get(active_stars, 0)


def compute_socket_resonance_bonus(star_rating: int, active_stars: int, rank: str) -> int:
    """Return the resonance bonus a socketed gem provides to its host gem.

    The bonus depends on the socketed gem's type and rank:
      - 1-star gem: ``1 × integer_rank``
      - 2-star gem: ``2 × integer_rank``
      - 5-star gem with 2 or 3 active stars: ``10 × integer_rank``
      - 5-star gem with 4 or 5 active stars: ``11 × integer_rank``

    Args:
        star_rating: Star tier of the socketed gem (``1``, ``2``, or ``5``).
        active_stars: Active star count of the socketed gem.
        rank: Rank string of the socketed gem (e.g. ``"5.3"``).

    Returns:
        Resonance bonus as an integer.
    """
    integer_rank = int(float(rank))
    if star_rating == 1:
        return 1 * integer_rank
    if star_rating == 2:
        return 2 * integer_rank
    if active_stars in (2, 3):
        return 10 * integer_rank
    return 11 * integer_rank


def compute_slot_resonance(
    main_gem: "MainGem",
    assignments: "list[SocketAssignment]",
) -> tuple[int, int, int]:
    """Compute resonance components for one main gem slot.

    Args:
        main_gem: The equipped 5-star gem.
        assignments: Socket assignments for this slot.

    Returns:
        Tuple of ``(base_resonance, socket_bonus, total_resonance)``.
    """
    base = compute_base_resonance(main_gem.target_rank, main_gem.active_stars, main_gem.star_rating)
    socket_bonus = 0
    for a in assignments:
        if a.gem is not None:
            bonus = compute_socket_resonance_bonus(
                a.gem.star_rating, a.gem.active_stars, a.gem.rank
            )
            a.socket_resonance = bonus
            socket_bonus += bonus
    return base, socket_bonus, base + socket_bonus
