/**
 * Progress reporting for the optimization pipeline.
 *
 * Ported from backend/app/core/progress.py. The Python QueueReporter's
 * throttle (max 1 event/sec unless force=True) is NOT ported: every call
 * site in pipeline.ts/runOptimization.ts always passes force=true, so the
 * throttle never actually fired in the original -- see the Phase 2 design
 * review notes. CallbackReporter here posts every event unconditionally,
 * which is the worker's job to relay via postMessage in Phase 4.
 */

export interface ProgressEvent {
  stage: string;
  status: string;
  iteration: number | null;
  detail: string | null;
}

export interface ProgressReporter {
  report(
    stage: string,
    status: string,
    opts?: { iteration?: number | null; detail?: string | null },
  ): void;
}

/** No-op reporter used by all non-streaming call paths. */
export const nullReporter: ProgressReporter = {
  report() {
    // no-op
  },
};

/** Invokes a callback for every progress event -- used by the Web Worker to relay progress via postMessage. */
export function makeCallbackReporter(onEvent: (event: ProgressEvent) => void): ProgressReporter {
  return {
    report(stage, status, opts = {}) {
      onEvent({
        stage,
        status,
        iteration: opts.iteration ?? null,
        detail: opts.detail ?? null,
      });
    },
  };
}
