/**
 * How the bundled woofx3 module's counter, timer and queue kinds store their
 * values at `state:<canonicalId>`, read back into what their pages show. The
 * shapes and the queue's rules must match `modules/woofx3/functions/counter.js`,
 * `timer.js` and `queue.js` in the engine.
 *
 * A value that holds nothing — never written, or cleared when a stream session
 * ended — reads the way the module reads it: a counter at its starting value, a
 * timer stopped at its full duration, an empty queue.
 */

/**
 * A counter's number. Stored as `{ value, reached }` since counters gained
 * goals; a counter last written before that holds a bare number, and reads the
 * same rather than falling back to its starting value.
 */
export function counterValue(value: unknown, settings: Record<string, unknown>): number {
  const stored =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>).value
      : value;
  const number = Number(stored);
  if (stored !== null && stored !== undefined && Number.isFinite(number)) {
    return number;
  }
  const initial = Number(settings.initialValue);
  return Number.isFinite(initial) ? initial : 0;
}

export interface CounterGoal {
  goal: number;
  /** "" when the goal has no name. */
  name: string;
  /** When the counter first reached it, in milliseconds since the epoch; null while it has not. */
  reachedAt: number | null;
}

/**
 * A counter's goals, smallest first, each with its name and when it was first
 * reached.
 *
 * Goals come from the `goals` setting, a list of `{ value, name }` rows, or for
 * a counter set up before goals had names, a comma-separated string of numbers.
 * A row whose number is not a number is skipped, and two rows with one number
 * are one goal named by the first that has a name, both as the module does
 * (`parseGoals` in the engine's counter.js). First crossings come from the
 * stored `reached` record, keyed by the goal as a string. A counter reset
 * forgets them, so a goal reads as unreached again after one.
 */
export function counterGoals(value: unknown, settings: Record<string, unknown>): CounterGoal[] {
  const raw = settings.goals;
  const rows: unknown = typeof raw === "string" ? raw.split(",").map((part) => ({ value: part })) : raw;
  if (!Array.isArray(rows)) {
    return [];
  }
  const reached =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>).reached
      : null;
  const record = reached !== null && typeof reached === "object" ? (reached as Record<string, unknown>) : {};

  const goals: { goal: number; name: string }[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== "object") {
      continue;
    }
    const { value: rawValue, name: rawName } = row as { value?: unknown; name?: unknown };
    const text = typeof rawValue === "string" ? rawValue.trim() : rawValue;
    const goal = Number(text);
    if (text === "" || text === null || text === undefined || !Number.isFinite(goal)) {
      continue;
    }
    const name = typeof rawName === "string" ? rawName.trim() : "";
    const existing = goals.find((entry) => entry.goal === goal);
    if (!existing) {
      goals.push({ goal, name });
    } else if (existing.name === "") {
      existing.name = name;
    }
  }
  return goals
    .sort((a, b) => a.goal - b.goal)
    .map(({ goal, name }) => {
      const stored = record[String(goal)];
      const at = Number(stored);
      return { goal, name, reachedAt: stored !== undefined && stored !== null && Number.isFinite(at) ? at : null };
    });
}

export interface GoalProgress {
  /** How far along the bar the counter is, from 0 to 1. */
  fraction: number;
  /** Where each goal sits along the bar, from 0 to 1, in the order given. */
  marks: number[];
  /** The goal the counter is working toward: the smallest above its value. Null once all are passed. */
  next: CounterGoal | null;
}

/**
 * A counter's progress toward its goals, as a bar that runs from where the
 * counter starts to its largest goal. A goal or a value below the start
 * stretches the bar to take it in, so nothing falls off the left end.
 * `goals` must be smallest first, as `counterGoals` returns them, and non-empty.
 */
export function goalProgress(value: number, start: number, goals: CounterGoal[]): GoalProgress {
  const low = Math.min(start, goals[0].goal);
  const high = Math.max(goals[goals.length - 1].goal, low + 1);
  const along = (n: number) => Math.min(1, Math.max(0, (n - low) / (high - low)));
  return {
    fraction: along(value),
    marks: goals.map((goal) => along(goal.goal)),
    next: goals.find((goal) => goal.goal > value) ?? null,
  };
}

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

/** The engine's limit on one entry: Twitch's chat message length, so any entry can be read back into chat. */
export const QUEUE_MAX_ENTRY_LENGTH = 500;

/** How many entries a queue holds before it refuses more; a capacity of 0 means the hard limit. */
export function queueCapacity(settings: Record<string, unknown>): number {
  const capacity = Number(settings.capacity);
  return Number.isFinite(capacity) && capacity >= 1
    ? Math.min(QUEUE_HARD_LIMIT, Math.floor(capacity))
    : QUEUE_HARD_LIMIT;
}

export type QueueAddRefusal = "duplicate" | "full";

/** What to tell someone about each refusal. Kept beside `queueAddRefusal` so the two cannot drift apart. */
export const QUEUE_REFUSAL_MESSAGES: Record<QueueAddRefusal, string> = {
  duplicate: "Already in line.",
  full: "The queue is full.",
};

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
