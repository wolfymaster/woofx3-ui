import { type InstanceRole, moderationAccess } from "@shared/moderation";
import type { StreamCategory as HelixStreamCategory, StreamInfo as HelixStreamInfo } from "@shared/stream-info";
import { readHelixResult, unconfirmedResponse } from "@shared/twitch-helix-answer";
import { TWITCH_NOT_CONNECTED_MESSAGE } from "@shared/twitch-link-refusal";
import type { TwitchPin } from "@shared/twitch-pins";
import type { TwitchUser } from "@shared/twitch-users";
import type { TwitchLinkInfo } from "@woofx3/api";
import type {
  CurrentPin,
  ModeratedUser,
  ModerationAccess,
  StreamCategory,
  StreamInfo,
  StreamInfoChanges,
  TwitchChannel,
} from "@/engine/types";

/** Why an engine never called Twitch, in words for the streamer. */
const REFUSALS = {
  not_linked: () => TWITCH_NOT_CONNECTED_MESSAGE,
  unavailable: () => "The engine's Twitch connection is not running. Check that Twitch is turned on in the engine.",
  invalid_arguments: (error: string) => `The engine refused the call to Twitch: ${error}`,
} as const;

/**
 * An engine Twitch method's result as the Helix answer the shared readers
 * take. A call the engine sent but could not confirm reads as the 5xx a
 * Twitch outage would, since there is no Helix to fall back on; a call it
 * never sent rejects with why.
 */
export function engineHelixAnswer(result: unknown): { response: Response; unconfirmed: string | null } {
  const answer = readHelixResult(result);
  switch (answer.kind) {
    case "answer":
      return { response: answer.response, unconfirmed: null };
    case "unconfirmed":
      return { response: unconfirmedResponse(answer.reason), unconfirmed: answer.error };
    case "refused":
      throw new Error(REFUSALS[answer.code](answer.error));
  }
}

/**
 * The only person at a desktop engine is the streamer who runs it, so they
 * hold the role an account's owner holds.
 */
const ENGINE_ROLE: InstanceRole = "owner";

/** What the streamer can moderate on the engine's link; module-level so a query's selection keeps its identity. */
export function toModerationAccess(link: TwitchLinkInfo): ModerationAccess {
  return moderationAccess(ENGINE_ROLE, link.linked ? link.scopes : null);
}

export function toModeratedUser(user: TwitchUser): ModeratedUser {
  return { login: user.login, displayName: user.displayName };
}

export function toTwitchChannel(user: TwitchUser): TwitchChannel {
  return {
    twitchUserId: user.twitchUserId,
    login: user.login,
    displayName: user.displayName,
    profileImageUrl: user.profileImageUrl ?? null,
    broadcasterType: user.broadcasterType ?? null,
  };
}

export function toStreamCategory(category: HelixStreamCategory): StreamCategory {
  return { id: category.id, name: category.name, boxArtUrl: category.boxArtUrl ?? null };
}

/** A category without art is one with no `boxArtUrl` at all in the shared rules. */
function fromStreamCategory(category: StreamCategory): HelixStreamCategory {
  const { id, name, boxArtUrl } = category;
  return boxArtUrl === null ? { id, name } : { id, name, boxArtUrl };
}

export function toStreamInfo(info: HelixStreamInfo): StreamInfo {
  return { title: info.title, category: info.category ? toStreamCategory(info.category) : null, tags: info.tags };
}

/** The fields a change sets, as the shared rules take them: a title trimmed, a cleared category kept as null. */
export function fromStreamInfoChanges(changes: StreamInfoChanges): Partial<HelixStreamInfo> {
  const result: Partial<HelixStreamInfo> = {};
  if (changes.title !== undefined) {
    result.title = changes.title.trim();
  }
  if (changes.category !== undefined) {
    result.category = changes.category === null ? null : fromStreamCategory(changes.category);
  }
  if (changes.tags !== undefined) {
    result.tags = changes.tags;
  }
  return result;
}

export function toCurrentPin(pin: TwitchPin): CurrentPin {
  return { messageId: pin.messageId, content: pin.text, authorName: pin.senderName, expiresAt: pin.endsAt };
}
