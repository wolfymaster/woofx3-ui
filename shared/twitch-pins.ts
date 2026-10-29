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
