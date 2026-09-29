import type { AggregationConfig, WaitConfig as EngineWaitConfig } from "@woofx3/api";

/** A wait that pauses for an event (or an aggregation over events), optionally with a timeout. */
export type EventWaitConfig = Extract<EngineWaitConfig, { type: "event" | "aggregation" }>;

/**
 * A wait that pauses for a fixed time, then continues. Must match DelayWaitConfig in
 * shared/clients/typescript/api/workflow-definition.ts of the engine. Declared here so the
 * editor compiles against an engine checkout whose WaitConfig has no delay member yet.
 */
export interface DelayWaitConfig {
  type: "delay";
  durationMs: number;
}

export type WaitConfig = EventWaitConfig | DelayWaitConfig;
export type WaitType = WaitConfig["type"];

/** Inclusive bounds of `durationMs`. Must match WAIT_DELAY_MIN_MS / WAIT_DELAY_MAX_MS in the engine. */
export const WAIT_DELAY_MIN_MS = 1;
export const WAIT_DELAY_MAX_MS = 24 * 60 * 60 * 1000;

/** The engine refuses a wait timeout shorter than this. */
export const WAIT_TIMEOUT_MIN_MS = 1000;

export const DEFAULT_DELAY_MS = 5000;
/** Offered when a creator turns a timeout on; an event wait without one waits indefinitely. */
export const DEFAULT_TIMEOUT = "5m";
export const DEFAULT_ON_TIMEOUT = "fail";
export const DEFAULT_AGGREGATION: AggregationConfig = { strategy: "count", threshold: 1 };

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

export function isDelayWait(wait: WaitConfig): wait is DelayWaitConfig {
  return wait.type === "delay";
}

/**
 * Converts a wait to another type. A delay carries none of an event wait's fields, and an
 * event wait needs `event`, so crossing that line starts the new shape fresh. Switching
 * between event and aggregation keeps the event, timeout and conditions already set.
 */
export function switchWaitType(wait: WaitConfig, type: WaitType): WaitConfig {
  if (wait.type === type) {
    return wait;
  }
  if (type === "delay") {
    return { type: "delay", durationMs: DEFAULT_DELAY_MS };
  }
  if (isDelayWait(wait)) {
    return type === "aggregation" ? { type, event: "", aggregation: DEFAULT_AGGREGATION } : { type, event: "" };
  }
  return {
    ...wait,
    type,
    aggregation: type === "aggregation" ? (wait.aggregation ?? DEFAULT_AGGREGATION) : wait.aggregation,
  };
}

/** Turns an event wait's timeout on (with DEFAULT_TIMEOUT) or off; off also drops `onTimeout`. */
export function setWaitTimeoutEnabled(wait: EventWaitConfig, enabled: boolean): EventWaitConfig {
  const { timeout, onTimeout, ...rest } = wait;
  if (!enabled) {
    return rest;
  }
  return { ...rest, timeout: timeout ?? DEFAULT_TIMEOUT, ...(onTimeout ? { onTimeout } : {}) };
}

function durationParts(durationMs: number): string[] {
  if (durationMs < MS_PER_SECOND) {
    return [`${durationMs}ms`];
  }
  const hours = Math.floor(durationMs / MS_PER_HOUR);
  const minutes = Math.floor((durationMs % MS_PER_HOUR) / MS_PER_MINUTE);
  const seconds = (durationMs % MS_PER_MINUTE) / MS_PER_SECOND;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (seconds > 0) {
    parts.push(`${Number(seconds.toFixed(3))}s`);
  }
  return parts;
}

/** Compact, readable duration such as "10s", "2m 30s", "1h 5m" or "500ms". */
export function formatDelay(durationMs: number): string {
  return durationParts(durationMs).join(" ");
}

/** A Go duration string (time.ParseDuration), e.g. "30s", "2m30s", "1h5m". */
export function formatGoDuration(durationMs: number): string {
  return durationParts(durationMs).join("");
}

const GO_UNIT_MS: Record<string, number> = {
  ns: 1e-6,
  us: 1e-3,
  µs: 1e-3,
  ms: 1,
  s: MS_PER_SECOND,
  m: MS_PER_MINUTE,
  h: MS_PER_HOUR,
};

/**
 * Milliseconds of a Go duration string such as "1h30m" or "1.5s", or null when it is not
 * one. Signed durations are refused because a wait timeout must be positive.
 */
export function parseGoDuration(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }
  const segment = String.raw`(\d+(?:\.\d*)?|\.\d+)(ns|us|\u00b5s|ms|s|m|h)`;
  if (!new RegExp(`^(?:${segment})+$`, "u").test(trimmed)) {
    return null;
  }
  let totalMs = 0;
  for (const match of Array.from(trimmed.matchAll(new RegExp(segment, "gu")))) {
    totalMs += Number(match[1]) * GO_UNIT_MS[match[2]];
  }
  return Math.round(totalMs);
}

export type DurationUnit = "seconds" | "minutes" | "hours";

const UNIT_MS: Record<DurationUnit, number> = { seconds: MS_PER_SECOND, minutes: MS_PER_MINUTE, hours: MS_PER_HOUR };

/** The largest of `units` that `durationMs` is a whole number of, falling back to the smallest. */
export function pickDurationUnit(durationMs: number, units: readonly DurationUnit[]): DurationUnit {
  const largestFirst = [...units].sort((a, b) => UNIT_MS[b] - UNIT_MS[a]);
  for (const unit of largestFirst) {
    if (durationMs >= UNIT_MS[unit] && durationMs % UNIT_MS[unit] === 0) {
      return unit;
    }
  }
  return largestFirst[largestFirst.length - 1];
}

/** The amount to show for `durationMs` in `unit`, e.g. 90000 ms in minutes is 1.5. */
export function durationAmount(durationMs: number, unit: DurationUnit): number {
  return Number((durationMs / UNIT_MS[unit]).toFixed(3));
}

export interface DurationBounds {
  minMs: number;
  minMessage: string;
  maxMs?: number;
  maxMessage?: string;
}

export const DELAY_BOUNDS: DurationBounds = {
  minMs: WAIT_DELAY_MIN_MS,
  minMessage: "Must be longer than 0.",
  maxMs: WAIT_DELAY_MAX_MS,
  maxMessage: "Must be 24 hours or less.",
};

export const TIMEOUT_BOUNDS: DurationBounds = {
  minMs: WAIT_TIMEOUT_MIN_MS,
  minMessage: "Must be at least 1 second.",
};

export type DurationParseResult = { ok: true; durationMs: number } | { ok: false; message: string };

/** Parses an amount typed in `unit` into whole milliseconds within `bounds`. */
export function parseDurationInput(text: string, unit: DurationUnit, bounds: DurationBounds): DurationParseResult {
  const trimmed = text.trim();
  if (trimmed === "") {
    return { ok: false, message: "Enter a duration." };
  }
  const amount = Number(trimmed);
  if (!Number.isFinite(amount)) {
    return { ok: false, message: "Enter a number." };
  }
  const durationMs = Math.round(amount * UNIT_MS[unit]);
  if (durationMs < bounds.minMs) {
    return { ok: false, message: bounds.minMessage };
  }
  if (bounds.maxMs !== undefined && durationMs > bounds.maxMs) {
    return { ok: false, message: bounds.maxMessage ?? "Too long." };
  }
  return { ok: true, durationMs };
}

/** How an event wait ends if its event never arrives. */
export function describeWaitTimeout(wait: EventWaitConfig): string {
  if (!wait.timeout) {
    return "No timeout, waits until the event arrives";
  }
  const timeoutMs = parseGoDuration(String(wait.timeout));
  const after = timeoutMs === null ? String(wait.timeout) : formatDelay(timeoutMs);
  const onTimeout = wait.onTimeout ?? DEFAULT_ON_TIMEOUT;
  return `Gives up after ${after}, then ${onTimeout === "fail" ? "fails the workflow" : "continues"}`;
}

/** Title of a wait step card, shown after the "Wait" kind prefix. */
export function waitNodeLabel(wait: WaitConfig): string {
  if (isDelayWait(wait)) {
    return formatDelay(wait.durationMs);
  }
  const event = wait.event || "an event";
  if (wait.type === "event") {
    return `Until ${event}`;
  }
  const threshold = wait.aggregation?.threshold ?? DEFAULT_AGGREGATION.threshold;
  switch (wait.aggregation?.strategy ?? DEFAULT_AGGREGATION.strategy) {
    case "count": {
      return `Until ${event} ×${threshold}`;
    }
    case "sum": {
      return `Until ${event} totals ${threshold}`;
    }
    case "threshold": {
      return `Until ${event} reaches ${threshold}`;
    }
  }
}
