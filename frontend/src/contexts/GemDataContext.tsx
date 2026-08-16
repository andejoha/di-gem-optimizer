import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { GEM_INFO } from '../core/api/gemData';
import type { GemInfo } from '../types/api';

interface GemDataState {
  gems: GemInfo[];
  gemById: Map<number, GemInfo>;
}

const GemDataContext = createContext<GemDataState | null>(null);

export function GemDataProvider({ children }: { children: ReactNode }) {
  // GEM_INFO is bundled data, not fetched -- no loading/error state needed.
  const state = useMemo<GemDataState>(
    () => ({ gems: GEM_INFO, gemById: new Map(GEM_INFO.map((g) => [g.id, g])) }),
    [],
  );

  return <GemDataContext.Provider value={state}>{children}</GemDataContext.Provider>;
}

export function useGemData(): GemDataState {
  const ctx = useContext(GemDataContext);
  if (ctx === null) {
    throw new Error('useGemData must be used within a GemDataProvider');
  }
  return ctx;
}
