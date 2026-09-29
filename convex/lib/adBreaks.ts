/**
 * The ad schedule as the dashboard reads it from Helix, and the ad-break
 * events the engine forwards over the stream-event session.
 *
 * Times are ISO-8601 strings; null means Twitch reported none. Helix
 * documents its ad times as RFC3339 but answers with Unix epoch seconds (a
 * number or a numeric string), 0 or "" for none, so the parsers below accept
 * every one of those forms (see normalizeTimestamp).
 */
export interface AdSchedule {
  /** When the next scheduled mid-roll starts; null when none is scheduled. */
  nextAdAt: string | null;
  /** When the last ad break started. */
  lastAdAt: string | null;
  /** Length of the next scheduled ad break. */
  durationSeconds: number;
  /** Preroll-free time left at the moment Twitch answered. */
  prerollFreeSeconds: number;
  /** Snoozes left to spend. */
  snoozeCount: number;
  /** When the next snooze is added back; null when the count is full. */
  snoozeRefreshAt: string | null;
  /** The Convex action's clock when Twitch answered, the reference the other times are read against. */
  serverNow: string;
}

export interface AdSnoozeResult {
  snoozeCount: number;
  snoozeRefreshAt: string | null;
  nextAdAt: string | null;
  serverNow: string;
}

/**
 * `begin` ({durationSeconds, isAutomatic, startedAt}) comes from Twitch
 * EventSub. Twitch sends nothing before or after an ad, so the engine's
 * Twitch service synthesizes the other two from the schedule it polls:
 * `upcoming` ({nextAdAt, secondsUntil, durationSeconds}) shortly before a
 * scheduled ad, and `end` ({durationSeconds, startedAt, endedAt}) once a
 * begun ad's length has run out.
 */
export const AD_BREAK_EVENTS = {
  upcoming: "channel.ad_break.upcoming",
  begin: "channel.ad_break.begin",
  end: "channel.ad_break.end",
} as const;

/** The Twitch capability label the ad scopes belong to; must match TWITCH_CAPABILITIES. */
export const AD_BREAKS_CAPABILITY = "Ad breaks";

export const AD_READ_SCOPE = "channel:read:ads";
export const AD_MANAGE_SCOPE = "channel:manage:ads";

export const AD_SCOPE_MISSING_MESSAGE = "Reconnect Twitch to allow ad controls.";

export type AdHelixOperation = "read" | "snooze";

/**
 * The sentence for a failed Helix ads call. Helix reports a token without the
 * ads scope as a 401 whose message names the scope, or as a 403; both mean
 * the link needs regranting, not that it is broken. A 400 on a snooze is Twitch
 * refusing it for a reason the streamer can act on ("no snoozes left",
 * "channel is not live"), so Twitch's own message is the one to show.
 */
export function adHelixErrorMessage(operation: AdHelixOperation, status: number, twitchMessage: string): string {
  const what = operation === "read" ? "Could not read the ad schedule" : "Could not snooze the next ad";
  if (status === 403 || (status === 401 && /scope/i.test(twitchMessage))) {
    return AD_SCOPE_MISSING_MESSAGE;
  }
  if (status === 401) {
    return `${what}: Twitch rejected the connection. Reconnect Twitch in Settings → Integrations.`;
  }
  if (status === 429) {
    return `${what}: Twitch is rate-limiting this. Try again in a moment.`;
  }
  if (status === 400 && operation === "snooze" && twitchMessage !== "") {
    return twitchMessage;
  }
  return `${what}: ${twitchMessage || `Twitch answered ${status}`}`;
}

/** The `message` of a Helix error body (`{ error, status, message }`), or the raw text. */
export function helixErrorText(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message !== "") {
      return parsed.message;
    }
  } catch {
    // Not JSON: the raw text is the best reason available.
  }
  return body.trim();
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

const INVALID = Symbol("invalid");

/** A timestamp as ISO-8601, null for none, or INVALID. */
export function normalizeTimestamp(value: unknown): string | null | typeof INVALID {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      return INVALID;
    }
    return value === 0 ? null : new Date(value * 1000).toISOString();
  }
  if (typeof value !== "string") {
    return INVALID;
  }
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? INVALID : new Date(parsed).toISOString();
}

function timestamps<K extends string>(r: Record<string, unknown>, keys: readonly K[]): Record<K, string | null> | null {
  const out = {} as Record<K, string | null>;
  for (const key of keys) {
    const normalized = normalizeTimestamp(r[key]);
    if (normalized === INVALID) {
      return null;
    }
    out[key] = normalized;
  }
  return out;
}

/** The single entry of a Helix ads answer (`{ data: [ {...} ] }`), or null. */
function helixEntry(body: unknown): Record<string, unknown> | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }
  const entry = data[0];
  return typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : null;
}

/**
 * Get Ad Schedule's answer as an AdSchedule, or null. A malformed answer is
 * refused whole rather than patched: a countdown built from a guessed field
 * would tell the streamer the wrong time. `serverNow` is the caller's clock
 * at receipt, since Helix sends none of its own.
 */
export function parseHelixAdSchedule(body: unknown, serverNow: string): AdSchedule | null {
  const r = helixEntry(body);
  if (!r) {
    return null;
  }
  const times = timestamps(r, ["next_ad_at", "last_ad_at", "snooze_refresh_at"] as const);
  if (!times || !isCount(r.duration) || !isCount(r.preroll_free_time) || !isCount(r.snooze_count)) {
    return null;
  }
  return {
    nextAdAt: times.next_ad_at,
    lastAdAt: times.last_ad_at,
    durationSeconds: r.duration,
    prerollFreeSeconds: r.preroll_free_time,
    snoozeCount: r.snooze_count,
    snoozeRefreshAt: times.snooze_refresh_at,
    serverNow,
  };
}

/** Snooze Next Ad's answer as an AdSnoozeResult, or null. */
export function parseHelixSnoozeResult(body: unknown, serverNow: string): AdSnoozeResult | null {
  const r = helixEntry(body);
  if (!r) {
    return null;
  }
  const times = timestamps(r, ["next_ad_at", "snooze_refresh_at"] as const);
  if (!times || !isCount(r.snooze_count)) {
    return null;
  }
  return {
    snoozeCount: r.snooze_count,
    snoozeRefreshAt: times.snooze_refresh_at,
    nextAdAt: times.next_ad_at,
    serverNow,
  };
}

/**
 * Moves a schedule timestamp onto the browser's clock. The Convex backend's
 * clock and the browser's can disagree by more than a countdown can hide, so
 * a time is kept as its distance from the answer's `serverNow`, anchored at
 * the moment the answer arrived.
 */
export function toLocalTime(iso: string | null, serverNow: string, receivedAt: number): number | null {
  if (iso === null) {
    return null;
  }
  return receivedAt + (Date.parse(iso) - Date.parse(serverNow));
}
