/**
 * An engine asks for a shoutout to be queued with this callback type. Must
 * match `EngineRequestType.SHOUTOUT_ENQUEUE_REQUESTED` in the engine's
 * `@woofx3/api/webhooks`; kept here so the handler does not depend on the
 * engine types this repo builds against being new enough to declare it.
 *
 * Every shoutout a workflow or chat command asks the engine for arrives this
 * way, so it joins the same queue as the shoutout widget's. Twitch allows one
 * shoutout per channel every 2 minutes; an engine sending on its own would
 * spend the cooldown this queue is pacing itself to.
 */
export const SHOUTOUT_ENQUEUE_REQUESTED_EVENT_TYPE = "shoutout.enqueue.requested";

/** Who to shout out, as the engine looked them up. */
export interface EngineShoutoutTarget {
  twitchUserId: string;
  login: string;
  displayName: string;
  profileImageUrl?: string;
  broadcasterType?: string;
}

/**
 * The answer to `shoutout.enqueue.requested`; must match
 * `ShoutoutEnqueueRequestedResponse` in `@woofx3/api/webhooks`. `position` is
 * 1-based.
 */
export type ShoutoutEnqueueRequestedResponse =
  | { queued: true; position: number; alreadyQueued: boolean }
  | { queued: false; reason: "not_linked" };

/** The request's target, or null when it is missing who to shout out. */
export function parseEngineShoutoutTarget(data: unknown): EngineShoutoutTarget | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const { twitchUserId, login, displayName, profileImageUrl, broadcasterType } = data as Record<string, unknown>;
  if (typeof twitchUserId !== "string" || !twitchUserId || typeof login !== "string") {
    return null;
  }
  const normalizedLogin = login.trim().replace(/^@/, "").toLowerCase();
  if (!normalizedLogin) {
    return null;
  }
  return {
    twitchUserId,
    login: normalizedLogin,
    displayName: typeof displayName === "string" && displayName ? displayName : normalizedLogin,
    profileImageUrl: typeof profileImageUrl === "string" && profileImageUrl ? profileImageUrl : undefined,
    broadcasterType: typeof broadcasterType === "string" ? broadcasterType : undefined,
  };
}

/**
 * The 1-based place of `twitchUserId` in `entries` (queue order), or null when
 * they are not waiting. A raid and a `!so` for the same raider would
 * otherwise queue them twice, and Twitch refuses a second shoutout of the
 * same channel within an hour anyway.
 */
export function queuedPosition(entries: { twitchUserId: string }[], twitchUserId: string): number | null {
  const index = entries.findIndex((entry) => entry.twitchUserId === twitchUserId);
  return index === -1 ? null : index + 1;
}
