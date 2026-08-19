import { describe, expect, it } from 'vitest';
import type { CodecState } from '../../src/utils/setupCodec';
import {
  MAX_TABS,
  MAX_TAB_NAME_LENGTH,
  addTab,
  defaultTabName,
  deleteTab,
  emptyTabsState,
  makeTab,
  migrateLegacyState,
  renameTab,
  sanitizeTabsState,
  updateTab,
} from '../../src/utils/setupTabs';
import type { SetupTab, TabsState } from '../../src/utils/setupTabs';

const seed: CodecState = {
  gemSetup: { head: { gem_id: 1, target_rank: '5', active_stars: 5 } },
  gemPower: 1000,
  stacks: [{ id: 'a', gem_id: 1, star_rating: 5, rank: '5', active_stars: 5, quantity: 2 }],
};

function tabsWithNames(...names: string[]): SetupTab[] {
  return names.map((name) => makeTab(name));
}

describe('defaultTabName', () => {
  it('starts at Setup 1 when there are no tabs', () => {
    expect(defaultTabName([])).toBe('Setup 1');
  });

  it('reuses the lowest free "Setup N" name', () => {
    const tabs = tabsWithNames('Setup 1', 'Setup 3');
    expect(defaultTabName(tabs)).toBe('Setup 2');
  });

  it('ignores custom names when picking the next number', () => {
    const tabs = tabsWithNames('Setup 1', 'Raid Build');
    expect(defaultTabName(tabs)).toBe('Setup 2');
  });
});

describe('addTab', () => {
  it('appends a new tab and selects it', () => {
    const state = emptyTabsState();
    const next = addTab(state);
    expect(next.tabs).toHaveLength(2);
    expect(next.activeTabId).toBe(next.tabs[1].id);
  });

  it('seeds the new tab with the given setup', () => {
    const state = emptyTabsState();
    const next = addTab(state, seed);
    const newTab = next.tabs[1];
    expect(newTab.gemPower).toBe(1000);
    expect(newTab.stacks).toEqual(seed.stacks);
  });

  it('is a no-op once MAX_TABS is reached', () => {
    let state = emptyTabsState();
    for (let i = 1; i < MAX_TABS; i++) state = addTab(state);
    expect(state.tabs).toHaveLength(MAX_TABS);
    const unchanged = addTab(state);
    expect(unchanged).toBe(state);
  });
});

describe('renameTab', () => {
  it('trims and truncates to MAX_TAB_NAME_LENGTH', () => {
    const state = emptyTabsState();
    const id = state.tabs[0].id;
    const longName = '  ' + 'x'.repeat(30) + '  ';
    const next = renameTab(state, id, longName);
    expect(next.tabs[0].name).toBe('x'.repeat(MAX_TAB_NAME_LENGTH));
  });

  it('rejects a whitespace-only name', () => {
    const state = emptyTabsState();
    const id = state.tabs[0].id;
    const next = renameTab(state, id, '   ');
    expect(next.tabs[0].name).toBe(state.tabs[0].name);
  });
});

describe('deleteTab', () => {
  it('clears the only tab and resets its name, keeping its id', () => {
    let state = emptyTabsState();
    state = updateTab(state, state.tabs[0].id, seed);
    const id = state.tabs[0].id;
    const next = deleteTab(state, id);
    expect(next.tabs).toHaveLength(1);
    expect(next.tabs[0].id).toBe(id);
    expect(next.tabs[0].name).toBe('Setup 1');
    expect(next.tabs[0].gemPower).toBe(0);
    expect(next.tabs[0].stacks).toEqual([]);
    expect(next.activeTabId).toBe(id);
  });

  it('removes a middle tab and moves selection to the previous tab when it was active', () => {
    let state = emptyTabsState();
    state = addTab(state);
    state = addTab(state);
    const [first, second, third] = state.tabs;
    state = { ...state, activeTabId: second.id };
    const next = deleteTab(state, second.id);
    expect(next.tabs.map((t) => t.id)).toEqual([first.id, third.id]);
    expect(next.activeTabId).toBe(first.id);
  });

  it('leaves selection alone when deleting a non-active tab', () => {
    let state = emptyTabsState();
    state = addTab(state);
    const [first, second] = state.tabs;
    state = { ...state, activeTabId: second.id };
    const next = deleteTab(state, first.id);
    expect(next.tabs.map((t) => t.id)).toEqual([second.id]);
    expect(next.activeTabId).toBe(second.id);
  });
});

describe('updateTab', () => {
  it('only touches the target tab', () => {
    let state = emptyTabsState();
    state = addTab(state);
    const [first, second] = state.tabs;
    const next = updateTab(state, first.id, { gemPower: 42 });
    expect(next.tabs.find((t) => t.id === first.id)?.gemPower).toBe(42);
    expect(next.tabs.find((t) => t.id === second.id)?.gemPower).toBe(0);
  });
});

describe('sanitizeTabsState', () => {
  it('accepts a well-formed state round-tripped through JSON', () => {
    let state = emptyTabsState();
    state = updateTab(state, state.tabs[0].id, seed);
    const roundTripped = JSON.parse(JSON.stringify(state));
    expect(sanitizeTabsState(roundTripped)).toEqual(state);
  });

  it('rejects a missing or wrong version', () => {
    const state = emptyTabsState();
    expect(sanitizeTabsState({ ...state, version: 1 })).toBeNull();
    expect(sanitizeTabsState({ tabs: state.tabs, activeTabId: state.activeTabId })).toBeNull();
  });

  it('rejects an empty tabs array', () => {
    expect(sanitizeTabsState({ version: 2, tabs: [], activeTabId: 'x' })).toBeNull();
  });

  it('rejects more tabs than MAX_TABS', () => {
    let state = emptyTabsState();
    for (let i = 1; i < MAX_TABS; i++) state = addTab(state);
    const tooMany: TabsState = { ...state, tabs: [...state.tabs, makeTab('Setup 6')] };
    expect(sanitizeTabsState(tooMany)).toBeNull();
  });

  it('rejects tabs sharing the same id', () => {
    const state = emptyTabsState();
    const duplicated: TabsState = { ...state, tabs: [state.tabs[0], { ...state.tabs[0], name: 'Copy' }] };
    expect(sanitizeTabsState(duplicated)).toBeNull();
  });

  it('rejects an activeTabId not present among the tabs', () => {
    const state = emptyTabsState();
    expect(sanitizeTabsState({ ...state, activeTabId: 'missing' })).toBeNull();
  });

  it('rejects legacy gem_name stack data', () => {
    const state: TabsState = {
      version: 2,
      tabs: [
        {
          id: 'a',
          name: 'Setup 1',
          gemSetup: {},
          gemPower: 0,
          stacks: [{ gem_name: 'Blessing of the Worthy' } as unknown as SetupTab['stacks'][number]],
        },
      ],
      activeTabId: 'a',
    };
    expect(sanitizeTabsState(state)).toBeNull();
  });

  it('rejects non-JSON-shaped input', () => {
    expect(sanitizeTabsState(null)).toBeNull();
    expect(sanitizeTabsState('not an object')).toBeNull();
    expect(sanitizeTabsState(42)).toBeNull();
  });
});

describe('migrateLegacyState', () => {
  it('wraps a legacy flat blob into a single Setup 1 tab', () => {
    const migrated = migrateLegacyState(seed);
    expect(migrated).not.toBeNull();
    expect(migrated!.tabs).toHaveLength(1);
    expect(migrated!.tabs[0].name).toBe('Setup 1');
    expect(migrated!.tabs[0].gemPower).toBe(1000);
    expect(migrated!.activeTabId).toBe(migrated!.tabs[0].id);
  });

  it('returns null for junk input', () => {
    expect(migrateLegacyState(null)).toBeNull();
    expect(migrateLegacyState({ foo: 'bar' })).toBeNull();
    expect(migrateLegacyState({ gemSetup: {}, gemPower: 'not a number', stacks: [] })).toBeNull();
  });
});
