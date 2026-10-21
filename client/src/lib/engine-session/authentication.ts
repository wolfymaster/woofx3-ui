/**
 * The message the engine's `ApiGateway.authenticate` rejects with for client
 * credentials it does not know. Must match woofx3 `api/src/gateway.ts`.
 */
const ENGINE_AUTHENTICATION_REFUSAL = "Invalid client credentials";

/**
 * Whether `error` is the engine refusing the session's client credentials,
 * as opposed to a transport failure. A refusal is final until the
 * credentials change, so the session stops retrying.
 *
 * TODO: replace the message match with the `@woofx3/api` type guard for the
 * named authentication refusal (`AUTHENTICATION_REFUSED` in `rpc.ts`, the
 * counterpart of `REGISTRATION_REFUSED`). The engine does not name the error
 * yet: today it rejects with a plain `Error`, so its message is the only
 * signal, and the guard does not exist to import.
 */
export function isAuthenticationRefused(error: unknown): boolean {
  return error instanceof Error && error.message === ENGINE_AUTHENTICATION_REFUSAL;
}
