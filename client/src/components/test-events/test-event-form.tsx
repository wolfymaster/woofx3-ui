import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { AlertCircle, CheckCircle2, Loader2, Zap } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useFireTestEvent } from "@/hooks/use-fire-test-event";
import { useInstance } from "@/hooks/use-instance";
import { describeTestEventOutcome, type RunRecord } from "@/lib/test-event-outcome";
import type { TriggerPreset } from "@/lib/workflow-presets";

/** Props every test-event form takes. */
export interface TestEventProps {
  preset: TriggerPreset;
}

interface TestEventFormProps extends TestEventProps {
  /** The event data the fields describe, or null while they don't describe a valid one. */
  payload: object | null;
  children: ReactNode;
}

/**
 * How long to wait before reporting that no workflow matched.
 *
 * This only has to cover one round trip — bus, engine, webhook, Convex —
 * because the engine announces a run the moment it starts. Silence past that
 * really does mean nothing was listening, which is why the copy can say so
 * rather than hedging.
 */
const OUTCOME_TIMEOUT_MS = 8000;

function TestEventOutcome({ record, waitElapsed }: { record: RunRecord | null | undefined; waitElapsed: boolean }) {
  const outcome = describeTestEventOutcome(record, waitElapsed);

  switch (outcome.kind) {
    case "waiting":
      return (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
          Waiting to hear what the event did…
        </p>
      );
    case "running":
      return (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="test-event-outcome-running">
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />A workflow picked it up and is running…
        </p>
      );
    case "succeeded":
      return (
        <p className="flex items-center gap-2 text-xs text-green-500" data-testid="test-event-outcome-succeeded">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          The workflow completed.
        </p>
      );
    case "nothingMatched":
      return (
        <p className="text-xs text-muted-foreground" data-testid="test-event-outcome-nothing">
          Published, but no workflow picked it up. Check that a workflow is enabled for this event.
        </p>
      );
    default:
      return (
        <div className="flex items-start gap-2 text-xs" data-testid="test-event-outcome-failed">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-red-500" />
          <div className="min-w-0">
            <p className="font-medium text-red-500">{outcome.title}</p>
            <p className="text-muted-foreground mt-0.5">{outcome.detail}</p>
          </div>
        </div>
      );
  }
}

/**
 * One trigger's test settings and the button that fires it. The button sits below
 * the scrolling fields so it stays in reach however tall the form grows.
 *
 * Firing reports what the event actually caused, not that it was published: the
 * hook mints a correlation key, the engine echoes it onto the run lifecycle, and
 * the outcome arrives here as a transient record keyed by that same id.
 */
export function TestEventForm({ preset, payload, children }: TestEventFormProps) {
  const fire = useFireTestEvent();
  const { instance } = useInstance();
  const [busy, setBusy] = useState(false);
  const [triggerId, setTriggerId] = useState<string | null>(null);
  const [waitElapsed, setWaitElapsed] = useState(false);

  const record = useQuery(
    api.transientEvents.get,
    triggerId && instance ? { instanceId: instance._id, correlationKey: triggerId } : "skip"
  );

  useEffect(() => {
    if (!triggerId) {
      return;
    }
    setWaitElapsed(false);
    const timer = setTimeout(() => setWaitElapsed(true), OUTCOME_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [triggerId]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (payload === null) {
      return;
    }
    setBusy(true);
    // Cleared before firing so the previous run's outcome cannot be mistaken
    // for this one's while the new event is still in flight.
    setTriggerId(null);
    try {
      setTriggerId(await fire(preset, payload));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-1 min-h-0 flex-col" data-testid={`test-event-form-${preset.id}`}>
      <div className="flex-1 overflow-y-auto space-y-4">{children}</div>
      <div className="mt-4 pt-4 border-t shrink-0 space-y-3">
        <Button
          type="submit"
          disabled={busy || payload === null}
          className="w-full gap-2"
          data-testid="button-trigger-test-event"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          {busy ? "Triggering…" : "Trigger"}
        </Button>
        {triggerId && <TestEventOutcome record={record} waitElapsed={waitElapsed} />}
      </div>
    </form>
  );
}
