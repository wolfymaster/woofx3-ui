import { formatDuration, type TimerStatus, timerProgressPercent, timerState, timerStatus } from "@/lib/resource-values";
import { useCountdownNow } from "../clock";
import type { WidgetOf } from "./types";
import { WidgetLabel } from "./widget-label";

/** When a running timer ends, from its public value; null when it is not running. */
export function runningEndsAt(value: unknown): number | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const stored = value as Record<string, unknown>;
  const endsAt = Number(stored.endsAt);
  return stored.running === true && Number.isFinite(endsAt) ? endsAt : null;
}

const STATUS_LABELS: Record<TimerStatus, string> = {
  Running: "Counting down",
  Paused: "Paused",
  Finished: "Time's up",
};

export function TimerWidget({ widget }: { widget: WidgetOf<"timer"> }) {
  const value = widget.state?.value ?? null;
  const now = useCountdownNow(runningEndsAt(value));
  const label = widget.config.label ?? "Timer";
  if (widget.state === null) {
    return (
      <div>
        <WidgetLabel>{label}</WidgetLabel>
        <p className="mt-1 text-5xl font-bold tabular-nums tracking-tight text-muted">–:––</p>
        <p className="mt-2 text-sm text-muted">Not started yet.</p>
      </div>
    );
  }
  const state = timerState(value, widget.state.settings, now);
  const status = timerStatus(state);
  const percent = timerProgressPercent(state.remainingMs, widget.state.settings);
  return (
    <div>
      <WidgetLabel>{label}</WidgetLabel>
      <p className="mt-1 text-5xl font-bold tabular-nums tracking-tight">
        <time dateTime={`PT${Math.ceil(state.remainingMs / 1000)}S`}>{formatDuration(state.remainingMs)}</time>
      </p>
      <div className="mt-4 h-1.5 rounded-full bg-line" aria-hidden="true">
        <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-2 text-sm text-muted">{STATUS_LABELS[status]}</p>
    </div>
  );
}
