/**
 * Progress reporting for the optimization pipeline. `makeCallbackReporter`
 * posts every progress event unconditionally to the given callback, which
 * the Web Worker uses to relay progress to the main thread.
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
