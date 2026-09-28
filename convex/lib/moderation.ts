// Pure rules for the Moderation dashboard widget: what Twitch will accept, who
// in the instance may do what, and how a Helix refusal reads to a streamer.
// Shared by the Convex actions (which enforce) and the widget (which disables
// and explains), so the two cannot disagree about a limit.

export type InstanceRole = "owner" | "admin" | "member";

// ---------------------------------------------------------------------------
// Scopes and capabilities
// ---------------------------------------------------------------------------

export const MODERATION_SCOPES = {
  blockedTerms: "moderator:manage:blocked_terms",
  bans: "moderator:manage:banned_users",
  chatSettings: "moderator:manage:chat_settings",
  readChatSettings: "moderator:read:chat_settings",
} as const;

export type ModerationCapability = "addBlockedTerm" | "removeBlockedTerm" | "timeout" | "ban" | "chatSettings";

interface CapabilityRule {
  scope: string;
  roles: readonly InstanceRole[];
}

// Adding a blocked term and timing someone out are open to every member: both
// are what a helper covering chat reaches for, and both fail safe (a term can
// be removed, a timeout expires). The rest stays with the people who run the
// channel: removing a term can silently unblock a slur, a ban lasts until
// someone lifts it, and a lockdown changes chat for everyone.
export const CAPABILITY_RULES: Record<ModerationCapability, CapabilityRule> = {
  addBlockedTerm: { scope: MODERATION_SCOPES.blockedTerms, roles: ["owner", "admin", "member"] },
  removeBlockedTerm: { scope: MODERATION_SCOPES.blockedTerms, roles: ["owner", "admin"] },
  timeout: { scope: MODERATION_SCOPES.bans, roles: ["owner", "admin", "member"] },
  ban: { scope: MODERATION_SCOPES.bans, roles: ["owner", "admin"] },
  chatSettings: { scope: MODERATION_SCOPES.chatSettings, roles: ["owner", "admin"] },
};

export type CapabilityStatus = "ready" | "not-linked" | "not-allowed" | "needs-reconnect";

export function capabilityStatus(
  capability: ModerationCapability,
  role: InstanceRole,
  scopes: readonly string[] | null
): CapabilityStatus {
  if (scopes === null) {
    return "not-linked";
  }
  const rule = CAPABILITY_RULES[capability];
  if (!rule.roles.includes(role)) {
    return "not-allowed";
  }
  if (!scopes.includes(rule.scope)) {
    return "needs-reconnect";
  }
  return "ready";
}

export function moderationAccess(
  role: InstanceRole,
  scopes: readonly string[] | null
): Record<ModerationCapability, CapabilityStatus> {
  return {
    addBlockedTerm: capabilityStatus("addBlockedTerm", role, scopes),
    removeBlockedTerm: capabilityStatus("removeBlockedTerm", role, scopes),
    timeout: capabilityStatus("timeout", role, scopes),
    ban: capabilityStatus("ban", role, scopes),
    chatSettings: capabilityStatus("chatSettings", role, scopes),
  };
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

export const BLOCKED_TERM_MIN_LENGTH = 2;
export const BLOCKED_TERM_MAX_LENGTH = 500;

export function validateBlockedTerm(input: string): Validated<string> {
  const text = input.trim();
  if (text.length < BLOCKED_TERM_MIN_LENGTH) {
    return { ok: false, error: `A blocked term needs at least ${BLOCKED_TERM_MIN_LENGTH} characters` };
  }
  if (text.length > BLOCKED_TERM_MAX_LENGTH) {
    return { ok: false, error: `A blocked term can be at most ${BLOCKED_TERM_MAX_LENGTH} characters` };
  }
  return { ok: true, value: text };
}

/** Helix accepts a timeout of one second up to two weeks. */
export const TIMEOUT_MIN_SECONDS = 1;
export const TIMEOUT_MAX_SECONDS = 1_209_600;

export const TIMEOUT_PRESETS = [
  { label: "60s", seconds: 60 },
  { label: "10m", seconds: 600 },
  { label: "1h", seconds: 3_600 },
  { label: "24h", seconds: 86_400 },
] as const;

const DURATION_UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3_600, d: 86_400, w: 604_800 };
const DURATION_SHAPE = /^(\d+\s*[smhdw]\s*)+$/;

/**
 * A duration as a streamer types it: `90` (seconds), `90s`, `10m`, `1h30m`,
 * `2d`, `1w`. Null when it is not one of those shapes; range is checked
 * separately so the error can say which limit was crossed.
 */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (text === "") {
    return null;
  }
  if (/^\d+$/.test(text)) {
    return Number(text);
  }
  if (!DURATION_SHAPE.test(text)) {
    return null;
  }
  const part = /(\d+)\s*([smhdw])/g;
  let total = 0;
  for (let match = part.exec(text); match !== null; match = part.exec(text)) {
    total += Number(match[1]) * DURATION_UNIT_SECONDS[match[2]];
  }
  return total;
}

export function validateTimeoutSeconds(seconds: number): Validated<number> {
  if (!Number.isInteger(seconds)) {
    return { ok: false, error: "A timeout is a whole number of seconds" };
  }
  if (seconds < TIMEOUT_MIN_SECONDS) {
    return { ok: false, error: "A timeout must be at least one second" };
  }
  if (seconds > TIMEOUT_MAX_SECONDS) {
    return { ok: false, error: "Twitch timeouts are limited to two weeks" };
  }
  return { ok: true, value: seconds };
}

/** `5400` → `1h 30m`. Drops zero parts; always shows at least one. */
export function formatDuration(seconds: number): string {
  const parts: string[] = [];
  let rest = Math.max(0, Math.floor(seconds));
  for (const [unit, size] of [
    ["d", 86_400],
    ["h", 3_600],
    ["m", 60],
    ["s", 1],
  ] as const) {
    const count = Math.floor(rest / size);
    if (count > 0) {
      parts.push(`${count}${unit}`);
      rest -= count * size;
    }
  }
  return parts.length === 0 ? "0s" : parts.join(" ");
}

export const BAN_REASON_MAX_LENGTH = 500;

export function validateBanReason(input: string): Validated<string> {
  const reason = input.trim();
  if (reason.length > BAN_REASON_MAX_LENGTH) {
    return { ok: false, error: `A reason can be at most ${BAN_REASON_MAX_LENGTH} characters` };
  }
  return { ok: true, value: reason };
}

// ---------------------------------------------------------------------------
// Chat settings
// ---------------------------------------------------------------------------

export const SLOW_MODE_MIN_SECONDS = 3;
export const SLOW_MODE_MAX_SECONDS = 120;
export const SLOW_MODE_OPTIONS = [3, 5, 10, 30, 60, 120] as const;

/** Follower-only mode takes minutes, from 0 (any follower) up to three months. */
export const FOLLOWER_MODE_MAX_MINUTES = 129_600;
export const FOLLOWER_MODE_OPTIONS = [
  { label: "Any follower", minutes: 0 },
  { label: "10 minutes", minutes: 10 },
  { label: "1 hour", minutes: 60 },
  { label: "1 day", minutes: 1_440 },
  { label: "1 week", minutes: 10_080 },
] as const;

export interface ChatSettings {
  emoteMode: boolean;
  followerMode: boolean;
  /** Minutes an account must have followed; null while follower mode is off. */
  followerModeDuration: number | null;
  slowMode: boolean;
  /** Seconds between messages; null while slow mode is off. */
  slowModeWaitTime: number | null;
  subscriberMode: boolean;
}

/** A change to chat modes. A duration names the value to set, so it is never null here. */
export interface ChatSettingsPatch {
  emoteMode?: boolean;
  followerMode?: boolean;
  followerModeDuration?: number;
  slowMode?: boolean;
  slowModeWaitTime?: number;
  subscriberMode?: boolean;
}

export function chatSettingsFromHelix(body: unknown): ChatSettings | null {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }
  const row = data[0] as Record<string, unknown>;
  return {
    emoteMode: row.emote_mode === true,
    followerMode: row.follower_mode === true,
    followerModeDuration: typeof row.follower_mode_duration === "number" ? row.follower_mode_duration : null,
    slowMode: row.slow_mode === true,
    slowModeWaitTime: typeof row.slow_mode_wait_time === "number" ? row.slow_mode_wait_time : null,
    subscriberMode: row.subscriber_mode === true,
  };
}

/**
 * The PATCH body for a settings change, in Helix's field names. Only the
 * fields named in the patch are sent: Helix leaves the rest alone, so a toggle
 * never clobbers a mode someone else changed from Twitch in the meantime.
 */
export function chatSettingsToHelix(patch: ChatSettingsPatch): Validated<Record<string, boolean | number>> {
  const body: Record<string, boolean | number> = {};
  if (patch.emoteMode !== undefined) {
    body.emote_mode = patch.emoteMode;
  }
  if (patch.subscriberMode !== undefined) {
    body.subscriber_mode = patch.subscriberMode;
  }
  if (patch.followerMode !== undefined) {
    body.follower_mode = patch.followerMode;
  }
  if (patch.followerModeDuration !== undefined) {
    const minutes = patch.followerModeDuration;
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > FOLLOWER_MODE_MAX_MINUTES) {
      return { ok: false, error: "Follower-only duration must be between 0 minutes and 90 days" };
    }
    body.follower_mode_duration = minutes;
  }
  if (patch.slowMode !== undefined) {
    body.slow_mode = patch.slowMode;
  }
  if (patch.slowModeWaitTime !== undefined) {
    const seconds = patch.slowModeWaitTime;
    if (!Number.isInteger(seconds) || seconds < SLOW_MODE_MIN_SECONDS || seconds > SLOW_MODE_MAX_SECONDS) {
      return {
        ok: false,
        error: `Slow mode must be between ${SLOW_MODE_MIN_SECONDS} and ${SLOW_MODE_MAX_SECONDS} seconds`,
      };
    }
    body.slow_mode_wait_time = seconds;
  }
  if (Object.keys(body).length === 0) {
    return { ok: false, error: "No chat setting to change" };
  }
  return { ok: true, value: body };
}

// ---------------------------------------------------------------------------
// Helix errors
// ---------------------------------------------------------------------------

export type ModerationOperation =
  | "list-terms"
  | "add-term"
  | "remove-term"
  | "timeout"
  | "ban"
  | "unban"
  | "read-settings"
  | "update-settings";

const OPERATION_LABELS: Record<ModerationOperation, string> = {
  "list-terms": "Loading blocked terms",
  "add-term": "Blocking that term",
  "remove-term": "Removing that term",
  timeout: "The timeout",
  ban: "The ban",
  unban: "The unban",
  "read-settings": "Loading chat settings",
  "update-settings": "Changing chat settings",
};

/** Helix error bodies are `{ error, status, message }`; anything else yields "". */
export function helixErrorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    return typeof parsed.message === "string" ? parsed.message : "";
  } catch {
    return "";
  }
}

/**
 * A Helix refusal as a sentence a streamer can act on mid-stream. Twitch
 * distinguishes most of these only by the message text on a 400, so the
 * matching is on phrases Helix documents for each endpoint.
 */
export function describeModerationError(operation: ModerationOperation, status: number, message: string): string {
  const text = message.toLowerCase();
  if (status === 401) {
    return "Twitch rejected the connection. Reconnect Twitch in Settings → Integrations.";
  }
  if (status === 403) {
    return "Twitch says this account is not allowed to do that. Reconnect Twitch in Settings → Integrations.";
  }
  if (status === 429) {
    return "Twitch is rate-limiting moderation right now. Try again in a few seconds.";
  }
  if (status === 409) {
    return "Someone else is changing this at the same moment. Try again.";
  }
  if (operation === "ban" || operation === "timeout") {
    if (text.includes("already banned")) {
      return operation === "ban"
        ? "That user is already banned."
        : "That user is banned, so a timeout would do nothing.";
    }
    if (text.includes("may not be banned") || text.includes("cannot be banned") || text.includes("can't be banned")) {
      return "Twitch won't let that account be banned or timed out.";
    }
  }
  if (operation === "unban" && text.includes("not banned")) {
    return "That user is not banned or timed out.";
  }
  if (operation === "add-term" && text.includes("already")) {
    return "That term is already blocked.";
  }
  const label = OPERATION_LABELS[operation];
  return message ? `${label} failed: ${message}` : `${label} failed (Twitch ${status}).`;
}
