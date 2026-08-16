/**
 * Re-exports of the real wire-format types from core/api/types.ts.
 *
 * This file used to be a hand-maintained mirror of the backend's Pydantic
 * schemas ("Source of truth: backend/app/api/schemas.py"). Now that the
 * optimizer runs entirely client-side, core/api/types.ts IS the schema --
 * this file is kept only so the ~19 existing importers across the app
 * don't need to change their import paths.
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
