import { Pause, Play, RotateCcw, Timer } from "lucide-react";
import { useState } from "react";
import { type ResourceDetailProps, ResourceKindPage } from "@/components/resources/resource-kind-page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useResourceAction } from "@/hooks/use-resource-action";
import { useTimerState } from "@/hooks/use-timer-state";
import {
  formatDuration,
  parseDuration,
  TIMER_QUICK_ADJUSTMENTS,
  timerProgressPercent,
  timerStatus,
} from "@/lib/resource-values";

const BASE_PATH = "/stream/timers";

export default function Timers() {
  return (
    <ResourceKindPage
      kind="timer"
      title="Timers"
      description="Countdowns your stream shows: break timers, subathons, giveaways. Start, pause and add time here, from a chat command, or from any workflow."
      icon={Timer}
      basePath={BASE_PATH}
      railValue={(props) => <TimerClock {...props} />}
      detail={(props) => <TimerPanel {...props} />}
    />
  );
}

function TimerClock({ value, settings }: ResourceDetailProps) {
  return <>{formatDuration(useTimerState(value, settings).remainingMs)}</>;
}

/** The timer's time left and what can be done to it, through the timer's own actions. */
function TimerPanel(props: ResourceDetailProps) {
  const { instance, value, settings } = props;
  const { run, pending } = useResourceAction(props);
  const state = useTimerState(value, settings);
  const { remainingMs } = state;
  const [setTo, setSetTo] = useState("");

  const progress = timerProgressPercent(remainingMs, settings);
  const setSeconds = parseDuration(setTo);
  const status = timerStatus(state);
  const counting = status === "Running";

  return (
    <Card className="p-6 space-y-6">
      <div className="space-y-3 text-center">
        <span className="block text-6xl font-semibold tabular-nums" data-testid="text-timer-remaining">
          {formatDuration(remainingMs)}
        </span>
        <span className="block text-xs uppercase tracking-wider text-muted-foreground" data-testid="text-timer-status">
          {status}
        </span>
        <Progress value={progress} className="h-1.5" aria-label="Time left" />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {counting ? (
          <Button
            size="lg"
            variant="outline"
            disabled={pending !== null}
            onClick={() => void run("timer.pause")}
            data-testid="button-timer-pause"
          >
            <Pause className="h-4 w-4 mr-2" />
            Pause
          </Button>
        ) : (
          <Button
            size="lg"
            disabled={pending !== null}
            onClick={() => void run("timer.start")}
            data-testid="button-timer-start"
          >
            <Play className="h-4 w-4 mr-2" />
            {remainingMs > 0 ? "Start" : "Restart"}
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={pending !== null}
          onClick={() => void run("timer.reset")}
          data-testid="button-timer-reset"
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          Reset
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {TIMER_QUICK_ADJUSTMENTS.map((seconds) => (
          <Button
            key={seconds}
            variant="outline"
            size="sm"
            className="tabular-nums"
            disabled={pending !== null}
            onClick={() => void run("timer.add", { seconds })}
            data-testid={`button-timer-add-${seconds}`}
          >
            {seconds < 0 ? "−" : "+"}
            {formatDuration(Math.abs(seconds) * 1000)}
          </Button>
        ))}
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (setSeconds !== null) {
              void run("timer.set", { seconds: setSeconds }).then((sent) => {
                if (sent) {
                  setSetTo("");
                }
              });
            }
          }}
        >
          <Input
            value={setTo}
            onChange={(e) => setSetTo(e.target.value)}
            placeholder="Set to m:ss"
            className="w-32"
            aria-invalid={setTo.trim() !== "" && setSeconds === null}
            data-testid="input-timer-set"
          />
          <Button type="submit" variant="outline" size="sm" disabled={setSeconds === null || pending !== null}>
            Set
          </Button>
        </form>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        To control it from chat or a workflow, add the Start timer or Add time to timer action and choose{" "}
        {instance.displayName}.
      </p>
    </Card>
  );
}
