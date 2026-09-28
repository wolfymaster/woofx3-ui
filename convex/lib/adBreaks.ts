/**
 * The engine's ad-break RPCs and events, as the UI reads them.
 *
 * Declared here rather than taken from @woofx3/api because the shared contract
 * does not carry them yet. Must match the engine's getAdSchedule and
 * snoozeNextAd return shapes and the channel.ad_break.* CloudEvent payloads.
 * Times are ISO-8601 strings; null means Twitch reported none. The parsers
 * below also normalize the looser forms described at normalizeTimestamp.
 */
export interface AdSchedule {
  /** When the next scheduled mid-roll starts; null when none is scheduled. */
  nextAdAt: string | null;
  /** When the last ad break started. */
  lastAdAt: string | null;
  /** Length of the next scheduled ad break. */
  durationSeconds: number;
  /** Preroll-free time left at the moment the engine answered. */
  prerollFreeSeconds: number;
  /** Snoozes left to spend. */
  snoozeCount: number;
  /** When the next snooze is added back; null when the count is full. */
  snoozeRefreshAt: string | null;
  /** The engine's clock when it answered; null from an engine that does not send it. */
  serverNow: string | null;
}

export interface AdSnoozeResult {
  snoozeCount: number;
  snoozeRefreshAt: string | null;
  nextAdAt: string | null;
  serverNow: string | null;
}

/**
 * `begin` ({durationSeconds, isAutomatic, startedAt}) comes from Twitch
 * EventSub. Twitch sends nothing before or after an ad, so the engine
 * synthesizes the other two from the schedule it polls: `upcoming`
 * ({nextAdAt, secondsUntil, durationSeconds}) shortly before a scheduled ad,
 * and `end` ({durationSeconds, startedAt, endedAt}) once a begun ad's length
 * has run out.
 */
export const AD_BREAK_EVENTS = {
  upcoming: "channel.ad_break.upcoming",
  begin: "channel.ad_break.begin",
  end: "channel.ad_break.end",
} as const;

/** The Twitch capability label the ad scopes belong to; must match TWITCH_CAPABILITIES. */
export const AD_BREAKS_CAPABILITY = "Ad breaks";

export const ENGINE_TOO_OLD_FOR_ADS = "Your engine does not support ad breaks yet. Update your engine to use this.";

/**
 * What `adBreaks.getSchedule` answers. Anything the widget has to render as a
 * state rather than an error (an engine without the method, an instance not
 * registered with one) is a variant, so the browser never parses messages.
 */
export type AdScheduleResult =
  | { state: "ok"; schedule: AdSchedule }
  | { state: "engineOutdated" }
  | { state: "unregistered" };

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

const INVALID = Symbol("invalid");

/**
 * A timestamp as ISO-8601, null for none, or INVALID. The contract says ISO or
 * null; an empty string and Unix epoch seconds (a number or a numeric string)
 * are also taken, since Helix itself answers with both and an engine passing
 * a field through unconverted should not blank the widget.
 */
export function normalizeTimestamp(value: unknown): string | null | typeof INVALID {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      return INVALID;
    }
    // Helix reports "no last ad" as 0.
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

/**
 * The engine's answer checked against AdSchedule, or null. A malformed answer
 * is refused whole rather than patched: a countdown built from a guessed field
 * would tell the streamer the wrong time.
 */
export function parseAdSchedule(raw: unknown): AdSchedule | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const times = timestamps(r, ["nextAdAt", "lastAdAt", "snoozeRefreshAt", "serverNow"] as const);
  if (!times || !isCount(r.durationSeconds) || !isCount(r.prerollFreeSeconds) || !isCount(r.snoozeCount)) {
    return null;
  }
  return {
    nextAdAt: times.nextAdAt,
    lastAdAt: times.lastAdAt,
    durationSeconds: r.durationSeconds,
    prerollFreeSeconds: r.prerollFreeSeconds,
    snoozeCount: r.snoozeCount,
    snoozeRefreshAt: times.snoozeRefreshAt,
    serverNow: times.serverNow,
  };
}

export function parseAdSnoozeResult(raw: unknown): AdSnoozeResult | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const times = timestamps(r, ["nextAdAt", "snoozeRefreshAt", "serverNow"] as const);
  if (!times || !isCount(r.snoozeCount)) {
    return null;
  }
  return {
    snoozeCount: r.snoozeCount,
    snoozeRefreshAt: times.snoozeRefreshAt,
    nextAdAt: times.nextAdAt,
    serverNow: times.serverNow,
  };
}

/**
 * Moves an engine timestamp onto the local clock. The engine's clock and the
 * browser's can disagree by more than a countdown can hide, so a time is kept
 * as its distance from the engine's `serverNow`, anchored at the moment the
 * answer arrived. Without `serverNow` the time is taken as it is.
 */
export function toLocalTime(iso: string | null, serverNow: string | null, receivedAt: number): number | null {
  if (iso === null) {
    return null;
  }
  const at = Date.parse(iso);
  if (serverNow === null) {
    return at;
  }
  return receivedAt + (at - Date.parse(serverNow));
}
