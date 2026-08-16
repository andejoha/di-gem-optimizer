import type { OptimizeRequest, OptimizeResponse } from '../types/api';
import type { ProgressEvent } from '../types/progress';
import type { WorkerRequest, WorkerResponse } from '../workers/optimizer.worker';

let worker: Worker | null = null;
let nextRequestId = 0;

function getWorker(): Worker {
  if (worker === null) {
    worker = new Worker(new URL('../workers/optimizer.worker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

/** Terminates and drops the worker so a future call starts fresh -- guards against a corrupted worker state poisoning subsequent runs after an error. */
function resetWorker(): void {
  worker?.terminate();
  worker = null;
}

/**
 * Runs the optimizer in a Web Worker, invoking onProgress for each stage
 * transition and resolving with the final result. This is the primary path
 * used by HomePage; optimize() below is a synchronous main-thread fallback.
 */
export async function optimizeWithProgress(
  request: OptimizeRequest,
  enableUpgrades: boolean,
  convert1Star: boolean,
  onProgress: (event: ProgressEvent) => void,
): Promise<OptimizeResponse> {
  const id = nextRequestId++;
  const activeWorker = getWorker();

  return new Promise<OptimizeResponse>((resolve, reject) => {
    const handleMessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.id !== id) return; // stale reply from a superseded request
      const message = event.data;
      if (message.type === 'progress') {
        onProgress({ stage: message.stage, status: message.status, iteration: message.iteration, detail: message.detail });
        return;
      }
      activeWorker.removeEventListener('message', handleMessage);
      activeWorker.removeEventListener('error', handleError);
      if (message.type === 'result') {
        resolve(message.data);
      } else {
        resetWorker();
        reject(new Error(message.detail));
      }
    };
    const handleError = (event: ErrorEvent) => {
      activeWorker.removeEventListener('message', handleMessage);
      activeWorker.removeEventListener('error', handleError);
      resetWorker();
      reject(new Error(event.message || 'Worker error during optimization'));
    };

    activeWorker.addEventListener('message', handleMessage);
    activeWorker.addEventListener('error', handleError);

    const payload: WorkerRequest = { id, request, enableUpgrades, convert1Star };
    activeWorker.postMessage(payload);
  });
}

/**
 * Synchronous main-thread fallback for environments where the Web Worker
 * fails to start. Dynamically imported so its dependency graph (the entire
 * optimizer/pipeline/upgrades/converters core) doesn't land in the main
 * bundle chunk -- that code is only needed inside the worker, or here, on
 * this rarely-taken path.
 */
export async function optimize(
  request: OptimizeRequest,
  enableUpgrades: boolean = false,
  convert1Star: boolean = false,
): Promise<OptimizeResponse> {
  const { runOptimization } = await import('../core/api/runOptimization');
  return runOptimization(request, enableUpgrades, convert1Star);
}
