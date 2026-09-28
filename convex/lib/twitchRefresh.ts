/**
 * Decisions about a Twitch refresh-token exchange, kept free of Convex imports
 * so they can be tested directly.
 */

/**
 * Whether Twitch's refusal of a refresh means the grant itself is gone (the
 * creator revoked the app or changed their password), which only a relink
 * fixes. Twitch answers that case with 400 and the message "Invalid refresh
 * token". Every other failure, including a 400 for a misconfigured client
 * secret, is ours or transient and must not tell the creator to reconnect.
 */
export function isRevokedRefreshResponse(status: number, body: string): boolean {
  if (status !== 400) {
    return false;
  }
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    return typeof parsed.message === "string" && parsed.message.toLowerCase() === "invalid refresh token";
  } catch {
    return false;
  }
}

/**
 * Whether a refresh outcome may still be written to the link. The exchange
 * runs outside any transaction; a relink that lands meanwhile replaces the
 * refresh token, and the outcome of the old one (new tokens, or a refusal)
 * must not overwrite the newer grant.
 */
export function refreshOutcomeApplies(row: { refreshToken: string } | null, usedRefreshToken: string): boolean {
  return row !== null && row.refreshToken === usedRefreshToken;
}
