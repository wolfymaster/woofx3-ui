import type { AdScheduleResult } from "@convex/lib/adBreaks";

/**
 * What the Ad breaks widget shows, decided from everything it knows. Pure, so
 * the order the states win in is tested without rendering: a channel that is
 * offline shows nothing about ads whatever else is true, a missing scope wins
 * over anything the engine said, and a running ad wins over the schedule.
 */

export type AdScheduleFetch =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; result: AdScheduleResult; fetchedAt: number };

/** An ad break seen starting, from a channel.ad_break.begin event. */
export interface RunningAd {
  startedAt: number;
  durationSeconds: number;
}

export interface AdBreakInputs {
  /** Undefined while the live state is loading. */
  live: boolean | undefined;
  scopeGranted: boolean;
  fetch: AdScheduleFetch;
  running: RunningAd | null;
  now: number;
}

export type AdBreakView =
  | { kind: "loading" }
  | { kind: "offline" }
  | { kind: "scopeMissing" }
  | { kind: "engineOutdated" }
  | { kind: "unregistered" }
  | { kind: "error"; message: string }
  | { kind: "running"; secondsLeft: number }
  | {
      kind: "scheduled";
      /** Null when Twitch has no mid-roll scheduled. */
      secondsUntilNext: number | null;
      durationSeconds: number;
      secondsSinceLast: number | null;
      prerollFreeSeconds: number;
      snoozeCount: number;
      /** Null when no snooze is waiting to be added back. */
      secondsUntilSnoozeRefresh: number | null;
    };

function secondsBetween(fromMs: number, toMs: number): number {
  return Math.max(0, Math.ceil((toMs - fromMs) / 1000));
}

function secondsUntil(iso: string | null, now: number): number | null {
  if (iso === null) {
    return null;
  }
  return secondsBetween(now, Date.parse(iso));
}

function runningSecondsLeft(running: RunningAd, now: number): number {
  return secondsBetween(now, running.startedAt + running.durationSeconds * 1000);
}

export function adBreakView(inputs: AdBreakInputs): AdBreakView {
  const { live, scopeGranted, fetch, running, now } = inputs;
  if (live === undefined) {
    return { kind: "loading" };
  }
  if (!live) {
    return { kind: "offline" };
  }
  if (!scopeGranted) {
    return { kind: "scopeMissing" };
  }
  if (running && runningSecondsLeft(running, now) > 0) {
    return { kind: "running", secondsLeft: runningSecondsLeft(running, now) };
  }
  if (fetch.status === "loading") {
    return { kind: "loading" };
  }
  if (fetch.status === "error") {
    return { kind: "error", message: fetch.message };
  }
  const result = fetch.result;
  if (result.state === "engineOutdated") {
    return { kind: "engineOutdated" };
  }
  if (result.state === "unregistered") {
    return { kind: "unregistered" };
  }
  const schedule = result.schedule;
  // Without begin events the last ad's start is the only sign one is running.
  // Its length is taken from the schedule, which describes the next break, so
  // this can be off when the two differ; a begin event, when one arrives, wins.
  if (schedule.lastAdAt !== null) {
    const inferred = runningSecondsLeft(
      { startedAt: Date.parse(schedule.lastAdAt), durationSeconds: schedule.durationSeconds },
      now
    );
    if (inferred > 0) {
      return { kind: "running", secondsLeft: inferred };
    }
  }
  const elapsedSinceFetch = Math.max(0, Math.floor((now - fetch.fetchedAt) / 1000));
  return {
    kind: "scheduled",
    secondsUntilNext: secondsUntil(schedule.nextAdAt, now),
    durationSeconds: schedule.durationSeconds,
    secondsSinceLast: schedule.lastAdAt === null ? null : secondsBetween(Date.parse(schedule.lastAdAt), now),
    prerollFreeSeconds: Math.max(0, schedule.prerollFreeSeconds - elapsedSinceFetch),
    snoozeCount: schedule.snoozeCount,
    secondsUntilSnoozeRefresh: secondsUntil(schedule.snoozeRefreshAt, now),
  };
}

/** `m:ss` under an hour, `h:mm:ss` from there; negative reads as zero. */
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  }
  return `${m}:${ss}`;
}

/** A coarse "how long ago" for the last ad, where seconds would only flicker. */
export function formatAgo(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

/**
 * A running ad from a channel.ad_break.begin payload, or null when the payload
 * lacks what a countdown needs. `startedAt` falls back to the frame's receipt
 * time: a countdown a second late beats none.
 */
export function runningAdFromBegin(data: unknown, receivedAt: number): RunningAd | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const d = data as Record<string, unknown>;
  const duration = d.durationSeconds;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
    return null;
  }
  const parsed = typeof d.startedAt === "string" ? Date.parse(d.startedAt) : Number.NaN;
  return { startedAt: Number.isNaN(parsed) ? receivedAt : parsed, durationSeconds: duration };
}
