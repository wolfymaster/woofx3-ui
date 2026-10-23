/**
 * The engine did not answer a request that has to reach it. The request left
 * the account's state as it was, so retrying (or, for an unlink, forcing it)
 * is safe.
 */
export class EngineUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineUnreachableError";
  }
}
