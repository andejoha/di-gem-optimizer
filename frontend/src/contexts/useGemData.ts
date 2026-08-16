import { useContext } from 'react';
import { GemDataContext, type GemDataState } from './gemDataStore';

export function useGemData(): GemDataState {
  const ctx = useContext(GemDataContext);
  if (ctx === null) {
    throw new Error('useGemData must be used within a GemDataProvider');
  }
  return ctx;
}
