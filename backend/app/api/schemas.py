"""Pydantic request and response schemas for the gem optimizer API."""

from typing import Literal, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class GemSetupItem(BaseModel):
    gem_id: int = Field(description="Stable numeric gem ID (e.g. 5007 for Blood-Soaked Jade)")
    target_rank: str = Field(
        min_length=1, description="Desired upgrade rank (e.g. '5' or '4.4')")
    active_stars: int = Field(
        ge=1, le=5, description="Number of active stars (1 for 1-star, 2 for 2-star, 2–5 for 5-star)")


class GemSetup(BaseModel):
    head: Optional[GemSetupItem] = None
    chest: Optional[GemSetupItem] = None
    shoulders: Optional[GemSetupItem] = None
    legs: Optional[GemSetupItem] = None
    main_hand: Optional[GemSetupItem] = None
    off_hand: Optional[GemSetupItem] = None
    alt_main_hand: Optional[GemSetupItem] = None
    alt_off_hand: Optional[GemSetupItem] = None


class InventoryItem(BaseModel):
    gem_id: int = Field(description="Stable numeric gem ID")
    rank: str = Field(
        min_length=1, description="Current rank of the gem (e.g. '6' or '6.2')")
    active_stars: int = Field(
        ge=1, le=5,
        description="Number of active stars (1 for 1-star; 2 for 2-star; 2–5 for 5-star)")


class OptimizeRequest(BaseModel):
    gem_power: int = Field(
        gt=0, description="Player's available gem power pool")
    gem_setup: GemSetup = Field(
        description="Equipped gems per slot. Omitted slots are treated as empty.")
    inventory: list[InventoryItem] = Field(
        min_length=1,
        description=(
            "Socketable gem copies in the player's inventory. "
            "Each entry represents one physical copy; duplicate entries represent separate copies."
        ),
    )
    telluric_fragments: int = Field(
        default=0, ge=0,
        description="Telluric Fragments available for purchasing gems from the shop."
    )


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class SocketResponse(BaseModel):
    socket_index: int = Field(
        ge=1, le=5, description="1-based socket position")
    socket_star_type: int = Field(
        description="Star type accepted by this socket (2 or 5)")
    status: Literal["assigned", "empty", "locked"]
    assigned_gem_id: Optional[int] = None
    assigned_gem_star_rating: Optional[int] = None
    assigned_gem_rank: Optional[str] = None
    assigned_gem_active_stars: Optional[int] = None
    contribution: Optional[int] = None
    bonus_gem_required_id: Optional[int] = None
    bonus_activated: Optional[bool] = None
    socket_resonance: Optional[int] = None


class SlotResponse(BaseModel):
    gem_id: int
    star_rating: int
    active_stars: int
    target_rank: str
    sockets_unlocked: int
    required_power: int
    total_socketed_power: int
    residual_cost: int
    bonuses_activated: int
    bonuses_possible: int
    base_resonance: int
    socket_resonance_bonus: int
    total_resonance: int
    sockets: list[SocketResponse]


class SummaryResponse(BaseModel):
    total_socketed_power: int
    total_required_power: int
    total_residual_cost: int
    available_power: int
    status: Literal["feasible", "shortfall"]
    surplus_or_shortfall: int = Field(
        description="Positive = surplus gem power remaining; negative = shortfall"
    )
    skipped_slots: list[str]
    total_resonance: int


class UpgradeItem(BaseModel):
    upgrade_type: str
    gem_id: int
    star_rating: int
    current_rank: str
    target_rank: str
    gem_power_cost: int
    socketed_power_gain: int
    net_gain: int
    copies_sacrificed: int


class UpgradesResponse(BaseModel):
    upgrades_applied: list[UpgradeItem]
    total_upgrade_cost: int
    baseline_residual_cost: int
    upgraded_residual_cost: int
    baseline_summary: SummaryResponse


class ShopPurchaseItem(BaseModel):
    gem_id: int
    star_rating: int
    tf_cost: int
    surplus_improvement: int


class ShopResponse(BaseModel):
    purchases: list[ShopPurchaseItem]
    total_tf_spent: int
    remaining_tf: int
    baseline_summary: SummaryResponse


class GemResults(BaseModel):
    head: Optional[SlotResponse] = None
    chest: Optional[SlotResponse] = None
    shoulders: Optional[SlotResponse] = None
    legs: Optional[SlotResponse] = None
    main_hand: Optional[SlotResponse] = None
    off_hand: Optional[SlotResponse] = None
    alt_main_hand: Optional[SlotResponse] = None
    alt_off_hand: Optional[SlotResponse] = None


class RemainingInventoryItem(BaseModel):
    gem_id: int
    star_rating: int
    rank: str
    active_stars: int
    contribution: int


class ConvertedGemItem(BaseModel):
    gem_id: int
    quantity: int
    gem_power_gained: int


class OptimizeResponse(BaseModel):
    summary: SummaryResponse
    gem_results: GemResults
    upgrades: Optional[UpgradesResponse] = None
    shop: Optional[ShopResponse] = None
    remaining_inventory: list[RemainingInventoryItem] = []
    converted_gems: list[ConvertedGemItem] = []


# ---------------------------------------------------------------------------
# Gem data response (for frontend autocomplete)
# ---------------------------------------------------------------------------


class BonusSocket(BaseModel):
    unlock_rank: int = Field(
        description="Major rank at which this socket unlocks")
    required_gem_id: int = Field(
        description="ID of the gem required to activate this bonus")


class GemInfo(BaseModel):
    id: int = Field(description="Stable numeric gem ID")
    name: str = Field(
        description="Display name of the gem (e.g. \"Howler's Call\", \"Blood-Soaked Jade\")")
    star_rating: Literal[1, 2, 5] = Field(description="Star tier of the gem")
    bonus_gems: list[BonusSocket] = Field(
        description="Bonus requirements per socket, ordered by unlock rank")
