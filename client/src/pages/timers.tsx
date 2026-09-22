import { Pause, Play, RotateCcw, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { type ResourceDetailProps, ResourceKindPage } from "@/components/resources/resource-kind-page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useResourceAction } from "@/hooks/use-resource-action";
import { formatDuration, parseDuration, timerDurationMs, timerState } from "@/lib/resource-values";

const BASE_PATH = "/stream/timers";

/** Seconds each quick-adjust button adds; negative takes time away. */
const QUICK_ADJUSTMENTS = [-30, 30, 60, 300];

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

/**
 * The current time, refreshed several times a second while `ticking`. A
 * running timer is stored as the moment it ends, so showing it counting down
 * is the page's job; a stopped one needs no refresh.
 */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!ticking) {
      return;
    }
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [ticking]);
  return now;
}

function useTimer({ value, settings }: ResourceDetailProps) {
  // Whether a timer runs does not depend on the time, only how long it has left.
  const now = useNow(timerState(value, settings, 0).running);
  return timerState(value, settings, now);
}

function TimerClock(props: ResourceDetailProps) {
  return <>{formatDuration(useTimer(props).remainingMs)}</>;
}

/** The timer's time left and what can be done to it, through the timer's own actions. */
function TimerPanel(props: ResourceDetailProps) {
  const { instance, settings } = props;
  const { run, pending } = useResourceAction(props);
  const { running, remainingMs } = useTimer(props);
  const [setTo, setSetTo] = useState("");

  const durationMs = timerDurationMs(settings);
  const progress = durationMs > 0 ? Math.min(100, (remainingMs / durationMs) * 100) : 0;
  const setSeconds = parseDuration(setTo);
  const counting = running && remainingMs > 0;
  const status = counting ? "Running" : remainingMs > 0 ? "Paused" : "Finished";

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
        {QUICK_ADJUSTMENTS.map((seconds) => (
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
