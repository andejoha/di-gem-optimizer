/**
 * TypeScript interfaces mirroring the backend Pydantic schemas.
 * Source of truth: backend/app/api/schemas.py
 */

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export type StarRating = 1 | 2 | 5;

export type SlotName =
  | 'head'
  | 'chest'
  | 'shoulders'
  | 'legs'
  | 'main_hand'
  | 'off_hand'
  | 'alt_main_hand'
  | 'alt_off_hand';

// ---------------------------------------------------------------------------
// Request models
// ---------------------------------------------------------------------------

export interface GemSetupItem {
  gem_id: number;
  target_rank: string;
  active_stars: number;
}

export type GemSetup = {
  [K in SlotName]?: GemSetupItem | null;
};

export interface InventoryItem {
  gem_id: number;
  rank: string;
  active_stars: number;
}

export interface OptimizeRequest {
  gem_power: number;
  gem_setup: GemSetup;
  inventory: InventoryItem[];
}

// ---------------------------------------------------------------------------
// Response models
// ---------------------------------------------------------------------------

export interface SocketResponse {
  socket_index: number;
  socket_star_type: number;
  status: 'assigned' | 'empty' | 'locked';
  assigned_gem_id?: number;
  assigned_gem_star_rating?: number;
  assigned_gem_rank?: string;
  assigned_gem_active_stars?: number;
  contribution?: number;
  bonus_gem_required_id?: number;
  bonus_activated?: boolean;
  socket_resonance?: number;
}

export interface SlotResponse {
  gem_id: number;
  star_rating: number;
  active_stars: number;
  target_rank: string;
  sockets_unlocked: number;
  required_power: number;
  total_socketed_power: number;
  residual_cost: number;
  bonuses_activated: number;
  bonuses_possible: number;
  base_resonance: number;
  socket_resonance_bonus: number;
  total_resonance: number;
  sockets: SocketResponse[];
}

export interface SummaryResponse {
  total_socketed_power: number;
  total_required_power: number;
  total_residual_cost: number;
  available_power: number;
  status: 'feasible' | 'shortfall';
  surplus_or_shortfall: number;
  skipped_slots: string[];
  total_resonance: number;
  dormant_gem_power: number;
}

export interface UpgradeItem {
  upgrade_type: string;
  gem_id: number;
  star_rating: number;
  current_rank: string;
  target_rank: string;
  gem_power_cost: number;
  socketed_power_gain: number;
  net_gain: number;
  copies_sacrificed: number;
}

export interface UpgradesResponse {
  upgrades_applied: UpgradeItem[];
  total_upgrade_cost: number;
  baseline_residual_cost: number;
  upgraded_residual_cost: number;
  baseline_summary: SummaryResponse;
}

export type GemResults = {
  [K in SlotName]?: SlotResponse | null;
};

export interface RemainingInventoryItem {
  gem_id: number;
  star_rating: number;
  rank: string;
  active_stars: number;
  contribution: number;
}

export interface ConvertedGemItem {
  gem_id: number;
  quantity: number;
  gem_power_gained: number;
}

export interface DormantGemItem {
  gem_id: number;
  star_rating: number;
  rank: string;
  active_stars: number;
  quantity: number;
  gem_power_gained: number;
}

export interface OptimizeResponse {
  summary: SummaryResponse;
  gem_results: GemResults;
  upgrades?: UpgradesResponse | null;
  remaining_inventory: RemainingInventoryItem[];
  converted_gems: ConvertedGemItem[];
  dormant_gems: DormantGemItem[];
}

// ---------------------------------------------------------------------------
// Gem data (autocomplete)
// ---------------------------------------------------------------------------

export interface BonusSocket {
  unlock_rank: number;
  required_gem_id: number;
}

export interface GemInfo {
  id: number;
  name: string;
  star_rating: StarRating;
  bonus_gems: BonusSocket[];
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export interface HealthResponse {
  status: string;
}
