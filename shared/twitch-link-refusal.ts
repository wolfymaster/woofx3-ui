// The sentences a Twitch call is refused with before it reaches Twitch, by
// what the instance's link holds. The scope check is what turns "Twitch
// silently 401s" into an actionable "reconnect Twitch": a link made before a
// scope was asked for keeps working for everything else, so the gap is
// invisible until it isn't.

export const TWITCH_NOT_CONNECTED_MESSAGE = "Twitch is not connected for this instance";

export function missingTwitchScopeMessage(scope: string): string {
  return `Your Twitch connection is missing the "${scope}" permission. Reconnect Twitch in Settings → Integrations to grant it.`;
}

/**
 * Why a call needing `requiredScope` (null: no scope) cannot run on `link`,
 * or null when it can. A missing link is reported as the missing scope when
 * a scope is needed, so the streamer is sent to the one place that fixes both.
 */
export function twitchLinkRefusal(
  link: { scopes: readonly string[] } | null,
  requiredScope: string | null
): string | null {
  if (requiredScope !== null && !(link?.scopes ?? []).includes(requiredScope)) {
    return missingTwitchScopeMessage(requiredScope);
  }
  if (link === null) {
    return TWITCH_NOT_CONNECTED_MESSAGE;
  }
  return null;
}
