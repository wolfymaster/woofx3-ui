/**
 * The engine's ad-break RPCs and events, as the UI reads them.
 *
 * Declared here rather than taken from @woofx3/api because the shared contract
 * does not carry them yet. Must match the engine's getAdSchedule and
 * snoozeNextAd return shapes and the channel.ad_break.* CloudEvent payloads.
 * Times are ISO-8601 strings; null means Twitch reported none.
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
}

export interface AdSnoozeResult {
  snoozeCount: number;
  snoozeRefreshAt: string | null;
  nextAdAt: string | null;
}

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

function isIsoOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && !Number.isNaN(Date.parse(value)));
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
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
  if (
    !isIsoOrNull(r.nextAdAt) ||
    !isIsoOrNull(r.lastAdAt) ||
    !isIsoOrNull(r.snoozeRefreshAt) ||
    !isCount(r.durationSeconds) ||
    !isCount(r.prerollFreeSeconds) ||
    !isCount(r.snoozeCount)
  ) {
    return null;
  }
  return {
    nextAdAt: r.nextAdAt,
    lastAdAt: r.lastAdAt,
    durationSeconds: r.durationSeconds,
    prerollFreeSeconds: r.prerollFreeSeconds,
    snoozeCount: r.snoozeCount,
    snoozeRefreshAt: r.snoozeRefreshAt,
  };
}

export function parseAdSnoozeResult(raw: unknown): AdSnoozeResult | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (!isCount(r.snoozeCount) || !isIsoOrNull(r.snoozeRefreshAt) || !isIsoOrNull(r.nextAdAt)) {
    return null;
  }
  return { snoozeCount: r.snoozeCount, snoozeRefreshAt: r.snoozeRefreshAt, nextAdAt: r.nextAdAt };
}
