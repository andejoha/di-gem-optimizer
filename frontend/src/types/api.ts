/**
 * Re-exports of the request/response types from core/api/types.ts, kept
 * here so the app's components can import from a stable, shared location.
 */

export type { SlotName } from '../core/constants';
export type {
  BonusSocket,
  ConvertedGemItem,
  DormantGemItem,
  GemInfo,
  GemResults,
  GemSetup,
  GemSetupItem,
  InventoryItem,
  OptimizeRequest,
  OptimizeResponse,
  RemainingInventoryItem,
  SlotResponse,
  SocketResponse,
  SummaryResponse,
  UpgradeItem,
  UpgradesResponse,
} from '../core/api/types';

export type StarRating = 1 | 2 | 5;
