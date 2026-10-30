import type { TwitchLinkInfo } from "@woofx3/api";
import type { TwitchDeviceLogin, TwitchDeviceLoginState } from "@woofx3/api/twitch-device-login";
import type { TwitchLink, TwitchLinking } from "@/engine/types";

export const IDLE_LINKING: TwitchLinking = { status: "idle" };

/**
 * The engine's link as the gateway's. A local engine has one streamer, who
 * may always relink; the login stands in for a name Helix could not supply.
 */
export function toTwitchLink(info: TwitchLinkInfo): TwitchLink | null {
  if (!info.linked) {
    return null;
  }
  return {
    platformUserId: info.userId,
    platformUsername: info.login ?? info.displayName ?? info.userId,
    profileImageUrl: info.profileImageUrl ?? undefined,
    scopes: info.scopes,
    authFailedAt: info.authFailedAt ?? undefined,
    viewerCanRelink: true,
  };
}

/** What happens to a device login attempt. */
export type DeviceLinkingEvent =
  | { type: "start" }
  | { type: "codeIssued"; login: TwitchDeviceLogin }
  | { type: "ended"; state: TwitchDeviceLoginState }
  | { type: "refused"; error: string }
  | { type: "cancel" };

/** Why a login that ended without linking ended, in the streamer's words. */
function endedMessage(state: TwitchDeviceLoginState): string {
  switch (state.status) {
    case "expired":
      return "The code expired before it was approved. Start again for a new one.";
    case "denied":
      return "Twitch access was not approved.";
    default:
      return state.reason ? `Twitch refused the link: ${state.reason}` : "Twitch refused the link.";
  }
}

/**
 * The next state of a device login attempt. A start while one is under way
 * changes nothing; a login that linked returns to idle, since the link
 * itself shows up through `useLink`.
 */
export function nextDeviceLinking(current: TwitchLinking, event: DeviceLinkingEvent): TwitchLinking {
  switch (event.type) {
    case "start":
      return current.status === "starting" || current.status === "awaitingApproval" ? current : { status: "starting" };
    case "codeIssued":
      return {
        status: "awaitingApproval",
        userCode: event.login.userCode,
        verificationUri: event.login.verificationUri,
        expiresAt: Date.parse(event.login.expiresAt),
      };
    case "ended":
      if (event.state.status === "linked") {
        return IDLE_LINKING;
      }
      if (event.state.status === "pending") {
        return current;
      }
      return { status: "failed", error: endedMessage(event.state) };
    case "refused":
      return { status: "failed", error: event.error };
    case "cancel":
      return IDLE_LINKING;
  }
}
