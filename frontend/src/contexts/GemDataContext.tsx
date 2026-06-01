import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getGemData } from '../services/gemApi';
import type { GemInfo } from '../types/api';

interface GemDataState {
  gems: GemInfo[];
  gemById: Map<number, GemInfo>;
  loading: boolean;
  error: string | null;
}

const GemDataContext = createContext<GemDataState | null>(null);

export function GemDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GemDataState>({
    gems: [],
    gemById: new Map(),
    loading: true,
    error: null,
  });

  useEffect(() => {
    getGemData()
      .then((gems) => setState({
        gems,
        gemById: new Map(gems.map((g) => [g.id, g])),
        loading: false,
        error: null,
      }))
      .catch((err: Error) =>
        setState({ gems: [], gemById: new Map(), loading: false, error: err.message ?? 'Failed to load gem data' }),
      );
  }, []);

  return <GemDataContext.Provider value={state}>{children}</GemDataContext.Provider>;
}

export function useGemData(): GemDataState {
  const ctx = useContext(GemDataContext);
  if (ctx === null) {
    throw new Error('useGemData must be used within a GemDataProvider');
  }
  return ctx;
}
