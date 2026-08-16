/**
 * Thrown by requestToDomain / runOptimization when an optimize request is
 * invalid (an unknown gem id, a rank that doesn't exist for that gem's
 * star rating, or a gem setup with no valid main gems).
 */
export class ValidationError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(detail);
    this.name = 'ValidationError';
    this.detail = detail;
  }
}
