import type { AggregationConfig, WaitConfig as EngineWaitConfig } from "@woofx3/api";

/** A wait that pauses for an event (or an aggregation over events), with a timeout. */
export type EventWaitConfig = Extract<EngineWaitConfig, { type: "event" | "aggregation" }>;

/**
 * A wait that pauses for a fixed time, then continues. Must match DelayWaitConfig in
 * shared/clients/typescript/api/workflow-definition.ts of the engine, which refuses a delay
 * that carries event, conditions, aggregation, timeout or onTimeout. Declared here so the
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

export const DEFAULT_DELAY_MS = 5000;
export const DEFAULT_AGGREGATION: AggregationConfig = { strategy: "count", threshold: 1 };

/** What the engine uses when an event wait has no `timeout` / `onTimeout`. */
export const DEFAULT_WAIT_TIMEOUT = "5m";
export const DEFAULT_ON_TIMEOUT = "fail";

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

export function isDelayWait(wait: WaitConfig): wait is DelayWaitConfig {
  return wait.type === "delay";
}

/**
 * Converts a wait to another type. A delay carries none of an event wait's fields, and an
 * event wait needs `event`, so crossing that line starts the new shape fresh instead of
 * leaving fields the engine refuses. Switching between event and aggregation keeps the event,
 * timeout and conditions the creator already set.
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

/** Compact duration such as "10s", "2m 30s", "1h 5m" or "500ms". */
export function formatDelay(durationMs: number): string {
  if (durationMs < MS_PER_SECOND) {
    return `${durationMs}ms`;
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
  return parts.join(" ");
}

export type DelayUnit = "seconds" | "minutes";

const UNIT_MS: Record<DelayUnit, number> = { seconds: MS_PER_SECOND, minutes: MS_PER_MINUTE };

/** Minutes when the duration is a whole number of them, otherwise seconds. */
export function pickDelayUnit(durationMs: number): DelayUnit {
  return durationMs >= MS_PER_MINUTE && durationMs % MS_PER_MINUTE === 0 ? "minutes" : "seconds";
}

/** The amount to show in the duration input for `durationMs` in `unit`, e.g. 90000 ms in minutes is 1.5. */
export function delayAmount(durationMs: number, unit: DelayUnit): number {
  return Number((durationMs / UNIT_MS[unit]).toFixed(3));
}

export type DelayParseResult = { ok: true; durationMs: number } | { ok: false; message: string };

/** Parses what the creator typed into the duration input, in `unit`, into whole milliseconds. */
export function parseDelayInput(text: string, unit: DelayUnit): DelayParseResult {
  const trimmed = text.trim();
  if (trimmed === "") {
    return { ok: false, message: "Enter how long to wait." };
  }
  const amount = Number(trimmed);
  if (!Number.isFinite(amount)) {
    return { ok: false, message: "Enter a number." };
  }
  const durationMs = Math.round(amount * UNIT_MS[unit]);
  if (durationMs < WAIT_DELAY_MIN_MS) {
    return { ok: false, message: "Must be longer than 0." };
  }
  if (durationMs > WAIT_DELAY_MAX_MS) {
    return { ok: false, message: "Must be 24 hours or less." };
  }
  return { ok: true, durationMs };
}

/** How an event wait gives up, spelled out with the engine's defaults filled in. */
export function describeWaitTimeout(wait: EventWaitConfig): string {
  const timeout = wait.timeout ? String(wait.timeout) : `${DEFAULT_WAIT_TIMEOUT} (default)`;
  const onTimeout = wait.onTimeout ?? DEFAULT_ON_TIMEOUT;
  return `Gives up after ${timeout}, then ${onTimeout === "fail" ? "fails the workflow" : "continues"}`;
}
