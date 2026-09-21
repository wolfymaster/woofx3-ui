/**
 * How the bundled woofx3 module's timer and queue kinds store their values at
 * `state:<canonicalId>`, read back into what their pages show. The shapes and
 * the queue's rules must match `modules/woofx3/functions/timer.js` and
 * `queue.js` in the engine.
 *
 * A value that holds nothing — never written, or cleared when a stream session
 * ended — reads the way the module reads it: a timer stopped at its full
 * duration, an empty queue.
 */

export interface TimerState {
  running: boolean;
  /** Time left at the moment it was read, never below zero. */
  remainingMs: number;
}

/** What a timer runs for when its `duration` setting is missing; the module's own default. */
const DEFAULT_DURATION_SECONDS = 300;

export function timerDurationMs(settings: Record<string, unknown>): number {
  const seconds = Number(settings.duration);
  const valid = settings.duration !== undefined && settings.duration !== "" && Number.isFinite(seconds);
  return Math.max(0, (valid ? seconds : DEFAULT_DURATION_SECONDS) * 1000);
}

/**
 * A running timer is stored as the moment it ends and never rewritten as it
 * ticks, so its time left depends on `now`.
 */
export function timerState(value: unknown, settings: Record<string, unknown>, now: number): TimerState {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const stored = value as Record<string, unknown>;
    if (stored.running === true) {
      return { running: true, remainingMs: Math.max(0, Number(stored.endsAt) - now || 0) };
    }
    return { running: false, remainingMs: Math.max(0, Number(stored.remainingMs) || 0) };
  }
  return { running: false, remainingMs: timerDurationMs(settings) };
}

/**
 * `h:mm:ss`, or `m:ss` under an hour. Rounds up, so a timer with any time left
 * never shows 0:00 — the same rounding the timer actions report.
 */
export function formatDuration(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
  }
  return `${minutes}:${ss}`;
}

/**
 * Seconds from what a person types for a time: `90`, `1:30` or `1:02:30`.
 * Null for anything else, including a negative time.
 */
export function parseDuration(input: string): number | null {
  const parts = input.trim().split(":");
  if (parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) {
    return null;
  }
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

/** A queue's entries, first in line first. */
export function queueEntries(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/** The most entries any queue holds, whatever its settings say. */
const QUEUE_HARD_LIMIT = 1000;

/** How many entries a queue holds before it refuses more; a capacity of 0 means the hard limit. */
export function queueCapacity(settings: Record<string, unknown>): number {
  const capacity = Number(settings.capacity);
  return Number.isFinite(capacity) && capacity >= 1
    ? Math.min(QUEUE_HARD_LIMIT, Math.floor(capacity))
    : QUEUE_HARD_LIMIT;
}

export type QueueAddRefusal = "duplicate" | "full";

/**
 * Why the queue would refuse `entry`, or null when it would take it. The queue
 * decides for itself when the action runs; this lets the page say why before
 * sending, since a dashboard run reports no result back.
 */
export function queueAddRefusal(
  entries: string[],
  settings: Record<string, unknown>,
  entry: string
): QueueAddRefusal | null {
  if (settings.allowDuplicates !== true && entries.includes(entry.trim())) {
    return "duplicate";
  }
  if (entries.length >= queueCapacity(settings)) {
    return "full";
  }
  return null;
}
