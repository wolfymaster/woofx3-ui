import { counterGoals, counterValue, goalProgress } from "@/lib/resource-values";
import type { WidgetOf } from "./types";
import { WidgetLabel } from "./widget-label";

export function CounterWidget({ widget }: { widget: WidgetOf<"counter"> }) {
  const label = widget.config.label ?? "Counter";
  if (widget.state === null) {
    return (
      <div>
        <WidgetLabel>{label}</WidgetLabel>
        <p className="mt-1 text-5xl font-bold tabular-nums tracking-tight text-muted">–</p>
        <p className="mt-2 text-sm text-muted">Nothing counted yet.</p>
      </div>
    );
  }
  const { value, settings } = widget.state;
  const count = counterValue(value, settings);
  const goals = widget.config.showGoals ? counterGoals(value, settings) : [];
  return (
    <div>
      <WidgetLabel>{label}</WidgetLabel>
      <p className="mt-1 text-5xl font-bold tabular-nums tracking-tight">{count.toLocaleString()}</p>
      {goals.length > 0 && <GoalBar count={count} start={counterValue(null, settings)} goals={goals} label={label} />}
    </div>
  );
}

function GoalBar({
  count,
  start,
  goals,
  label,
}: {
  count: number;
  start: number;
  goals: ReturnType<typeof counterGoals>;
  label: string;
}) {
  const progress = goalProgress(count, start, goals);
  const last = goals[goals.length - 1];
  return (
    <div className="mt-4">
      <div
        className="relative h-2.5 rounded-full bg-line"
        role="progressbar"
        aria-label={`${label} toward its goals`}
        aria-valuemin={0}
        aria-valuemax={last.goal}
        aria-valuenow={count}
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${progress.fraction * 100}%` }} />
        {progress.marks.map((mark, index) => (
          <span
            key={goals[index].goal}
            className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-ink/40"
            style={{ left: `${mark * 100}%` }}
          />
        ))}
      </div>
      <p className="mt-2 text-sm text-muted">
        {progress.next === null ? (
          "Every goal reached"
        ) : (
          <>
            Next goal <span className="font-semibold tabular-nums text-ink">{progress.next.goal.toLocaleString()}</span>
            {progress.next.name !== "" && <>: {progress.next.name}</>}
          </>
        )}
      </p>
    </div>
  );
}
