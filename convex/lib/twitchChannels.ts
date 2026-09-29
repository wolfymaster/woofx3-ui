import type { AuthorizedTwitchCall } from "./twitchAuth";

// Helix channel information and stream markers. Only the Helix calls live
// here; the caller has already decided who may ask via authorizeTwitch.

const TWITCH_CHANNELS_URL = "https://api.twitch.tv/helix/channels";
const TWITCH_MARKERS_URL = "https://api.twitch.tv/helix/streams/markers";

/** Helix caps a marker description at this many characters. */
export const MAX_MARKER_DESCRIPTION_LENGTH = 140;

export interface ChannelInfo {
  title: string;
  categoryId: string;
  categoryName: string;
  tags: string[];
}

/** The channel in a Helix `/channels` response, or null when Twitch returned none. */
export function channelInfoFromHelix(body: unknown): ChannelInfo | null {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }
  const channel = data[0] as Record<string, unknown>;
  const tags = Array.isArray(channel.tags) ? channel.tags.filter((tag): tag is string => typeof tag === "string") : [];
  return {
    title: typeof channel.title === "string" ? channel.title : "",
    categoryId: typeof channel.game_id === "string" ? channel.game_id : "",
    categoryName: typeof channel.game_name === "string" ? channel.game_name : "",
    tags,
  };
}

export async function fetchChannelInfo(twitch: AuthorizedTwitchCall): Promise<ChannelInfo> {
  const response = await fetch(`${TWITCH_CHANNELS_URL}?broadcaster_id=${twitch.broadcasterUserId}`, {
    headers: { Authorization: `Bearer ${twitch.accessToken}`, "Client-Id": twitch.clientId },
  });
  if (!response.ok) {
    throw new Error(`Twitch channel lookup failed: ${response.status} ${await response.text()}`);
  }
  const channel = channelInfoFromHelix(await response.json());
  if (!channel) {
    throw new Error("Twitch returned no channel for this account");
  }
  return channel;
}

/**
 * Drops a marker at the current point of the live broadcast. Needs
 * channel:manage:broadcast, and Twitch answers 404 when the channel is not live.
 */
export async function createStreamMarker(twitch: AuthorizedTwitchCall, description: string): Promise<void> {
  if (description.length > MAX_MARKER_DESCRIPTION_LENGTH) {
    throw new Error(`Stream marker descriptions are limited to ${MAX_MARKER_DESCRIPTION_LENGTH} characters`);
  }
  const response = await fetch(TWITCH_MARKERS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${twitch.accessToken}`,
      "Client-Id": twitch.clientId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ user_id: twitch.broadcasterUserId, description }),
  });
  if (response.status === 404) {
    throw new Error("Twitch only places markers on a live stream");
  }
  if (!response.ok) {
    throw new Error(`Twitch stream marker failed: ${response.status} ${await response.text()}`);
  }
}
