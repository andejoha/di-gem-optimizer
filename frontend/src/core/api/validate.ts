/**
 * Replaces FastAPI's `HTTPException(422)` -- the request/domain validation
 * errors thrown by converters.ts and runOptimization.ts. `status` and
 * `detail` are kept for parity with the Python error payload shape
 * (`{"status": 422, "detail": "..."}`, as captured in the golden corpus's
 * `*.error.json` files); message text is preserved verbatim so any UI
 * copy surfacing `detail` is unchanged.
 */
export class ValidationError extends Error {
  readonly status = 422;
  readonly detail: string;

  constructor(detail: string) {
    super(detail);
    this.name = 'ValidationError';
    this.detail = detail;
  }
}
