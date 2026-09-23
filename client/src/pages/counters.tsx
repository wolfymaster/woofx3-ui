import { Check, Circle, Minus, Plus, RotateCcw, Tally5 } from "lucide-react";
import { useState } from "react";
import { type ResourceDetailProps, ResourceKindPage } from "@/components/resources/resource-kind-page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useResourceAction } from "@/hooks/use-resource-action";
import { type CounterGoal, counterGoals, counterValue, goalProgress } from "@/lib/resource-values";
import { cn } from "@/lib/utils";

const BASE_PATH = "/stream/counters";

/** The event a counter fires on reaching one of its goals; must match `goal_reached` in the woofx3 module. */
const GOAL_REACHED_EVENT = "goal.reached";

export default function Counters() {
  return (
    <ResourceKindPage
      kind="counter"
      title="Counters"
      description="Numbers your stream keeps: deaths, wins, hugs given. Change them here, from a chat command, or from any workflow."
      icon={Tally5}
      basePath={BASE_PATH}
      railValue={(props) => formatCount(counterValue(props.value, props.settings))}
      detail={(props) => <CounterPanel {...props} />}
      triggerDetail={(preset, props) => (preset.event === GOAL_REACHED_EVENT ? <CounterGoals {...props} /> : null)}
    />
  );
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

/** The counter's number and what can be done to it, through the counter's own actions. */
function CounterPanel(props: ResourceDetailProps) {
  const { instance, settings } = props;
  const { run, pending } = useResourceAction(props);
  const [setTo, setSetTo] = useState("");

  const step = Number(settings.step) || 1;

  const setValue = Number(setTo);
  const canSet = setTo.trim() !== "" && Number.isFinite(setValue);

  return (
    <Card className="p-6 space-y-6">
      <div className="flex items-center justify-center gap-6">
        <Button
          variant="outline"
          size="icon"
          className="h-12 w-12 rounded-full"
          disabled={pending !== null}
          onClick={() => void run("counter.decrement")}
          aria-label={`Take ${step} away`}
          data-testid="button-counter-decrement"
        >
          <Minus className="h-5 w-5" />
        </Button>
        <span className="min-w-[4ch] text-center text-6xl font-semibold tabular-nums" data-testid="text-counter-value">
          {formatCount(counterValue(props.value, props.settings))}
        </span>
        <Button
          size="icon"
          className="h-12 w-12 rounded-full"
          disabled={pending !== null}
          onClick={() => void run("counter.increment")}
          aria-label={`Add ${step}`}
          data-testid="button-counter-increment"
        >
          <Plus className="h-5 w-5" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSet) {
              void run("counter.set", { value: setValue }).then((sent) => {
                if (sent) {
                  setSetTo("");
                }
              });
            }
          }}
        >
          <Input
            type="number"
            value={setTo}
            onChange={(e) => setSetTo(e.target.value)}
            placeholder="Set to…"
            className="w-28"
            data-testid="input-counter-set"
          />
          <Button type="submit" variant="outline" disabled={!canSet || pending !== null}>
            Set
          </Button>
        </form>
        <Button
          variant="ghost"
          disabled={pending !== null}
          onClick={() => void run("counter.reset")}
          data-testid="button-counter-reset"
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          Reset
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        To change it from chat or a workflow, add the Increment counter action and choose {instance.displayName}.
      </p>
    </Card>
  );
}

/**
 * The counter's progress toward the goals its goal triggers fire on, beside
 * those triggers: a bar from where it starts to its largest goal with a mark at
 * each, then each goal by name, reached or how far off. Goals are set in the
 * counter's settings.
 */
function CounterGoals(props: ResourceDetailProps) {
  const goals = counterGoals(props.value, props.settings);

  if (goals.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="text-counter-no-goals">
        No goals yet. Add them under Goals in Settings below.
      </p>
    );
  }

  const value = counterValue(props.value, props.settings);
  const start = counterValue(null, props.settings);
  const progress = goalProgress(value, start, goals);

  return (
    <div className="space-y-4" data-testid="counter-goal-progress">
      <div
        className="relative h-3 rounded-full bg-muted"
        role="progressbar"
        aria-label={progress.next ? `Progress toward ${goalLabel(progress.next)}` : "Every goal reached"}
        aria-valuemin={Math.min(start, goals[0].goal)}
        aria-valuemax={goals[goals.length - 1].goal}
        aria-valuenow={value}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width]"
          style={{ width: `${progress.fraction * 100}%` }}
        />
        {goals.map((goal, i) => (
          <span
            key={goal.goal}
            className={cn(
              "absolute top-1/2 h-5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
              goal.reachedAt === null ? "bg-muted-foreground/60" : "bg-primary-foreground"
            )}
            style={{ left: `${progress.marks[i] * 100}%` }}
            aria-hidden
          />
        ))}
      </div>

      <ul className="space-y-1.5" aria-label="Goals" data-testid="list-counter-goals">
        {goals.map((goal) => (
          <li
            key={goal.goal}
            className={cn("flex items-center gap-2 text-sm", goal === progress.next && "font-medium")}
            data-testid={`goal-${goal.goal}`}
          >
            {goal.reachedAt !== null ? (
              <Check className="h-4 w-4 shrink-0 text-primary" aria-label="Reached" />
            ) : (
              <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Not reached" />
            )}
            <span className="tabular-nums">{formatCount(goal.goal)}</span>
            {goal.name !== "" && <span className="truncate">{goal.name}</span>}
            <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
              {goal.reachedAt !== null
                ? `Reached ${new Date(goal.reachedAt).toLocaleDateString()}`
                : goal.goal > value
                  ? `${formatCount(goal.goal - value)} to go`
                  : "Already past"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function goalLabel(goal: CounterGoal): string {
  return goal.name !== "" ? `${goal.name} (${formatCount(goal.goal)})` : formatCount(goal.goal);
}
