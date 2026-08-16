/**
 * Web Worker running the optimizer off the main thread so the ~700ms
 * worst-case (upgrades + convert_1star, ~430-gem inventory) can't freeze
 * the UI.
 *
 * Message shape is deliberately isomorphic to the backend's old SSE event
 * shape, so components/progress/OptimizationProgress.tsx and its
 * STAGE_LABELS map need no changes:
 *   in:  { id, request, enableUpgrades, convert1Star }
 *   out: { id, type: 'progress', stage, status, iteration, detail }
 *      | { id, type: 'result', data: OptimizeResponse }
 *      | { id, type: 'error', detail: string }
 *
 * Plain postMessage, not Comlink: there is exactly one RPC method plus a
 * progress stream, which doesn't justify the extra dependency and proxy
 * layer.
 */

import { runOptimization } from '../core/api/runOptimization';
import type { OptimizeRequest, OptimizeResponse } from '../core/api/types';
import { ValidationError } from '../core/api/validate';
import { makeCallbackReporter } from '../core/progress';

export interface WorkerRequest {
  id: number;
  request: OptimizeRequest;
  enableUpgrades: boolean;
  convert1Star: boolean;
}

export type WorkerResponse =
  | { id: number; type: 'progress'; stage: string; status: string; iteration: number | null; detail: string | null }
  | { id: number; type: 'result'; data: OptimizeResponse }
  | { id: number; type: 'error'; detail: string };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, request, enableUpgrades, convert1Star } = event.data;
  const reporter = makeCallbackReporter((progressEvent) => {
    const message: WorkerResponse = { id, type: 'progress', ...progressEvent };
    self.postMessage(message);
  });

  try {
    const data = runOptimization(request, enableUpgrades, convert1Star, reporter);
    const message: WorkerResponse = { id, type: 'result', data };
    self.postMessage(message);
  } catch (err) {
    const detail = err instanceof ValidationError ? err.detail : err instanceof Error ? err.message : String(err);
    const message: WorkerResponse = { id, type: 'error', detail };
    self.postMessage(message);
  }
};
