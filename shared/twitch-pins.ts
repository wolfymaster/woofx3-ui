import { MAX_CHAT_MESSAGE_LENGTH } from "./twitch-chat";

/** The current pin as `GET /helix/chat/pins` describes it, narrowed to what the dashboard uses. */
export interface TwitchPin {
  messageId: string;
  /** The message's plain text. Null if Twitch sent none, which the widget shows as an unknown message. */
  text: string | null;
  /** Display name of whoever sent the pinned message. */
  senderName: string | null;
  /** When the message was pinned, as epoch ms. */
  pinnedAtMs: number | null;
  /** When the pin expires; null when it lasts until the stream ends. */
  endsAt: string | null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** The first pin in a `GET /helix/chat/pins` response, or null when nothing is pinned. */
export function parsePinsResponse(body: unknown): TwitchPin | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const data = (body as { data?: unknown }).data;
  const pin = Array.isArray(data) ? data[0] : undefined;
  if (typeof pin !== "object" || pin === null) {
    return null;
  }
  const fields = pin as Record<string, unknown>;
  const messageId = stringOrNull(fields.message_id);
  if (messageId === null) {
    return null;
  }
  const message = fields.message;
  const text =
    typeof message === "object" && message !== null ? stringOrNull((message as { text?: unknown }).text) : null;
  const startsAt = stringOrNull(fields.starts_at);
  const pinnedAtMs = startsAt === null ? null : Date.parse(startsAt);
  return {
    messageId,
    text,
    senderName: stringOrNull(fields.sender_user_name) ?? stringOrNull(fields.sender_user_login),
    pinnedAtMs: pinnedAtMs !== null && Number.isFinite(pinnedAtMs) ? pinnedAtMs : null,
    endsAt: stringOrNull(fields.ends_at),
  };
}

export const PIN_MANAGE_SCOPE = "moderator:manage:chat_messages";
export const PIN_READ_SCOPE = "moderator:read:chat_messages";

/** Why a trimmed message cannot be posted and pinned, or null. */
export function pinnedMessageProblem(text: string): string | null {
  if (!text) {
    return "A pinned message needs some text";
  }
  if (text.length > MAX_CHAT_MESSAGE_LENGTH) {
    return `Chat messages are limited to ${MAX_CHAT_MESSAGE_LENGTH} characters`;
  }
  return null;
}

/** The pin a Get Chat Pins answer holds, or null when nothing is pinned. */
export async function readCurrentPinAnswer(response: Response): Promise<TwitchPin | null> {
  if (!response.ok) {
    throw new Error(`Twitch pin lookup failed: ${response.status} ${await response.text()}`);
  }
  return parsePinsResponse(await response.json());
}

export async function readUnpinAnswer(response: Response): Promise<void> {
  if (!response.ok) {
    throw new Error(`Twitch unpin failed: ${response.status} ${await response.text()}`);
  }
}
