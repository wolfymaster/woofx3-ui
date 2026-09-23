import { Check, Minus, Plus, RotateCcw, Tally5 } from "lucide-react";
import { useState } from "react";
import { type ResourceDetailProps, ResourceKindPage } from "@/components/resources/resource-kind-page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useResourceAction } from "@/hooks/use-resource-action";
import { counterGoals, counterValue } from "@/lib/resource-values";
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
 * The numbers the counter's goal triggers fire on, beside those triggers, and
 * which it has reached. Goals are set in the counter's settings.
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

  return (
    <ul className="flex flex-wrap gap-2" aria-label="Goals" data-testid="list-counter-goals">
      {goals.map(({ goal, reachedAt }) => (
        <li
          key={goal}
          title={reachedAt === null ? "Not reached yet" : `First reached ${new Date(reachedAt).toLocaleString()}`}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium tabular-nums",
            reachedAt === null ? "text-muted-foreground" : "border-primary/40 bg-primary/10 text-foreground"
          )}
          data-testid={`goal-${goal}`}
        >
          {reachedAt !== null && <Check className="h-3.5 w-3.5 text-primary" aria-label="Reached" />}
          {formatCount(goal)}
        </li>
      ))}
    </ul>
  );
}
