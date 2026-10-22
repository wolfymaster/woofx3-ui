import { isAuthenticationRefused as isNamedAuthenticationRefusal } from "@woofx3/api/rpc";

// Engines released before the refusal marker reject with this plain message,
// and the desktop app can still run one.
const LEGACY_AUTHENTICATION_REFUSAL = "Invalid client credentials";

/**
 * Whether `error` is the engine refusing the session's client credentials,
 * as opposed to a transport failure. A refusal is final until the
 * credentials change, so the session stops retrying. A wording this does not
 * recognise is read as a transport failure and retried, which is safe.
 */
export function isAuthenticationRefused(error: unknown): boolean {
  if (isNamedAuthenticationRefusal(error)) {
    return true;
  }
  return error instanceof Error && error.message === LEGACY_AUTHENTICATION_REFUSAL;
}
