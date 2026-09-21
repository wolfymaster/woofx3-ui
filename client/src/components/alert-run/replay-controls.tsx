import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { AlertCircle, CheckCircle2, Loader2, RotateCcw, StepForward } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { describeTestEventOutcome } from "@/lib/test-event-outcome";

/**
 * How long to wait before reporting that the engine did not pick a replay up.
 *
 * The engine announces a replay the moment it starts and announces a refusal
 * immediately too, so silence past one round trip means the request never
 * reached it -- not a slow replay.
 */
const OUTCOME_TIMEOUT_MS = 8000;

type Mode = "run" | "resume";

interface ReplayControlsProps {
  instanceId: Id<"instances">;
  engineRunId: string;
  /** The step that ended the run, when it ended by failing. Offers resume from it. */
  failedStepTaskId: string | null;
}

/**
 * Replay a recorded run, whole or from the step that failed, and show how the
 * replay went.
 *
 * The outcome is shown here rather than as a new entry in the list because a
 * replay is a manual run, and manual runs are not recorded.
 */
export function ReplayControls({ instanceId, engineRunId, failedStepTaskId }: ReplayControlsProps) {
  const replay = useAction(api.workflowActions.replay);
  const { toast } = useToast();
  const [busy, setBusy] = useState<Mode | null>(null);
  const [triggerId, setTriggerId] = useState<string | null>(null);
  const [waitElapsed, setWaitElapsed] = useState(false);

  const record = useQuery(api.transientEvents.get, triggerId ? { instanceId, correlationKey: triggerId } : "skip");

  // A different run was selected: the previous replay's outcome is not this run's.
  // biome-ignore lint/correctness/useExhaustiveDependencies: engineRunId is the trigger, not a value read inside
  useEffect(() => {
    setTriggerId(null);
  }, [engineRunId]);

  useEffect(() => {
    if (!triggerId) {
      return;
    }
    setWaitElapsed(false);
    const timer = setTimeout(() => setWaitElapsed(true), OUTCOME_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [triggerId]);

  const start = async (mode: Mode, fromTaskId?: string) => {
    setBusy(mode);
    // Cleared first so the previous replay's outcome cannot be read as this one's.
    setTriggerId(null);
    try {
      const result = await replay({ instanceId, engineRunId, fromTaskId });
      setTriggerId(result.triggerId);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Replay could not be started",
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  };

  const outcome = triggerId ? describeTestEventOutcome(record, waitElapsed) : null;

  return (
    <div className="space-y-2" data-testid="alert-run-replay">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={busy !== null}
          onClick={() => void start("run")}
          data-testid="button-replay-run"
        >
          {busy === "run" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          Replay run
        </Button>
        {failedStepTaskId && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={busy !== null}
            onClick={() => void start("resume", failedStepTaskId)}
            data-testid="button-replay-resume"
          >
            {busy === "resume" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <StepForward className="h-3.5 w-3.5" />
            )}
            Resume from {failedStepTaskId}
          </Button>
        )}
      </div>

      {outcome?.kind === "waiting" && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Waiting for the engine…
        </p>
      )}
      {outcome?.kind === "running" && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Replay running…
        </p>
      )}
      {outcome?.kind === "succeeded" && (
        <p className="flex items-center gap-2 text-xs text-green-500" data-testid="replay-outcome-succeeded">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Replay completed. Replays are not added to the history.
        </p>
      )}
      {outcome?.kind === "nothingMatched" && (
        <p className="text-xs text-muted-foreground" data-testid="replay-outcome-silent">
          The engine did not pick up the replay. Check that the workflow service is running.
        </p>
      )}
      {outcome?.kind === "failed" && (
        <div className="flex items-start gap-2 text-xs" data-testid="replay-outcome-failed">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
          <div className="min-w-0">
            <p className="font-medium text-red-500">{outcome.title}</p>
            <p className="mt-0.5 text-muted-foreground">{outcome.detail}</p>
          </div>
        </div>
      )}
    </div>
  );
}
