/**
 * Wire-format request/response types for the gem optimizer: the shapes
 * that cross into and out of `runOptimization`. These use snake_case field
 * names matching the JSON contract exactly, in contrast to the camelCase
 * internal domain types in core/models.ts. Optional fields must be set to
 * explicit `null` here, never left `undefined` -- `JSON.stringify` omits
 * `undefined` keys entirely, which would silently change the response shape.
 */

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

export interface GemSetupItem {
  gem_id: number;
  target_rank: string;
  active_stars: number;
}

export interface GemSetup {
  head?: GemSetupItem | null;
  chest?: GemSetupItem | null;
  shoulders?: GemSetupItem | null;
  legs?: GemSetupItem | null;
  main_hand?: GemSetupItem | null;
  off_hand?: GemSetupItem | null;
  alt_main_hand?: GemSetupItem | null;
  alt_off_hand?: GemSetupItem | null;
}

export interface InventoryItem {
  gem_id: number;
  rank: string;
  active_stars: number;
  dormant?: boolean;
}

export interface OptimizeRequest {
  gem_power: number;
  gem_setup: GemSetup;
  inventory: InventoryItem[];
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface SocketResponse {
  socket_index: number;
  socket_star_type: number;
  status: 'assigned' | 'empty' | 'locked';
  assigned_gem_id: number | null;
  assigned_gem_star_rating: number | null;
  assigned_gem_rank: string | null;
  assigned_gem_active_stars: number | null;
  contribution: number | null;
  bonus_gem_required_id: number | null;
  bonus_activated: boolean | null;
  socket_resonance: number | null;
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
  newly_dormant_gem_power: number;
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

export interface GemResults {
  head: SlotResponse | null;
  chest: SlotResponse | null;
  shoulders: SlotResponse | null;
  legs: SlotResponse | null;
  main_hand: SlotResponse | null;
  off_hand: SlotResponse | null;
  alt_main_hand: SlotResponse | null;
  alt_off_hand: SlotResponse | null;
}

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
  already_dormant_quantity: number;
}

export interface OptimizeResponse {
  summary: SummaryResponse;
  gem_results: GemResults;
  upgrades: UpgradesResponse | null;
  remaining_inventory: RemainingInventoryItem[];
  converted_gems: ConvertedGemItem[];
  dormant_gems: DormantGemItem[];
}

export interface BonusSocket {
  unlock_rank: number;
  required_gem_id: number;
}

export interface GemInfo {
  id: number;
  name: string;
  star_rating: 1 | 2 | 5;
  bonus_gems: BonusSocket[];
}
