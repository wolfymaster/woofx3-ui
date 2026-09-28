import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { TEST_RUN_ORIGIN } from "@convex/lib/manualRunOrigin";
import { useAction, useQuery } from "convex/react";
import { AlertCircle, AlertTriangle, CheckCircle2, ExternalLink, Loader2, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { TONE_STYLE } from "@/components/alert-run/tone-style";
import { testEventFormFor } from "@/components/test-events/registry";
import { TEST_EVENT_OUTCOME_TIMEOUT_MS, type TestEventRunner } from "@/components/test-events/test-event-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFireTestEvent } from "@/hooks/use-fire-test-event";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { TriggerPreset } from "@/lib/workflow-presets";
import { workflowRunPath } from "@/lib/workflow-run-route";
import { buildTimeline, formatDuration } from "@/lib/workflow-run-timeline";
import { testRunProgress } from "@/lib/workflow-test-run";

/**
 * Two ways to start a test, because neither alone does everything.
 *
 * "event" publishes a sample of the trigger's event, so the workflow runs
 * exactly as it would live -- conditions evaluated, `trigger.data` filled --
 * but so does every other enabled workflow listening for that event. "direct"
 * starts this workflow alone, and the engine hands it no sample event to read.
 */
type TestMode = "event" | "direct";

interface TestRunSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  engineWorkflowId: string;
  workflowName: string;
  isEnabled: boolean;
  /** The sample-event form's trigger, firing this workflow's event; null when there is none to build. */
  preset: TriggerPreset | null;
  /** Other enabled workflows a sample event would also start. */
  otherWorkflows: string[];
}

/**
 * Try a workflow without waiting for the real thing to happen on stream.
 *
 * Non-modal and not dismissed by outside clicks, like the Alerts test sheet, so
 * the workflow stays in view while it runs. Test runs are recorded, so each one
 * lands in the workflow's Runs panel with a full trace.
 */
export function TestRunSheet({
  open,
  onOpenChange,
  engineWorkflowId,
  workflowName,
  isEnabled,
  preset,
  otherWorkflows,
}: TestRunSheetProps) {
  // Null until someone picks a tab, so the default follows the catalog loading
  // in: the sample event once the trigger's form can be built.
  const [pickedMode, setPickedMode] = useState<TestMode | null>(null);
  const activeMode: TestMode = preset ? (pickedMode ?? "event") : "direct";

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        className="w-full sm:max-w-md flex flex-col"
        onInteractOutside={(e) => e.preventDefault()}
        data-testid="workflow-test-run-sheet"
      >
        <SheetHeader>
          <SheetTitle>Test run</SheetTitle>
          <SheetDescription>
            Runs the saved version of {workflowName}. Save first if you want your latest edits included.
          </SheetDescription>
        </SheetHeader>

        {!isEnabled ? (
          <Alert data-testid="workflow-test-run-disabled">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>This workflow is disabled</AlertTitle>
            <AlertDescription>The engine only runs enabled workflows. Enable it to test it.</AlertDescription>
          </Alert>
        ) : (
          <>
            {preset && (
              <Tabs value={activeMode} onValueChange={(value) => setPickedMode(value as TestMode)}>
                <TabsList className="w-full">
                  <TabsTrigger value="event" className="flex-1" data-testid="tab-test-run-event">
                    Sample event
                  </TabsTrigger>
                  <TabsTrigger value="direct" className="flex-1" data-testid="tab-test-run-direct">
                    This workflow only
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            )}

            {activeMode === "event" && preset ? (
              <SampleEventTest engineWorkflowId={engineWorkflowId} preset={preset} otherWorkflows={otherWorkflows} />
            ) : (
              <DirectTest engineWorkflowId={engineWorkflowId} hasEventTrigger={preset !== null} />
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SampleEventTest({
  engineWorkflowId,
  preset,
  otherWorkflows,
}: {
  engineWorkflowId: string;
  preset: TriggerPreset;
  otherWorkflows: string[];
}) {
  const fireTestEvent = useFireTestEvent();
  const Form = testEventFormFor(preset);

  const runner: TestEventRunner = {
    fire: (target, payload) => fireTestEvent(target, payload, TEST_RUN_ORIGIN),
    renderOutcome: (triggerId) => (
      <TestRunOutcome key={triggerId} triggerId={triggerId} engineWorkflowId={engineWorkflowId} mode="event" />
    ),
    submitLabel: "Run test",
  };

  return (
    <>
      <div className="space-y-3 border-b pb-4">
        <p className="text-xs text-muted-foreground">
          Publishes a sample <span className="font-mono">{preset.event}</span> exactly like a real one. This workflow's
          trigger conditions apply, and its overlays and chat actions happen for real.
        </p>
        {otherWorkflows.length > 0 && (
          <Alert
            className="border-amber-500/40 text-amber-600 dark:text-amber-400"
            data-testid="test-run-others-warning"
          >
            <AlertTriangle className="h-4 w-4 !text-amber-500" />
            <AlertTitle>Other workflows will run too</AlertTitle>
            <AlertDescription className="text-xs text-foreground/80">
              <p>These enabled workflows also listen for this event, and the sample starts them as well:</p>
              <ul className="mt-1 list-disc pl-4">
                {otherWorkflows.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
              <p className="mt-1">Use "This workflow only" to run just this one.</p>
            </AlertDescription>
          </Alert>
        )}
      </div>
      <Form key={preset.id} preset={preset} runner={runner} />
    </>
  );
}

function DirectTest({ engineWorkflowId, hasEventTrigger }: { engineWorkflowId: string; hasEventTrigger: boolean }) {
  const { instance } = useInstance();
  const { toast } = useToast();
  const trigger = useAction(api.workflowActions.trigger);
  const [busy, setBusy] = useState(false);
  const [triggerId, setTriggerId] = useState<string | null>(null);

  const run = async () => {
    if (!instance) {
      return;
    }
    setBusy(true);
    setTriggerId(null);
    try {
      const result = await trigger({
        instanceId: instance._id,
        workflowNameOrId: engineWorkflowId,
        origin: TEST_RUN_ORIGIN,
      });
      setTriggerId(result.triggerId);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Test run could not be started",
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex-1 overflow-y-auto space-y-2 text-xs text-muted-foreground">
        <p>Starts this workflow alone, right now. No other workflow runs.</p>
        {hasEventTrigger && (
          <p>
            Its trigger conditions are skipped, and it receives no sample event: steps that read{" "}
            <span className="font-mono">trigger.data</span> get empty values. Use "Sample event" to test with event
            data.
          </p>
        )}
      </div>
      <div className="mt-4 pt-4 border-t shrink-0 space-y-3">
        <Button
          type="button"
          className="w-full gap-2"
          disabled={busy || !instance}
          onClick={() => void run()}
          data-testid="button-test-run-direct"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {busy ? "Starting…" : "Run now"}
        </Button>
        {triggerId && (
          <TestRunOutcome key={triggerId} triggerId={triggerId} engineWorkflowId={engineWorkflowId} mode="direct" />
        )}
      </div>
    </div>
  );
}

/**
 * How this workflow's test run went, live. Keyed by `triggerId`, so a new test
 * starts a new wait.
 */
function TestRunOutcome({
  triggerId,
  engineWorkflowId,
  mode,
}: {
  triggerId: string;
  engineWorkflowId: string;
  mode: TestMode;
}) {
  const { instance } = useInstance();
  const [waitElapsed, setWaitElapsed] = useState(false);
  const rows = useQuery(
    api.transientEvents.listByCorrelation,
    instance ? { instanceId: instance._id, correlationKey: triggerId } : "skip"
  );

  useEffect(() => {
    const timer = setTimeout(() => setWaitElapsed(true), TEST_EVENT_OUTCOME_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  const { outcome, executionId, otherWorkflowCount } = testRunProgress(rows, engineWorkflowId, waitElapsed);

  return (
    <div className="space-y-3" data-testid="test-run-outcome">
      {outcome.kind === "waiting" && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
          Waiting for the engine to start the run…
        </p>
      )}
      {outcome.kind === "running" && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="test-run-running">
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
          Running…
        </p>
      )}
      {outcome.kind === "succeeded" && (
        <p className="flex items-center gap-2 text-xs text-green-500" data-testid="test-run-succeeded">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          The test run completed.
        </p>
      )}
      {outcome.kind === "nothingMatched" && (
        <p className="text-xs text-muted-foreground" data-testid="test-run-silent">
          {mode === "event"
            ? "This workflow did not run. Its trigger conditions may have filtered out the sample event."
            : "The engine did not start the run. Check that the workflow service is running."}
        </p>
      )}
      {outcome.kind === "failed" && (
        <div className="flex items-start gap-2 text-xs" data-testid="test-run-failed">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-red-500" />
          <div className="min-w-0">
            <p className="font-medium text-red-500">{outcome.title}</p>
            <p className="text-muted-foreground mt-0.5">{outcome.detail}</p>
          </div>
        </div>
      )}
      {otherWorkflowCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {otherWorkflowCount === 1
            ? "1 other workflow also ran from this event."
            : `${otherWorkflowCount} other workflows also ran from this event.`}
        </p>
      )}
      {instance && executionId && (
        <TestRunSteps instanceId={instance._id} engineWorkflowId={engineWorkflowId} engineRunId={executionId} />
      )}
    </div>
  );
}

/**
 * The run's steps as the engine records them. Read from the recorded run
 * rather than polled from the engine: the rows arrive by webhook and Convex
 * pushes each one here, so the list advances without a request per tick.
 */
function TestRunSteps({
  instanceId,
  engineWorkflowId,
  engineRunId,
}: {
  instanceId: Id<"instances">;
  engineWorkflowId: string;
  engineRunId: string;
}) {
  const data = useQuery(api.workflowRuns.runWithSteps, { instanceId, engineRunId });
  const timeline = useMemo(() => (data ? buildTimeline(data.run, data.steps) : null), [data]);

  return (
    <div className="space-y-2 rounded-md border p-3" data-testid="test-run-steps">
      {timeline === null ? (
        <p className="text-xs text-muted-foreground">Waiting for the run's steps…</p>
      ) : timeline.steps.length === 0 ? (
        <p className="text-xs text-muted-foreground">No steps have run yet.</p>
      ) : (
        <ol className="space-y-1.5">
          {timeline.steps.map((step) => {
            const style = TONE_STYLE[step.tone];
            const Icon = style.icon;
            return (
              <li key={step.key} className="flex items-center gap-2 text-xs">
                <Icon className={cn("h-3.5 w-3.5 shrink-0", style.color, style.spin && "animate-spin")} />
                <span className="min-w-0 flex-1 truncate">{step.label}</span>
                <span className="shrink-0 text-muted-foreground">{formatDuration(step.durationMs)}</span>
              </li>
            );
          })}
        </ol>
      )}
      <Link
        href={workflowRunPath(engineWorkflowId, engineRunId)}
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        data-testid="link-test-run-trace"
      >
        Open run trace
        <ExternalLink className="h-3 w-3" />
      </Link>
    </div>
  );
}
