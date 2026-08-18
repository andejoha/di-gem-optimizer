import { useEffect, useState } from 'react';
import type { GemSetup } from '../types/api';
import type { InventoryGemStack } from '../types/inventory';
import type { CodecState } from '../utils/setupCodec';
import type { SetupTab, TabsState } from '../utils/setupTabs';
import {
  MAX_TABS,
  addTab,
  deleteTab,
  emptyTabsState,
  migrateLegacyState,
  renameTab,
  sanitizeTabsState,
  updateTab,
} from '../utils/setupTabs';

const TABS_STORAGE_KEY = 'gem-optimizer:tabs';
const LEGACY_STORAGE_KEY = 'gem-optimizer:state';

function loadInitialState(): TabsState {
  try {
    const raw = localStorage.getItem(TABS_STORAGE_KEY);
    if (raw) {
      const sanitized = sanitizeTabsState(JSON.parse(raw));
      if (sanitized) return sanitized;
    }
  } catch {
    // fall through to legacy migration / defaults
  }

  try {
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      const migrated = migrateLegacyState(JSON.parse(legacyRaw));
      if (migrated) return migrated;
    }
  } catch {
    // fall through to defaults
  }

  return emptyTabsState();
}

export interface UseSetupTabsResult {
  tabs: SetupTab[];
  activeTab: SetupTab;
  activeTabId: string;
  canAddTab: boolean;
  selectTab: (id: string) => void;
  addTab: (seed?: CodecState) => void;
  renameTab: (id: string, name: string) => void;
  deleteTab: (id: string) => void;
  setGemSetup: (gemSetup: GemSetup) => void;
  setGemPower: (gemPower: number) => void;
  setStacks: (stacks: InventoryGemStack[]) => void;
  replaceActiveSetup: (setup: CodecState) => void;
}

export function useSetupTabs(): UseSetupTabsResult {
  const [state, setState] = useState<TabsState>(loadInitialState);

  useEffect(() => {
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const activeTab = state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0];

  return {
    tabs: state.tabs,
    activeTab,
    activeTabId: state.activeTabId,
    canAddTab: state.tabs.length < MAX_TABS,
    selectTab: (id) => setState((s) => (s.tabs.some((t) => t.id === id) ? { ...s, activeTabId: id } : s)),
    addTab: (seed) => setState((s) => addTab(s, seed)),
    renameTab: (id, name) => setState((s) => renameTab(s, id, name)),
    deleteTab: (id) => setState((s) => deleteTab(s, id)),
    setGemSetup: (gemSetup) => setState((s) => updateTab(s, s.activeTabId, { gemSetup })),
    setGemPower: (gemPower) => setState((s) => updateTab(s, s.activeTabId, { gemPower })),
    setStacks: (stacks) => setState((s) => updateTab(s, s.activeTabId, { stacks })),
    replaceActiveSetup: (setup) => setState((s) => updateTab(s, s.activeTabId, setup)),
  };
}
