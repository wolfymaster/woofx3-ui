import { api } from "@convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useInstance } from "@/hooks/use-instance";
import { useResourceAction } from "@/hooks/use-resource-action";
import { useTimerState } from "@/hooks/use-timer-state";
import type { DashboardWidgetProps } from "@/lib/dashboard-widgets/types";
import { type ResourceInstanceDoc, resourceName, resourceSettings } from "@/lib/resource-instance";
import {
  formatDuration,
  parseDuration,
  TIMER_QUICK_ADJUSTMENTS,
  timerProgressPercent,
  timerStatus,
} from "@/lib/resource-values";

const TIMER_KIND = "timer";

const TIMERS_PATH = "/stream/timers";

/** Which timer the widget is showing, read out of its persisted config. */
function configuredCanonicalId(config: Record<string, unknown> | undefined): string | null {
  const canonicalId = config?.canonicalId;
  return typeof canonicalId === "string" && canonicalId !== "" ? canonicalId : null;
}

/**
 * One timer's countdown, with the same start, pause and add time the Timers
 * page offers.
 *
 * Every control goes through the timer's own engine actions
 * (`useResourceAction`), never a write to the mirrored value, so a change made
 * here is the same change a chat command or a workflow would make, and it comes
 * back through the engine's change event.
 */
export function TimerWidget({ config, onConfigChange }: DashboardWidgetProps) {
  const { instance } = useInstance();
  const instanceId = instance?._id;

  const kindDefinition = useQuery(
    api.resourceKinds.getForInstance,
    instanceId ? { instanceId, kind: TIMER_KIND } : "skip"
  );
  const timers = useQuery(
    api.moduleResourceInstances.listByKind,
    instanceId ? { instanceId, kind: TIMER_KIND } : "skip"
  );
  const values = useQuery(api.resourceValues.listForInstance, instanceId ? { instanceId } : "skip");
  const refreshValues = useAction(api.moduleResourceActions.refreshResourceValues);

  // Values arrive by webhook while the dashboard is open; this fills in any
  // written before it was, or while a webhook went missing.
  useEffect(() => {
    if (!instanceId) {
      return;
    }
    refreshValues({ instanceId, kind: TIMER_KIND }).catch(() => {
      // The mirror still shows the last known value; the next change updates it.
    });
  }, [instanceId, refreshValues]);

  if (!instanceId || timers === undefined) {
    return <WidgetMessage>Loading…</WidgetMessage>;
  }

  if (timers.length === 0) {
    return (
      <WidgetMessage>
        No timers yet.{" "}
        <Link href={TIMERS_PATH} className="underline hover:text-foreground">
          Make one
        </Link>{" "}
        and it can show here.
      </WidgetMessage>
    );
  }

  const sorted = [...timers].sort((a, b) => resourceName(a).localeCompare(resourceName(b)));
  // An unset config, or one naming a timer since deleted, falls back to the
  // first rather than showing an empty frame: picking one is what writes the config.
  const selected = sorted.find((row) => row.canonicalId === configuredCanonicalId(config)) ?? sorted[0];

  return (
    <div className="flex flex-col h-full">
      <TimerHeader
        timers={sorted}
        selected={selected}
        onSelect={(canonicalId) => onConfigChange?.({ ...config, canonicalId })}
      />
      {/* Keyed so switching timer resets the draft input and any in-flight disable. */}
      <TimerBody
        key={selected.canonicalId}
        timer={selected}
        moduleName={kindDefinition?.moduleName ?? selected.moduleName}
        value={values?.[selected.canonicalId] ?? null}
      />
    </div>
  );
}

function WidgetMessage({ children }: { children: ReactNode }) {
  return (
    <div className="h-full flex items-center justify-center p-3 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function TimerHeader({
  timers,
  selected,
  onSelect,
}: {
  timers: ResourceInstanceDoc[];
  selected: ResourceInstanceDoc;
  onSelect: (canonicalId: string) => void;
}) {
  if (timers.length === 1) {
    return (
      <div className="flex items-center px-3 py-2 border-b border-border shrink-0">
        <Link
          href={`${TIMERS_PATH}/${selected.resourceInstanceId}`}
          className="text-sm font-medium truncate hover:underline"
          data-testid="link-timer-widget-name"
        >
          {resourceName(selected)}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center px-2 py-1.5 border-b border-border shrink-0">
      <Select value={selected.canonicalId} onValueChange={onSelect}>
        <SelectTrigger className="h-7 border-0 bg-transparent px-1 text-sm font-medium shadow-none focus:ring-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {timers.map((row) => (
            <SelectItem key={row.canonicalId} value={row.canonicalId}>
              {resourceName(row)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function TimerBody({ timer, moduleName, value }: { timer: ResourceInstanceDoc; moduleName: string; value: unknown }) {
  const { run, pending } = useResourceAction({ instance: timer, moduleName });
  const settings = resourceSettings(timer);
  const state = useTimerState(value, settings);
  const [setTo, setSetTo] = useState("");

  const status = timerStatus(state);
  const setSeconds = parseDuration(setTo);
  const busy = pending !== null;

  return (
    // The clock sizes against the zone's width, not the viewport, since zones can be narrow on a wide screen.
    <div className="flex flex-1 min-h-0 flex-col gap-3 overflow-y-auto p-3 [container-type:inline-size]">
      <div className="space-y-1.5 text-center">
        <span
          className="block font-semibold leading-none tabular-nums text-[length:clamp(1.75rem,18cqi,3.75rem)]"
          data-testid="text-timer-widget-remaining"
        >
          {formatDuration(state.remainingMs)}
        </span>
        <span
          className="block text-[10px] uppercase tracking-wider text-muted-foreground"
          data-testid="text-timer-widget-status"
        >
          {status}
        </span>
        <Progress value={timerProgressPercent(state.remainingMs, settings)} className="h-1" aria-label="Time left" />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {status === "Running" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void run("timer.pause")}
            data-testid="button-timer-widget-pause"
          >
            <Pause className="h-3.5 w-3.5 mr-1.5" />
            Pause
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void run("timer.start")}
            data-testid="button-timer-widget-start"
          >
            <Play className="h-3.5 w-3.5 mr-1.5" />
            {state.remainingMs > 0 ? "Start" : "Restart"}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void run("timer.reset")}
          data-testid="button-timer-widget-reset"
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
          Reset
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-1">
        {TIMER_QUICK_ADJUSTMENTS.map((seconds) => (
          <Button
            key={seconds}
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs tabular-nums"
            disabled={busy}
            onClick={() => void run("timer.add", { seconds })}
            data-testid={`button-timer-widget-add-${seconds}`}
          >
            {seconds < 0 ? "−" : "+"}
            {formatDuration(Math.abs(seconds) * 1000)}
          </Button>
        ))}
      </div>

      <form
        className="flex items-center gap-1.5"
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
          aria-label="Set the timer to"
          aria-invalid={setTo.trim() !== "" && setSeconds === null}
          className="h-8 min-w-0 text-sm"
          data-testid="input-timer-widget-set"
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="h-8 shrink-0"
          disabled={setSeconds === null || busy}
          data-testid="button-timer-widget-set"
        >
          Set
        </Button>
      </form>
    </div>
  );
}
