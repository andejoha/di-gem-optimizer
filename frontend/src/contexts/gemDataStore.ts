import { createContext } from 'react';
import type { GemInfo } from '../types/api';

export interface GemDataState {
  gems: GemInfo[];
  gemById: Map<number, GemInfo>;
}

export const GemDataContext = createContext<GemDataState | null>(null);
