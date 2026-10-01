/**
 * Error codes an OAuth round trip can end with, and the fixed text shown for
 * each. Only a code travels in a URL: the pages that show the error read it
 * from a query string anyone can craft, so they never render the value itself.
 *
 * Shared by Convex (which picks the code) and the client (which shows the
 * text), so it stays free of Convex imports.
 */

export const OAUTH_ERROR_CODES = [
  "missing_params",
  "invalid_state",
  "access_denied",
  "not_started_by_user",
  "not_permitted",
  "token_exchange_failed",
  "profile_fetch_failed",
  "sign_in_not_started_here",
  "sign_in_failed",
  "not_signed_in",
  "connect_code_invalid",
  "connect_code_expired",
  "wrong_user",
  "relink_mismatch",
  "engine_write_failed",
] as const;

export type OAuthErrorCode = (typeof OAUTH_ERROR_CODES)[number];

/** The provider's name as the person connecting knows it, e.g. "Twitch". */
export type OAuthProviderLabel = string;

export function isOAuthErrorCode(value: unknown): value is OAuthErrorCode {
  return typeof value === "string" && (OAUTH_ERROR_CODES as readonly string[]).includes(value);
}

function messageFor(code: OAuthErrorCode, provider: OAuthProviderLabel): string {
  switch (code) {
    case "missing_params": {
      return `${provider} did not return the expected response. Please try again.`;
    }
    case "invalid_state": {
      return `This ${provider} request expired or was already used. Please start again.`;
    }
    case "access_denied": {
      return `${provider} access was not granted.`;
    }
    case "not_started_by_user": {
      return `This ${provider} connection was not started from a signed-in session. Please start again.`;
    }
    case "not_permitted": {
      return `You do not have permission to connect ${provider} for this instance.`;
    }
    case "token_exchange_failed": {
      return `${provider} did not accept the authorization. Please try again.`;
    }
    case "profile_fetch_failed": {
      return `Could not read your ${provider} profile. Please try again.`;
    }
    case "sign_in_not_started_here": {
      return "This sign-in was not started in this browser tab. Start it again from the login page.";
    }
    case "sign_in_failed": {
      return "Sign-in did not complete. Please try again.";
    }
    case "not_signed_in": {
      return `Sign in to woofx3 in this browser before finishing the ${provider} connection.`;
    }
    case "connect_code_invalid": {
      return `This ${provider} connection link is invalid or was already used. Please start again.`;
    }
    case "connect_code_expired": {
      return `This ${provider} connection link expired. Please start again.`;
    }
    case "wrong_user": {
      return `This ${provider} connection was started by a different woofx3 user. Nothing was linked.`;
    }
    case "relink_mismatch": {
      return `This instance is linked to a different ${provider} account. Sign in to ${provider} as that account to reconnect, or disconnect it first.`;
    }
    case "engine_write_failed": {
      return `${provider} was authorized, but saving the connection failed. Please try again.`;
    }
  }
}

/** The fixed text for a code; anything that is not a known code gets a generic message. */
export function oauthErrorMessage(code: string | null | undefined, provider: OAuthProviderLabel): string {
  if (!isOAuthErrorCode(code)) {
    return `Something went wrong with ${provider}. Please try again.`;
  }
  return messageFor(code, provider);
}
