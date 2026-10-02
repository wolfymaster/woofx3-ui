/**
 * An engine asks for the linked Twitch account's token with this callback
 * type. Must match `EngineRequestType.TWITCH_TOKEN_REQUESTED` in the engine's
 * `@woofx3/api/webhooks`; kept here so the handler does not depend on the
 * engine types this repo builds against being new enough to declare it.
 */
export const TWITCH_TOKEN_REQUESTED_EVENT_TYPE = "twitch.token.requested";

/**
 * A Twitch access token as an engine receives it: no refresh token, which
 * stays here with the app's client secret, and the app's client id, because
 * Helix rejects a token presented with any other app's id. Must match
 * `TwitchTokenGrant` in `@woofx3/api/webhooks`.
 */
export interface TwitchTokenGrant {
  userId: string;
  accessToken: string;
  scope: string[];
  expiresIn: number;
  obtainmentTimestamp: number;
  clientId: string;
}

/** The answer to `twitch.token.requested`; must match `TwitchTokenRequestedResponse` in `@woofx3/api/webhooks`. */
export type TwitchTokenRequestedResponse =
  | { token: TwitchTokenGrant }
  | { token: null; reason: "not_linked" | "relink_required" };

export function twitchTokenGrant(input: {
  accessToken: string;
  broadcasterUserId: string;
  expiresAt: number;
  scopes: string[];
  clientId: string;
  now: number;
}): TwitchTokenGrant {
  return {
    userId: input.broadcasterUserId,
    accessToken: input.accessToken,
    scope: input.scopes,
    expiresIn: Math.max(0, Math.floor((input.expiresAt - input.now) / 1000)),
    obtainmentTimestamp: input.now,
    clientId: input.clientId,
  };
}

/**
 * The token `syncToEngine` hands an engine with `setTwitchToken`. `clientId`
 * tells the engine the token is this dashboard's, to ask here for the next
 * one. The refresh token goes only to an engine that cannot ask yet
 * (`asksForTokens` false), which still refreshes with it.
 */
export function twitchTokenForEngine(input: {
  link: { platformUserId: string; accessToken: string; refreshToken: string; expiresAt: number; scopes: string[] };
  asksForTokens: boolean;
  clientId: string;
  now: number;
}) {
  const { link } = input;
  return {
    userId: link.platformUserId,
    accessToken: link.accessToken,
    ...(input.asksForTokens ? {} : { refreshToken: link.refreshToken }),
    expiresIn: Math.max(0, Math.floor((link.expiresAt - input.now) / 1000)),
    obtainmentTimestamp: input.now,
    scope: link.scopes,
    clientId: input.clientId,
  };
}
