import { CHATTERS_SCOPE, SHOUTOUT_SCOPE } from "@shared/twitch-chat";
import type { TwitchLink } from "@/engine/types";

/**
 * What stops the Shoutout panel working on a linked account, read from the link
 * itself so it is the same in every deployment: production hides the text of
 * the server's own refusal.
 */
export function shoutoutLinkProblem(link: Pick<TwitchLink, "scopes" | "authFailedAt">): string | null {
  if (link.authFailedAt !== undefined) {
    return "Your Twitch connection stopped working. Reconnect Twitch in Settings to send shoutouts.";
  }
  if (!link.scopes.includes(SHOUTOUT_SCOPE)) {
    return "Reconnect Twitch in Settings to send shoutouts.";
  }
  if (!link.scopes.includes(CHATTERS_SCOPE)) {
    return "Reconnect Twitch in Settings to see who's in chat. You can still type a name.";
  }
  return null;
}
