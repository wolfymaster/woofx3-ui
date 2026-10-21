/**
 * How the engine's `ApiGateway.authenticate` words a refusal of client
 * credentials it does not know (woofx3 `api/src/gateway.ts`). An engine that
 * names the refusal starts its message with the prefix; an older one rejects
 * with the plain message alone.
 */
const AUTHENTICATION_REFUSED_PREFIX = "AuthenticationRefused: ";
const LEGACY_AUTHENTICATION_REFUSAL = "Invalid client credentials";

/**
 * Whether `error` is the engine refusing the session's client credentials,
 * as opposed to a transport failure. A refusal is final until the
 * credentials change, so the session stops retrying. A wording this does not
 * recognise is read as a transport failure and retried, which is safe.
 *
 * TODO: drop the legacy message once every engine the desktop app can run
 * sends the prefix; engines released before it still send the plain message.
 */
export function isAuthenticationRefused(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.startsWith(AUTHENTICATION_REFUSED_PREFIX) || error.message === LEGACY_AUTHENTICATION_REFUSAL;
}
