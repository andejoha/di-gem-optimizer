/**
 * Domain constants for the Diablo Immortal gem resonance optimizer.
 *
 * Ported from backend/app/core/config.py. All game-rule constants live
 * here; import from this module rather than hard-coding magic numbers
 * elsewhere in core/.
 *
 * These small dicts are keyed by star rating (1, 2, 5) and are only ever
 * looked up by key, never iterated to produce ordered output -- plain
 * Records are safe here (contrast with core/data.ts, where iteration
 * order of GEMS/cost tables IS observable and Map is required).
 */

/**
 * Gem power contributed per copy of a socketed gem, keyed by star rating.
 *
 * A rank-N gem contributes `requiredGems * BASE_POWER[star] + requiredGemPower`
 * towards the main gem's required power. These values encode the game's
 * gem-power economy per star tier.
 *
 * Keys:
 *   1: Base power per 1-star gem copy (1 GP).
 *   2: Base power per 2-star gem copy (4 GP).
 *   5: Base power per 5-star gem copy (32 GP).
 */
export const BASE_POWER: Record<number, number> = { 1: 1, 2: 4, 5: 32 };

/**
 * Maps main gem star rating -> socket index -> accepted socketable gem star rating.
 *
 * Keys are the star rating of the equipped main gem (1, 2, or 5).
 * Values map each socket index to the star rating of gem it accepts:
 *   - 1-star main gems: 2 sockets, both accepting 1-star gems.
 *   - 2-star main gems: 3 sockets -- socket 0 accepts 1-star, sockets 1-2 accept 2-star.
 *   - 5-star main gems: 5 sockets -- sockets 0-2 accept 2-star, sockets 3-4 accept 5-star.
 */
export const SOCKET_STAR_TYPE: Record<number, Record<number, number>> = {
  1: { 0: 1, 1: 1 },
  2: { 0: 1, 1: 2, 2: 2 },
  5: { 0: 2, 1: 2, 2: 2, 3: 5, 4: 5 },
};

/**
 * Maps main gem star rating -> socket index -> minimum major rank to unlock.
 *
 * Keys are the star rating of the equipped main gem (1, 2, or 5).
 * Values map each socket index to the minimum major rank at which it unlocks.
 * Locked sockets are excluded from assignments and displayed as "[locked]".
 */
export const SOCKET_UNLOCK_RANK: Record<number, Record<number, number>> = {
  1: { 0: 3, 1: 7 },
  2: { 0: 3, 1: 5, 2: 7 },
  5: { 0: 3, 1: 4, 2: 5, 3: 6, 4: 7 },
};

/** Maximum number of awakening sockets per equipped gem, keyed by star rating. */
export const MAX_SOCKETS: Record<number, number> = { 1: 2, 2: 3, 5: 5 };

/**
 * Gem-setup slot order, matching backend `GemSetup` field declaration order
 * (app/api/schemas.py) exactly -- this is the order `converters.request_to_domain`
 * iterates via `GemSetup.model_fields`, and it determines `skipped_slots` order
 * and the key order of `gem_results` in every response.
 *
 * Verified identical to the pre-existing frontend/src/utils/gearAssets.ts
 * SLOT_ORDER; that module re-exports this constant rather than duplicating it.
 */
export const SLOT_ORDER = [
  'head',
  'chest',
  'shoulders',
  'legs',
  'main_hand',
  'off_hand',
  'alt_main_hand',
  'alt_off_hand',
] as const;

export type SlotName = (typeof SLOT_ORDER)[number];
