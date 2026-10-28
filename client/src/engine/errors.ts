// Errors a gateway call can reject with whichever backend serves it, so a
// screen tells "the engine is unreachable" from "the engine said no" without
// knowing how it is connected.

/** The call needed a live engine session and there was none, or it broke while the call was in flight. */
export class EngineDisconnectedError extends Error {
  constructor(
    readonly operation: string,
    options?: ErrorOptions
  ) {
    super(`Not connected to the engine (${operation})`, options);
    this.name = "EngineDisconnectedError";
  }
}

/**
 * The engine did not answer within the deadline. The call is abandoned, not
 * cancelled: a write that timed out may still have happened.
 */
export class EngineTimeoutError extends Error {
  constructor(
    readonly operation: string,
    readonly timeoutMs: number
  ) {
    super(`The engine did not answer ${operation} within ${timeoutMs}ms`);
    this.name = "EngineTimeoutError";
  }
}

/**
 * The gateway has no way to serve this member: what it reads or changes is
 * kept somewhere this gateway does not reach. A read throws it and a request
 * rejects with it, so a screen that uses the member is one to hide, not one
 * that shows an empty answer as if it were true.
 */
export class GatewayUnsupportedError extends Error {
  constructor(readonly member: string) {
    super(`This connection to the engine cannot serve ${member}`);
    this.name = "GatewayUnsupportedError";
  }
}
