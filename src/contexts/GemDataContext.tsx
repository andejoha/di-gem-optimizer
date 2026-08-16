import { useMemo, type ReactNode } from 'react';
import { GEM_INFO } from '../core/api/gemData';
import { GemDataContext, type GemDataState } from './gemDataStore';

export function GemDataProvider({ children }: { children: ReactNode }) {
  // GEM_INFO is bundled data, not fetched -- no loading/error state needed.
  const state = useMemo<GemDataState>(() => ({ gems: GEM_INFO, gemById: new Map(GEM_INFO.map((g) => [g.id, g])) }), []);

  return <GemDataContext.Provider value={state}>{children}</GemDataContext.Provider>;
}
