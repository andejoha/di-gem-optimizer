/**
 * Domain data models for the gem resonance optimizer. Each interface with
 * defaulted fields has a matching `make*()` factory that supplies those
 * defaults, so call sites that only care about a few fields can stay terse.
 */

/** Static definition of a gem from the game data. */
export interface GemDef {
  /** Stable numeric identifier. First digit encodes star tier: 5xxx = 5-star, 2xxx = 2-star, 1xxx = 1-star. */
  id: number;
  /** Display name of the gem (e.g. "Blood-Soaked Jade"). */
  name: string;
  /** Star tier of the gem (1, 2, or 5). */
  starRating: number;
  /** IDs of gems required for each bonus socket, in socket order. */
  bonusGemIds: number[];
}

/** One rank-level row from a gem upgrade cost table. */
export interface UpgradeCostEntry {
  /** Rank label after deduplication fix (e.g. "6.10" instead of a raw duplicate "6.1"). */
  correctedRank: string;
  /** Cumulative number of duplicate gem copies consumed to reach this rank. */
  requiredGems: number;
  /** Cumulative gem power spent to reach this rank. */
  requiredGemPower: number;
}

/** A socketable gem copy owned by the player. */
export interface InventoryGem {
  gemId: number;
  starRating: number;
  rank: string;
  quantity: number;
  activeStars: number;
  /** Pre-computed gem power this copy contributes when socketed. */
  contribution: number;
}

export function makeInventoryGem(partial: Omit<InventoryGem, 'contribution'> & { contribution?: number }): InventoryGem {
  return { contribution: 0, ...partial };
}

/** An equipped gem (any star rating) with an upgrade target rank. */
export interface MainGem {
  slotName: string;
  gemId: number;
  starRating: number;
  targetRank: string;
  requiredPower: number;
  numSockets: number;
  activeStars: number;
}

/** The result of assigning one inventory gem copy to a specific socket. */
export interface SocketAssignment {
  socketIndex: number;
  /** The inventory gem placed in this socket, or null if empty. */
  gem: InventoryGem | null;
  /** Unique identifier for the specific gem copy, or -1 when empty. */
  copyId: number;
  contribution: number;
  bonusActivated: boolean;
  socketResonance: number;
}

export function makeSocketAssignment(partial: { socketIndex: number } & Partial<Omit<SocketAssignment, 'socketIndex'>>): SocketAssignment {
  return {
    gem: null,
    copyId: -1,
    contribution: 0,
    bonusActivated: false,
    socketResonance: 0,
    ...partial,
  };
}

/** Per-slot summary of optimization results for one main gem. */
export interface GemResult {
  slotName: string;
  gemId: number;
  targetRank: string;
  socketsUnlocked: number;
  totalSocketedPower: number;
  requiredPower: number;
  residualCost: number;
  bonusesActivated: number;
  bonusesPossible: number;
  assignments: SocketAssignment[];
  baseResonance: number;
  socketResonanceBonus: number;
  totalResonance: number;
}

export function makeGemResult(
  partial: Omit<GemResult, 'assignments' | 'baseResonance' | 'socketResonanceBonus' | 'totalResonance'> &
    Partial<Pick<GemResult, 'assignments' | 'baseResonance' | 'socketResonanceBonus' | 'totalResonance'>>,
): GemResult {
  return {
    assignments: [],
    baseResonance: 0,
    socketResonanceBonus: 0,
    totalResonance: 0,
    ...partial,
  };
}

/** Incremental cost and benefit of upgrading a single gem from one rank to another. */
export interface UpgradeDelta {
  gemId: number;
  starRating: number;
  currentRank: string;
  targetRank: string;
  additionalGemPower: number;
  additionalSocketPower: number;
  netGain: number;
  inventoryIndex: number;
  copiesSacrificed: number;
  /**
   * Upgrade method used: "partial" for sub-rank stepping, "direct" for a
   * direct whole-rank jump, "preparation" for a partial-rank upgrade
   * performed solely to prepare a material gem for a subsequent direct
   * upgrade, or "free" for a zero-net-gain upgrade applied to a gem already
   * in a 5-star main gem socket (gem power cost == additional socket power).
   */
  upgradeType: string;
  /** Copies consumed during this upgrade step. */
  sacrificedGems: InventoryGem[];
  /** Snapshot of the target gem before this upgrade step was applied. */
  preUpgradeGem: InventoryGem | null;
}

export function makeUpgradeDelta(
  partial: Omit<UpgradeDelta, 'copiesSacrificed' | 'upgradeType' | 'sacrificedGems' | 'preUpgradeGem'> &
    Partial<Pick<UpgradeDelta, 'copiesSacrificed' | 'upgradeType' | 'sacrificedGems' | 'preUpgradeGem'>>,
): UpgradeDelta {
  return {
    copiesSacrificed: 0,
    upgradeType: 'partial',
    sacrificedGems: [],
    preUpgradeGem: null,
    ...partial,
  };
}

/** Complete output of one full optimization pipeline run. */
export interface OptimizationResult {
  /** One GemResult per active main gem, in slot order. */
  gemResults: GemResult[];
  totalSocketedPower: number;
  totalRequiredPower: number;
  totalResidualCost: number;
  availablePower: number;
  skippedSlots: string[];
  /** Mapping of slotName -> its list of SocketAssignment objects. */
  gemAssignments: Map<string, SocketAssignment[]>;
  /** Mapping of gemId -> bonusGemIds (the full bonus lookup table). */
  bonusTable: Map<number, number[]>;
  mainGems: MainGem[];
  totalResonance: number;
  totalDormantPower: number;
}

export function makeOptimizationResult(
  partial: Omit<OptimizationResult, 'totalResonance' | 'totalDormantPower'> &
    Partial<Pick<OptimizationResult, 'totalResonance' | 'totalDormantPower'>>,
): OptimizationResult {
  return {
    totalResonance: 0,
    totalDormantPower: 0,
    ...partial,
  };
}

/** Complete output of one upgrade optimization analysis run. */
export interface UpgradeOptimizationResult {
  baseline: OptimizationResult;
  upgraded: OptimizationResult;
  upgradesApplied: UpgradeDelta[];
  totalUpgradeCost: number;
  /** upgraded.totalResidualCost + totalUpgradeCost */
  effectiveResidual: number;
  /** baseline.totalResidualCost - effectiveResidual */
  improvement: number;
}
