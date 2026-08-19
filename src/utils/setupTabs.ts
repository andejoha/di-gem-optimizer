/**
 * Multi-tab setup state: each tab holds its own gear + inventory (a `CodecState`), with
 * up to `MAX_TABS` tabs coexisting. Pure module — no localStorage access here, see
 * `src/hooks/useSetupTabs.ts` for persistence.
 */

import type { GemSetup } from '../types/api';
import type { InventoryGemStack } from '../types/inventory';
import type { CodecState } from './setupCodec';
import { generateId } from './setupCodec';
import { SLOT_ORDER } from './gearAssets';

export const MAX_TABS = 5;
export const MAX_TAB_NAME_LENGTH = 20;
const TABS_STATE_VERSION = 2;

export interface SetupTab extends CodecState {
  id: string;
  name: string;
}

export interface TabsState {
  version: 2;
  tabs: SetupTab[];
  activeTabId: string;
}

const emptySetup: CodecState = { gemSetup: {}, gemPower: 0, stacks: [] };

/** Lowest-numbered unused "Setup N" name, so deleting Setup 2 and adding a tab reuses it. */
export function defaultTabName(tabs: SetupTab[]): string {
  const used = new Set(
    tabs
      .map((t) => t.name)
      .filter((name) => /^Setup \d+$/.test(name))
      .map((name) => Number(name.slice(6))),
  );
  let n = 1;
  while (used.has(n)) n++;
  return `Setup ${n}`;
}

export function makeTab(name: string, seed: CodecState = emptySetup): SetupTab {
  return { id: generateId(), name, gemSetup: seed.gemSetup, gemPower: seed.gemPower, stacks: seed.stacks };
}

export function emptyTabsState(): TabsState {
  const tab = makeTab(defaultTabName([]));
  return { version: TABS_STATE_VERSION, tabs: [tab], activeTabId: tab.id };
}

export function addTab(state: TabsState, seed?: CodecState): TabsState {
  if (state.tabs.length >= MAX_TABS) return state;
  const tab = makeTab(defaultTabName(state.tabs), seed);
  return { ...state, tabs: [...state.tabs, tab], activeTabId: tab.id };
}

export function renameTab(state: TabsState, id: string, name: string): TabsState {
  const trimmed = name.trim().slice(0, MAX_TAB_NAME_LENGTH);
  if (!trimmed) return state;
  return { ...state, tabs: state.tabs.map((t) => (t.id === id ? { ...t, name: trimmed } : t)) };
}

export function updateTab(state: TabsState, id: string, patch: Partial<CodecState>): TabsState {
  return { ...state, tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
}

export function deleteTab(state: TabsState, id: string): TabsState {
  if (state.tabs.length === 1) {
    const cleared = makeTab(defaultTabName([]));
    return { ...state, tabs: [{ ...cleared, id }], activeTabId: id };
  }

  const index = state.tabs.findIndex((t) => t.id === id);
  if (index === -1) return state;

  const tabs = state.tabs.filter((t) => t.id !== id);
  if (state.activeTabId !== id) return { ...state, tabs };

  const nextIndex = Math.max(0, index - 1);
  return { ...state, tabs, activeTabId: tabs[nextIndex].id };
}

function isValidGemSetup(value: unknown): value is GemSetup {
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value as Record<string, unknown>).every(([slot, item]) => {
    if (!SLOT_ORDER.includes(slot as (typeof SLOT_ORDER)[number])) return false;
    if (item == null) return true;
    if (typeof item !== 'object') return false;
    const rec = item as Record<string, unknown>;
    return typeof rec.gem_id === 'number' && typeof rec.target_rank === 'string' && typeof rec.active_stars === 'number';
  });
}

function isValidStack(value: unknown): value is InventoryGemStack {
  if (typeof value !== 'object' || value === null) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.id === 'string' &&
    typeof rec.gem_id === 'number' &&
    typeof rec.rank === 'string' &&
    typeof rec.active_stars === 'number' &&
    typeof rec.quantity === 'number' &&
    !('gem_name' in rec)
  );
}

function isValidCodecState(value: unknown): value is CodecState {
  if (typeof value !== 'object' || value === null) return false;
  const rec = value as Record<string, unknown>;
  if (typeof rec.gemPower !== 'number') return false;
  if (!isValidGemSetup(rec.gemSetup)) return false;
  const firstSlot = Object.values((rec.gemSetup as Record<string, unknown>) ?? {}).find(Boolean) as Record<string, unknown> | undefined;
  if (firstSlot && 'gem_name' in firstSlot) return false;
  if (!Array.isArray(rec.stacks)) return false;
  return (rec.stacks as unknown[]).every(isValidStack);
}

function isValidTab(value: unknown): value is SetupTab {
  if (typeof value !== 'object' || value === null) return false;
  const rec = value as Record<string, unknown>;
  return typeof rec.id === 'string' && typeof rec.name === 'string' && isValidCodecState(rec);
}

/** Validates a value parsed from localStorage. Returns null on anything unexpected
 *  (missing/older version, malformed or duplicate tabs, too many tabs, dangling
 *  activeTabId, legacy gem-name data). */
export function sanitizeTabsState(parsed: unknown): TabsState | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const rec = parsed as Record<string, unknown>;
  if (rec.version !== TABS_STATE_VERSION) return null;
  if (!Array.isArray(rec.tabs) || rec.tabs.length === 0 || rec.tabs.length > MAX_TABS) return null;
  if (!(rec.tabs as unknown[]).every(isValidTab)) return null;
  const tabs = rec.tabs as SetupTab[];
  if (new Set(tabs.map((t) => t.id)).size !== tabs.length) return null;
  if (typeof rec.activeTabId !== 'string' || !tabs.some((t) => t.id === rec.activeTabId)) return null;
  return { version: TABS_STATE_VERSION, tabs, activeTabId: rec.activeTabId };
}

/** Wraps the pre-tabs flat `{ gemSetup, gemPower, stacks }` blob into a single tab. */
export function migrateLegacyState(parsed: unknown): TabsState | null {
  if (!isValidCodecState(parsed)) return null;
  const tab = makeTab(defaultTabName([]), parsed as CodecState);
  return { version: TABS_STATE_VERSION, tabs: [tab], activeTabId: tab.id };
}
