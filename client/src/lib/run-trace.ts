import { isFailureStatus } from "./alert-status";
import { parseEngineTime, type Timeline, type Tone } from "./workflow-run-timeline";

/**
 * One run laid out on a time axis, the way a tracing tool draws a request: the event
 * that started it, the run, each step, and the overlay alerts the run published.
 *
 * Offsets are milliseconds from the earliest known moment, so the view only scales
 * them. Anything without usable timing still gets a row -- a step the engine never
 * timed still happened, and hiding it would misstate what the run did.
 */

export type SpanKind = "trigger" | "run" | "step" | "alert";

/** A moment inside a span worth pointing at, such as when an alert began to play. */
export interface SpanMark {
  atMs: number;
  label: string;
}

export interface TraceSpan {
  /** Stable across re-renders, so a selection survives live updates. */
  id: string;
  kind: SpanKind;
  label: string;
  /** Secondary text for the row, such as the attempt or the task id. */
  detail?: string;
  status: string;
  tone: Tone;
  /** Indent level: the run and its trigger at 0, what the run did at 1. */
  depth: number;
  /** Offset from the trace origin, or null when this span was never timed. */
  startMs: number | null;
  /** Offset from the trace origin. Null with a start is a point in time, or a span still open. */
  endMs: number | null;
  /** Still in progress: drawn to the end of the axis rather than as a point. */
  open: boolean;
  marks: SpanMark[];
}

/** The fields of an `engineAlerts` row the trace reads. */
export interface RunAlertRecord {
  engineAlertId: string;
  status: string;
  payload: string;
  error?: string;
  dispatchedAt?: string;
  playedAt?: string;
  completedAt?: string;
  engineCreatedAt: string;
}

export interface Trace {
  /** Epoch milliseconds of offset 0, or null when nothing in the run was timed. */
  originMs: number | null;
  /** Length of the axis in milliseconds; at least 1, so a scale never divides by zero. */
  spanMs: number;
  spans: TraceSpan[];
  /** Offsets to draw grid lines and labels at, starting from 0. */
  ticks: number[];
}

/**
 * How far a trigger's own timestamp may sit from the run and still share its axis.
 *
 * The event's time comes from the platform's clock, not the engine's. A small gap
 * is real ingest latency and worth seeing; a large one is clock skew or a replayed
 * event, and plotting it would squash the run into a sliver at one end.
 */
const TRIGGER_WINDOW_MS = 60_000;

const TARGET_TICK_COUNT = 5;

/** Map an alert's lifecycle status to how its span should look. */
export function alertTone(status: string): Tone {
  if (isFailureStatus(status)) {
    return "failure";
  }
  switch (status) {
    case "completed":
    case "replayed":
      return "success";
    case "sent":
    case "pending":
    case "dispatched":
    case "playing":
      return "running";
    default:
      return "neutral";
  }
}

interface RawSpan extends Omit<TraceSpan, "startMs" | "endMs" | "marks"> {
  start?: number;
  end?: number;
  marks: { at: number; label: string }[];
}

/** Assemble the trace for one run from its timeline and the alerts it published. */
export function buildTrace(
  run: { engineRunId: string; status: string; startedAt?: string; completedAt?: string },
  timeline: Timeline,
  alerts: readonly RunAlertRecord[]
): Trace {
  const runStart = parseEngineTime(run.startedAt);
  const runEnd = parseEngineTime(run.completedAt);
  const raw: RawSpan[] = [];

  if (timeline.trigger) {
    const occurred = parseEngineTime(timeline.trigger.occurredAt);
    const plottable =
      occurred !== undefined && (runStart === undefined || Math.abs(runStart - occurred) <= TRIGGER_WINDOW_MS);
    raw.push({
      id: "trigger",
      kind: "trigger",
      label: timeline.trigger.type,
      detail: timeline.trigger.platform ?? timeline.trigger.source,
      status: "received",
      tone: "neutral",
      depth: 0,
      open: false,
      start: plottable ? occurred : undefined,
      marks: [],
    });
  }

  raw.push({
    id: "run",
    kind: "run",
    label: "Run",
    status: run.status,
    tone: timeline.tone,
    depth: 0,
    open: timeline.tone === "running" && runEnd === undefined,
    start: runStart,
    end: runEnd,
    marks: [],
  });

  for (const step of timeline.steps) {
    let start = parseEngineTime(step.startedAt);
    const end = parseEngineTime(step.completedAt);
    if (start === undefined && end !== undefined && step.durationMs !== undefined) {
      start = end - step.durationMs;
    }
    raw.push({
      id: `step:${step.key}`,
      kind: "step",
      label: step.label,
      detail: step.attempt > 1 ? `attempt ${step.attempt}` : undefined,
      status: step.status,
      tone: step.tone,
      depth: 1,
      open: step.tone === "running" && end === undefined,
      start,
      end: end ?? (start !== undefined && step.durationMs !== undefined ? start + step.durationMs : undefined),
      marks: [],
    });
  }

  for (const alert of alerts) {
    const tone = alertTone(alert.status);
    const start = parseEngineTime(alert.dispatchedAt) ?? parseEngineTime(alert.engineCreatedAt);
    const played = parseEngineTime(alert.playedAt);
    raw.push({
      id: `alert:${alert.engineAlertId}`,
      kind: "alert",
      label: "Overlay alert",
      status: alert.status,
      tone,
      depth: 1,
      open: tone === "running",
      start,
      end: parseEngineTime(alert.completedAt),
      marks: played !== undefined ? [{ at: played, label: "Started playing" }] : [],
    });
  }

  const known = raw.flatMap((span) => [span.start, span.end, ...span.marks.map((mark) => mark.at)]);
  const times = known.filter((time): time is number => time !== undefined);
  if (times.length === 0) {
    return {
      originMs: null,
      spanMs: 1,
      spans: raw.map(({ start: _start, end: _end, ...span }) => ({ ...span, startMs: null, endMs: null, marks: [] })),
      ticks: [0],
    };
  }

  const origin = Math.min(...times);
  const spanMs = Math.max(1, Math.max(...times) - origin);
  const spans = raw.map(({ start, end, marks, ...span }) => ({
    ...span,
    startMs: start === undefined ? null : start - origin,
    endMs: start === undefined || end === undefined || end < start ? null : end - origin,
    marks: marks.map((mark) => ({ atMs: mark.at - origin, label: mark.label })),
  }));

  return { originMs: origin, spanMs, spans, ticks: axisTicks(spanMs) };
}

/**
 * Grid positions for an axis of this length, on round numbers -- 0, 50, 100ms
 * rather than 0, 47, 94 -- so the labels can be read without arithmetic.
 */
export function axisTicks(spanMs: number): number[] {
  if (spanMs <= 0) {
    return [0];
  }
  const rough = spanMs / TARGET_TICK_COUNT;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough) ?? rough;
  const ticks: number[] = [];
  for (let at = 0; at <= spanMs + step * 1e-9; at += step) {
    ticks.push(Math.round(at * 1000) / 1000);
  }
  return ticks;
}

/**
 * The span to open with: whatever broke the run, else the event that started it,
 * so the details show the thing most worth reading before any click.
 */
export function initialSpanId(trace: Trace): string | null {
  const failures = trace.spans.filter((span) => span.tone === "failure" && span.kind !== "run");
  const lastFailure = failures[failures.length - 1];
  if (lastFailure) {
    return lastFailure.id;
  }
  return trace.spans[0]?.id ?? null;
}
