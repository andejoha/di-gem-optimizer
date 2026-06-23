"""Domain data models for the gem resonance optimizer.

All dataclasses representing game entities and optimization results are
defined here. No other package modules are imported; this module is a
dependency-graph leaf.
"""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class GemDef:
    """Static definition of a gem from the game data.

    Attributes:
        id: Stable numeric identifier. The first digit encodes star tier:
            5xxx = 5-star, 2xxx = 2-star, 1xxx = 1-star.
        name: Display name of the gem (e.g. ``"Blood-Soaked Jade"``).
        star_rating: Star tier of the gem (``1``, ``2``, or ``5``).
        bonus_gem_ids: IDs of gems required for each bonus socket, in socket
            order. 5-star gems have 5 entries, 2-star have 3, 1-star have 2.
    """

    id: int
    name: str
    star_rating: int
    bonus_gem_ids: list[int]


@dataclass
class UpgradeCostEntry:
    """One rank-level row from a gem upgrade cost table.

    Stores the corrected rank label (with duplicate-label fix applied) and
    the cumulative resources required to bring a gem to that rank from rank 0.

    Attributes:
        corrected_rank: Rank label after deduplication fix (e.g. ``"6.10"``
            instead of the raw ``"6.1"`` that appears twice in the source CSV).
        required_gems: Cumulative number of duplicate gem copies consumed to
            reach this rank.
        required_gem_power: Cumulative gem power spent to reach this rank.
    """

    corrected_rank: str
    required_gems: int
    required_gem_power: int


@dataclass
class InventoryGem:
    """A socketable gem copy owned by the player.

    Each instance represents a single physical copy of a gem in the player's
    inventory. The ``contribution`` field is pre-computed at parse time so it
    does not need to be recalculated during the ILP solve.

    Attributes:
        gem_id: Stable integer ID of the gem (e.g. ``2015`` for Mother's Lament).
        star_rating: Star tier of the gem (``2`` or ``5``).
        rank: Current rank string (e.g. ``"5"`` or ``"5.3"``).
        quantity: Number of copies represented by this entry (typically ``1``
            since the CSV has one row per physical copy).
        contribution: Pre-computed gem power this copy contributes when socketed,
            calculated as ``required_gems * BASE_POWER[star] + required_gem_power``.
    """

    gem_id: int
    star_rating: int
    rank: str
    quantity: int
    active_stars: int
    contribution: int = 0


@dataclass
class MainGem:
    """An equipped gem (any star rating) with an upgrade target rank.

    Captures all information needed by the optimizer: the slot it occupies,
    the gem's identity, its star rating, the desired target rank, and the
    derived metrics (required power and socket count) computed during parsing.

    Attributes:
        slot_name: Equipment slot identifier (e.g. ``"head"``, ``"chest"``).
        gem_id: Stable integer ID of the gem.
        star_rating: Star tier of the equipped gem (``1``, ``2``, or ``5``).
        target_rank: Desired upgrade rank (e.g. ``"5"`` or ``"4.1"``).
        required_power: Total gem power required to reach ``target_rank`` from
            rank 0, taken from the appropriate star-rating upgrade cost table.
        num_sockets: Number of awakening sockets unlocked at ``target_rank``,
            derived from ``num_sockets_unlocked(target_rank, star_rating)``.
        active_stars: Number of active stars (meaningful for 5-star gems only).
    """

    slot_name: str
    gem_id: int
    star_rating: int
    target_rank: str
    required_power: int
    num_sockets: int
    active_stars: int


@dataclass
class SocketAssignment:
    """The result of assigning one inventory gem copy to a specific socket.

    Produced by ``reorder_for_bonuses`` after the ILP solve and bonus-swap
    phases. An empty socket (no gem assigned) is represented with ``gem=None``
    and ``copy_id=-1``.

    Attributes:
        socket_index: Zero-based socket position (0 = first socket, unlocked at
            rank 3; 4 = fifth socket, unlocked at rank 7).
        gem: The inventory gem placed in this socket, or ``None`` if empty.
        copy_id: Unique identifier for the specific gem copy (used for
            deduplication tracking across slots). Defaults to ``-1`` when empty.
        contribution: Gem power contributed by this assignment (``0`` if empty).
        bonus_activated: ``True`` if the assigned gem matches the resonance
            bonus requirement for this socket position.
    """

    socket_index: int
    gem: Optional[InventoryGem] = None
    copy_id: int = -1
    contribution: int = 0
    bonus_activated: bool = False
    socket_resonance: int = 0


@dataclass
class GemResult:
    """Per-slot summary of optimization results for one main gem.

    Aggregates the socket assignments and key metrics for a single equipment
    slot, making it easy to report results without re-scanning assignments.

    Attributes:
        slot_name: Equipment slot identifier.
        gem_id: Stable integer ID of the gem.
        target_rank: The target upgrade rank.
        sockets_unlocked: Number of sockets available at the target rank.
        total_socketed_power: Sum of ``contribution`` across all assignments.
        required_power: Total gem power the main gem requires to reach
            ``target_rank``.
        residual_cost: ``max(0, required_power - total_socketed_power)`` — gem
            power the player must supply from their pool.
        bonuses_activated: Number of resonance bonuses activated in this slot.
        bonuses_possible: Maximum bonuses achievable (equals ``sockets_unlocked``).
        assignments: Ordered list of ``SocketAssignment`` for each unlocked
            socket in this slot.
    """

    slot_name: str
    gem_id: int
    target_rank: str
    sockets_unlocked: int
    total_socketed_power: int
    required_power: int
    residual_cost: int
    bonuses_activated: int
    bonuses_possible: int
    assignments: list[SocketAssignment] = field(default_factory=list)
    base_resonance: int = 0
    socket_resonance_bonus: int = 0
    total_resonance: int = 0


@dataclass
class UpgradeDelta:
    """Incremental cost and benefit of upgrading a single gem from one rank to another.

    Captures the economic trade-off of one upgrade step: the gem power drawn
    from the player's pool (``additional_gem_power``) versus the gain in socketed
    power if the gem is placed in a socket (``additional_socket_power``). The
    difference, ``net_gain``, quantifies the "free" leverage obtained from
    consuming extra gem copies during the upgrade.

    For a 2-star gem: ``net_gain = delta_copies * 4``.
    For a 5-star gem: ``net_gain = delta_copies * 32``.

    This is always non-negative, so upgrades are economically worthwhile whenever
    the player has spare gem power budget and the gem will actually be socketed.

    Attributes:
        gem_id: Stable integer ID of the gem being upgraded.
        star_rating: Star tier of the gem (``2`` or ``5``).
        current_rank: The gem's rank before the upgrade.
        target_rank: The rank the gem will reach after the upgrade.
        additional_gem_power: Gem power drawn from the player's pool to perform
            the upgrade (``required_gem_power[target] - required_gem_power[current]``).
            Zero for direct upgrades, where the rank jump itself costs no pool GP
            (only preparation steps do).
        additional_socket_power: Increase in the gem's socketed contribution after
            upgrading (``contribution[target] - contribution[current]``).
        net_gain: ``additional_socket_power - additional_gem_power``. Positive
            values mean the upgrade provides more socketed power than it costs.
        inventory_index: Zero-based index into the inventory list that identifies
            which gem copy this upgrade applies to.
        copies_sacrificed: Number of spare gem copies consumed as upgrade fodder.
            Zero for upgrades that require no sacrifice (e.g. rank 1 → 2 or 2 → 3
            for 2-star gems). The sacrificed copies are removed from the in-memory
            inventory and can no longer be socketed.
    """

    gem_id: int
    star_rating: int
    current_rank: str
    target_rank: str
    additional_gem_power: int
    additional_socket_power: int
    net_gain: int
    inventory_index: int
    copies_sacrificed: int = 0
    upgrade_type: str = "partial"
    """Upgrade method used: ``"partial"`` for sub-rank stepping, ``"direct"`` for
    a direct whole-rank jump, ``"preparation"`` for a partial-rank upgrade
    performed solely to prepare a material gem for a subsequent direct upgrade,
    or ``"free"`` for a zero-net-gain upgrade applied to a gem already in a
    5-star main gem socket (GP cost == additional socket power)."""
    sacrificed_gems: list["InventoryGem"] = field(default_factory=list)
    """Copies consumed during this upgrade step.  For partial upgrades these are
    the spare copies sacrificed as fodder; for direct upgrades these are the
    material gems consumed; for preparation steps these are the fodder copies
    consumed while preparing a material.  Used to restore gems to the display
    inventory when the upgrade is filtered out of the response."""
    pre_upgrade_gem: "Optional[InventoryGem]" = None
    """Snapshot of the target gem before this upgrade step was applied.  Used
    to revert the gem to its original rank when this upgrade is filtered out."""


@dataclass
class MaterialPreparationStep:
    """One partial-rank upgrade performed to prepare a material gem for a direct upgrade.

    When a direct rank upgrade requires a rank-3 or rank-5 material but the
    inventory only has lower-ranked copies, one such copy must first be upgraded
    via the partial-rank system to reach the required material tier.  This
    dataclass captures that preparatory step.

    Attributes:
        source_inventory_index: Index into the working inventory list of the gem
            being upgraded to become a material.
        source_rank: Rank of the source gem before preparation (e.g. ``"1"``).
        target_material_rank: Rank the gem must reach to serve as material
            (always ``"1"``, ``"3"``, or ``"5"``).
        gem_power_cost: Gem power drawn from the player's pool for this prep step.
        copies_consumed: Number of spare gem copies consumed as sacrifice fodder
            during the partial-rank preparation upgrade.
    """

    source_inventory_index: int
    source_rank: str
    target_material_rank: str
    gem_power_cost: int
    copies_consumed: int


@dataclass
class DirectUpgradePlan:
    """A bundled plan for performing one direct rank upgrade.

    Captures the complete recipe: which gem to upgrade, which existing inventory
    copies serve as materials, and any preparation steps needed to bring
    lower-ranked copies up to the required material tiers.

    The plan is created during the greedy upgrade selection phase and executed
    immediately when chosen as the best candidate.

    Attributes:
        gem_id: Stable integer ID of the gem being upgraded.
        star_rating: Star tier of the gem (``2`` or ``5``).
        current_rank: Whole-rank string of the gem before the upgrade (e.g. ``"7"``).
        target_rank: Whole-rank string after the upgrade (e.g. ``"8"``).
        upgrade_index: Index into the working inventory of the gem being upgraded.
        material_indices: Indices of gems consumed as direct-upgrade materials.
            After any preparation steps these gems will be at the required
            material ranks (``"1"``, ``"3"``, or ``"5"``).
        preparation_steps: Ordered list of partial-rank upgrades needed to bring
            material sources to the required tiers.  Empty when all materials
            already exist at exact required ranks.
        total_gem_power_cost: Total gem power spent on preparation steps.  The
            direct upgrade itself costs zero gem power for target ranks >= 5.
        additional_socket_power: Increase in the gem's socketed contribution after
            the upgrade (``contribution[target] - contribution[current]``).
        net_gain: ``additional_socket_power - total_gem_power_cost``.
        material_sacrificed_contribution: Total contribution of the consumed
            material gems (after preparation), used for opportunity-cost accounting.
    """

    gem_id: int
    star_rating: int
    current_rank: str
    target_rank: str
    upgrade_index: int
    material_indices: list[int]
    preparation_steps: list[MaterialPreparationStep]
    total_gem_power_cost: int
    additional_socket_power: int
    net_gain: int
    material_sacrificed_contribution: int


@dataclass
class UpgradeOptimizationResult:
    """Complete output of one upgrade optimization analysis run.

    Compares a baseline optimization (no upgrades) against an upgrade-aware
    optimization where profitable gem upgrades are applied in-memory before
    re-solving. The ``improvement`` field summarises whether the upgrades
    produced a better overall outcome for the player.

    The player's true cost is ``effective_residual``, which accounts for both
    the gem power spent on upgrades and the remaining residual cost after
    re-optimization::

        effective_residual = upgraded.total_residual_cost + total_upgrade_cost

    Attributes:
        baseline: ``OptimizationResult`` from running the optimizer with the
            original, unmodified inventory.
        upgraded: ``OptimizationResult`` from re-running the optimizer after
            applying all recommended upgrades to the in-memory inventory.
        upgrades_applied: Ordered list of ``UpgradeDelta`` instances describing
            each upgrade that was recommended, in the order they were applied.
        total_upgrade_cost: Sum of ``additional_gem_power`` across all applied
            upgrades — the total gem power drawn from the player's pool for
            upgrades alone.
        effective_residual: The player's total gem power expenditure after
            upgrades: ``upgraded.total_residual_cost + total_upgrade_cost``.
        improvement: ``baseline.total_residual_cost - effective_residual``.
            Positive means the upgrades reduce the player's overall cost.
            Zero or negative means no improvement was found.
    """

    baseline: "OptimizationResult"
    upgraded: "OptimizationResult"
    upgrades_applied: list["UpgradeDelta"]
    total_upgrade_cost: int
    effective_residual: int
    improvement: int


@dataclass
class OptimizationResult:
    """Complete output of one full optimization pipeline run.

    Returned by ``run_optimization`` and consumed by the output and test
    layers. Carries both the per-slot results and all intermediate data
    structures needed for display and CSV writing.

    Attributes:
        gem_results: One ``GemResult`` per active main gem, in slot order.
        total_socketed_power: Sum of ``total_socketed_power`` across all slots.
        total_required_power: Sum of ``required_power`` across all slots.
        total_residual_cost: Sum of ``residual_cost`` across all slots.
        available_power: The player's gem power pool.
        skipped_slots: Slot names that were skipped (empty gem name or
            missing/unknown target rank).
        gem_assignments: Mapping of ``slot_name`` to its list of
            ``SocketAssignment`` objects, as produced by ``reorder_for_bonuses``.
        bonus_table: The full bonus lookup table produced by
            ``parse_socket_bonuses``.
        main_gems: The list of active ``MainGem`` objects used in this run.
    """

    gem_results: list[GemResult]
    total_socketed_power: int
    total_required_power: int
    total_residual_cost: int
    available_power: int
    skipped_slots: list[str]
    gem_assignments: dict[str, list[SocketAssignment]]
    bonus_table: dict[int, list[int]]
    main_gems: list[MainGem]
    total_resonance: int = 0
    total_dormant_power: int = 0
