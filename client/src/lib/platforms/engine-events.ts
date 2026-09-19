import type { StreamEventFrame } from "@woofx3/api";
import type { PlatformEvent, PlatformEventType } from "./types";

// The engine publishes platform-agnostic CloudEvents whose `type` is also the
// NATS subject. Only the four the dashboard widgets render are mapped; the
// broadcaster also carries channel.subscriptionGift and stream.online/offline,
// which have no PlatformEventType and are dropped here rather than surfacing as
// a half-populated row.
const FRAME_TYPE_TO_EVENT: Record<string, PlatformEventType> = {
  "channel.follow": "follow",
  "channel.subscribe": "subscribe",
  "channel.cheer": "cheer",
  "channel.raid": "raid",
};

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * A malformed or missing timestamp becomes "now" rather than an Invalid Date,
 * which would render as NaN in the widgets' relative-time formatting.
 */
function parseTime(time: string): Date {
  const parsed = Date.parse(time);
  return Number.isNaN(parsed) ? new Date() : new Date(parsed);
}

/**
 * Map an engine stream-event frame onto the shape dashboard widgets consume, or
 * null when the event is not one they render.
 *
 * The engine's payloads are already normalized to camelCase by the twitch
 * service, so the field names here deliberately differ from Twitch's raw
 * EventSub wire format (`bits`, `user_name`, `from_broadcaster_user_name`):
 * reading those off a CloudEvent would silently yield undefined everywhere.
 */
export function frameToPlatformEvent(frame: StreamEventFrame): PlatformEvent | null {
  const type = FRAME_TYPE_TO_EVENT[frame.type];
  if (!type) {
    return null;
  }

  const data = (frame.data ?? {}) as Record<string, unknown>;
  // The CloudEvent id is preferred over a fresh uuid so the same event keeps
  // one identity if it is ever delivered twice.
  const base = {
    id: frame.id ?? crypto.randomUUID(),
    platform: "twitch" as const,
    type,
    timestamp: parseTime(frame.time),
  };

  switch (type) {
    case "follow":
      return { ...base, userName: text(data.userName) ?? "Unknown" };
    case "subscribe":
      return {
        ...base,
        userName: text(data.userName) ?? "Anonymous",
        tier: text(data.tier),
      };
    case "cheer":
      return {
        ...base,
        userName: data.isAnonymous === true ? "Anonymous" : (text(data.userName) ?? "Unknown"),
        amount: count(data.amount),
        message: text(data.message),
      };
    case "raid":
      return {
        ...base,
        userName: text(data.fromBroadcasterUserName) ?? "Unknown",
        amount: count(data.viewers),
      };
  }
}
