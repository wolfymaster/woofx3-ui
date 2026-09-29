import { api } from "@convex/_generated/api";
import { dryRunWouldDo } from "@convex/lib/engineTestRun";
import { TEST_RUN_ORIGIN } from "@convex/lib/manualRunOrigin";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AlertCircle, AlertTriangle, CheckCircle2, ExternalLink, Loader2, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { TONE_STYLE } from "@/components/alert-run/tone-style";
import { testEventFormFor } from "@/components/test-events/registry";
import { TEST_EVENT_OUTCOME_TIMEOUT_MS, type TestEventRunner } from "@/components/test-events/test-event-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useFireTestEvent } from "@/hooks/use-fire-test-event";
import { useInstance } from "@/hooks/use-instance";
import {
  rememberOptionsUnsupported,
  type TestRunOptionsState,
  useTestRunOptions,
} from "@/hooks/use-test-run-capabilities";
import { useToast } from "@/hooks/use-toast";
import type { TestEventOutcome } from "@/lib/test-event-outcome";
import { cn } from "@/lib/utils";
import type { TriggerPreset } from "@/lib/workflow-presets";
import { workflowRunPath } from "@/lib/workflow-run-route";
import { buildTimeline, formatDuration } from "@/lib/workflow-run-timeline";
import {
  describeUnmetCondition,
  isStickyOutcome,
  presetPlatform,
  resolveTestRunOutcome,
  sampleEventRefusal,
  testRunProgress,
} from "@/lib/workflow-test-run";

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
  const { instance } = useInstance();
  const optionsState = useTestRunOptions(instance?._id);
  const takesOptions = optionsState === "supported";
  // Null until someone picks a tab, so the default follows what loads in:
  // this workflow alone once the engine can hand it the sample, otherwise the
  // sample event, which is then the only way to test with event data.
  const [pickedMode, setPickedMode] = useState<TestMode | null>(null);
  const refusal = sampleEventRefusal(preset?.event);
  const samplePreset = preset && !refusal ? preset : null;
  const activeMode: TestMode = samplePreset ? (pickedMode ?? (takesOptions ? "direct" : "event")) : "direct";

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
            {samplePreset && (
              <Tabs value={activeMode} onValueChange={(value) => setPickedMode(value as TestMode)}>
                <TabsList className="w-full">
                  <TabsTrigger value="direct" className="flex-1" data-testid="tab-test-run-direct">
                    This workflow only
                  </TabsTrigger>
                  <TabsTrigger value="event" className="flex-1" data-testid="tab-test-run-event">
                    Publish sample event
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            )}
            {refusal && (
              <p className="text-xs text-muted-foreground" data-testid="test-run-sample-refused">
                {refusal} Publishing a sample event is not offered for this trigger; the test below runs this workflow
                alone.
              </p>
            )}

            {activeMode === "event" && samplePreset ? (
              <SampleEventTest
                engineWorkflowId={engineWorkflowId}
                workflowName={workflowName}
                preset={samplePreset}
                otherWorkflows={otherWorkflows}
              />
            ) : (
              <DirectTest engineWorkflowId={engineWorkflowId} preset={preset} optionsState={optionsState} />
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** A sample waiting on the person's confirmation, and how to answer the form that fired it. */
interface PendingSample {
  preset: TriggerPreset;
  payload: object;
  resolve: (triggerId: string | null) => void;
}

function SampleEventTest({
  engineWorkflowId,
  workflowName,
  preset,
  otherWorkflows,
}: {
  engineWorkflowId: string;
  workflowName: string;
  preset: TriggerPreset;
  otherWorkflows: string[];
}) {
  const fireTestEvent = useFireTestEvent();
  const Form = testEventFormFor(preset);
  const [pending, setPending] = useState<PendingSample | null>(null);

  // Firing waits on the confirmation dialog: the form stays busy until the
  // person either confirms, which publishes, or backs out, which publishes nothing.
  const runner: TestEventRunner = {
    fire: (target, payload) =>
      new Promise<string | null>((resolve) => {
        setPending({ preset: target, payload, resolve });
      }),
    renderOutcome: (triggerId) => (
      <TestRunOutcome key={triggerId} triggerId={triggerId} engineWorkflowId={engineWorkflowId} mode="event" />
    ),
    submitLabel: "Run test",
  };

  const answer = async (confirmed: boolean) => {
    if (!pending) {
      return;
    }
    const { preset: target, payload, resolve } = pending;
    setPending(null);
    resolve(confirmed ? await fireTestEvent(target, payload, TEST_RUN_ORIGIN) : null);
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
              <p>At least these enabled workflows also listen for this event, and the sample starts them as well:</p>
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

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) {
            void answer(false);
          }
        }}
      >
        <AlertDialogContent data-testid="test-run-sample-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Publish a real {preset.event}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  The sample is indistinguishable from the real event. Everything that reacts to it does so for real:
                </p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>
                    {otherWorkflows.length > 0
                      ? `${workflowName} and at least ${otherWorkflows.length === 1 ? "1 other workflow" : `${otherWorkflows.length} other workflows`} run, chat and other actions included.`
                      : `${workflowName} runs, chat and other actions included, along with any workflow that listens for it.`}
                  </li>
                  <li>Overlays play any alert those workflows send.</li>
                  <li>Browser-source widgets listening for the event receive it.</li>
                  <li>The dashboard's alert feed records it.</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Don't publish</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void answer(true);
              }}
              data-testid="button-test-run-sample-confirm"
            >
              Publish sample
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** One "This workflow only" run: what was asked, and how the engine answered. */
interface DirectAttempt {
  triggerData: Record<string, unknown> | undefined;
  dryRun: boolean;
  result: FunctionReturnType<typeof api.workflowActions.trigger>;
}

function DirectTest({
  engineWorkflowId,
  preset,
  optionsState,
}: {
  engineWorkflowId: string;
  preset: TriggerPreset | null;
  optionsState: TestRunOptionsState;
}) {
  const { instance } = useInstance();
  const { toast } = useToast();
  const trigger = useAction(api.workflowActions.trigger);
  const takesOptions = optionsState === "supported";
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState<DirectAttempt | null>(null);
  // The person's choice. The switch shows it only while the engine can honour
  // it: showing it on for an engine that cannot would promise a run that does
  // nothing while every step happens for real.
  const [wantsDryRun, setWantsDryRun] = useState(true);
  const dryRun = takesOptions && wantsDryRun;
  const withSample = takesOptions && preset !== null;

  const run = async (
    triggerData: Record<string, unknown> | undefined,
    skipConditions: boolean
  ): Promise<string | null> => {
    if (!instance) {
      return null;
    }
    setBusy(true);
    setAttempt(null);
    try {
      const result = await trigger({
        instanceId: instance._id,
        workflowNameOrId: engineWorkflowId,
        origin: TEST_RUN_ORIGIN,
        options: takesOptions
          ? {
              triggerData,
              platform: triggerData && preset ? presetPlatform(preset) : undefined,
              skipConditions: triggerData ? skipConditions : undefined,
              dryRun: dryRun || undefined,
            }
          : undefined,
      });
      if (result.optionsIgnored) {
        rememberOptionsUnsupported(instance._id);
      }
      setAttempt({ triggerData, dryRun, result });
      return result.triggerId;
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Test run could not be started",
        description: err instanceof Error ? err.message : String(err),
      });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const outcome = attempt ? (
    <DirectOutcome
      key={attempt.result.triggerId}
      attempt={attempt}
      engineWorkflowId={engineWorkflowId}
      busy={busy}
      onRunAnyway={() => void run(attempt.triggerData, true)}
    />
  ) : null;

  const settings = (
    <div className="space-y-3 text-xs text-muted-foreground">
      <p>Starts this workflow alone, right now. No other workflow runs.</p>
      {withSample ? (
        <p>
          The fields below become its <span className="font-mono">trigger.data</span>, and its trigger conditions are
          checked against them.
        </p>
      ) : (
        preset !== null && (
          <p>
            Its trigger conditions are skipped, and it receives no sample event: steps that read{" "}
            <span className="font-mono">trigger.data</span> get empty values.
            {optionsState === "unsupported" && " Sample data needs the engine update that adds it."}
          </p>
        )
      )}
      {!dryRun && (
        <Alert className="border-amber-500/40 text-amber-600 dark:text-amber-400" data-testid="test-run-direct-warning">
          <AlertTriangle className="h-4 w-4 !text-amber-500" />
          <AlertTitle>Its actions happen for real</AlertTitle>
          <AlertDescription className="text-xs text-foreground/80">
            Chat messages are sent, alerts play on your overlays, and every other step does what it does live.
          </AlertDescription>
        </Alert>
      )}
      <div className="flex items-start justify-between gap-4 rounded-md border p-3">
        <div className="space-y-0.5">
          <Label htmlFor="test-run-dry-run" className="text-foreground">
            Dry run (describe, don't do)
          </Label>
          <p>Steps with side effects report what they would do instead of doing it.</p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* Wrapped so the tooltip still opens over a disabled switch, which receives no pointer events. */}
            <span>
              <Switch
                id="test-run-dry-run"
                checked={dryRun}
                onCheckedChange={setWantsDryRun}
                disabled={!takesOptions}
                data-testid="switch-test-run-dry-run"
              />
            </span>
          </TooltipTrigger>
          {!takesOptions && <TooltipContent>{DRY_RUN_UNAVAILABLE[optionsState]}</TooltipContent>}
        </Tooltip>
      </div>
    </div>
  );

  if (withSample && preset) {
    const Form = testEventFormFor(preset);
    const runner: TestEventRunner = {
      fire: (_target, payload) => run(payload as Record<string, unknown>, false),
      // The form's key only says a run was asked for; what the engine said
      // lives here, and "Run anyway" replaces it without the form knowing.
      renderOutcome: () => outcome,
      submitLabel: dryRun ? "Dry run" : "Run now",
    };
    return (
      <>
        <div className="border-b pb-4">{settings}</div>
        <Form key={preset.id} preset={preset} runner={runner} />
      </>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex-1 overflow-y-auto">{settings}</div>
      <div className="mt-4 pt-4 border-t shrink-0 space-y-3">
        <Button
          type="button"
          className="w-full gap-2"
          disabled={busy || !instance}
          onClick={() => void run(undefined, false)}
          data-testid="button-test-run-direct"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {busy ? "Starting…" : dryRun ? "Dry run" : "Run now"}
        </Button>
        {outcome}
      </div>
    </div>
  );
}

const DRY_RUN_UNAVAILABLE: Record<Exclude<TestRunOptionsState, "supported">, string> = {
  checking: "Checking what the engine supports…",
  unsupported: "Needs an engine update",
  unknown: "Could not reach the engine to check",
};

function DirectOutcome({
  attempt,
  engineWorkflowId,
  busy,
  onRunAnyway,
}: {
  attempt: DirectAttempt;
  engineWorkflowId: string;
  busy: boolean;
  onRunAnyway: () => void;
}) {
  const { result } = attempt;

  if (result.status === "conditions_not_met") {
    return (
      <div className="space-y-2 text-xs" data-testid="test-run-conditions-not-met">
        <p className="font-medium text-amber-600 dark:text-amber-400">
          The sample doesn't match this workflow's trigger conditions, so it did not run.
        </p>
        <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
          {result.unmetConditions.map((condition) => (
            <li key={`${condition.field}:${condition.operator}`} className="font-mono">
              {describeUnmetCondition(condition)}
            </li>
          ))}
        </ul>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={onRunAnyway}
          data-testid="button-test-run-skip-conditions"
        >
          Run anyway (skip conditions)
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {result.optionsIgnored && (
        <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="test-run-options-ignored">
          This engine doesn't take sample data or dry runs yet, so the workflow ran without them, for real.
        </p>
      )}
      <TestRunOutcome
        triggerId={result.triggerId}
        engineWorkflowId={engineWorkflowId}
        mode="direct"
        knownExecutionId={result.executionId}
        dryRun={result.dryRun}
      />
    </div>
  );
}

/**
 * How this workflow's test run went, live. Keyed by `triggerId`, so a new test
 * starts a new wait.
 *
 * The live rows expire a minute after they are written, so the run's id and
 * the last answer they gave are kept here, and the recorded run takes over
 * once its id is known -- a long run still reads correctly after they go.
 */
function TestRunOutcome({
  triggerId,
  engineWorkflowId,
  mode,
  knownExecutionId = null,
  dryRun = false,
}: {
  triggerId: string;
  engineWorkflowId: string;
  mode: TestMode;
  /** The run's id when the engine answered with it, ahead of any lifecycle row. */
  knownExecutionId?: string | null;
  dryRun?: boolean;
}) {
  const { instance } = useInstance();
  const [waitElapsed, setWaitElapsed] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(knownExecutionId);
  const [sticky, setSticky] = useState<TestEventOutcome | null>(null);
  const rows = useQuery(
    api.transientEvents.listByCorrelation,
    instance ? { instanceId: instance._id, correlationKey: triggerId } : "skip"
  );
  const recorded = useQuery(
    api.workflowRuns.runWithSteps,
    instance && executionId ? { instanceId: instance._id, engineRunId: executionId } : "skip"
  );

  useEffect(() => {
    const timer = setTimeout(() => setWaitElapsed(true), TEST_EVENT_OUTCOME_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  const progress = testRunProgress(rows, engineWorkflowId, waitElapsed);
  const liveOutcome = progress.outcome;

  useEffect(() => {
    if (progress.executionId) {
      setExecutionId((current) => current ?? progress.executionId);
    }
  }, [progress.executionId]);

  useEffect(() => {
    if (isStickyOutcome(liveOutcome)) {
      setSticky(liveOutcome);
    }
  }, [liveOutcome]);

  const outcome = resolveTestRunOutcome(liveOutcome, sticky, recorded?.run ?? null);
  const isDryRun = dryRun || recorded?.run.dryRun === true;

  return (
    <div className="space-y-3" data-testid="test-run-outcome">
      {isDryRun && (
        <Badge variant="outline" className="text-[10px]" data-testid="test-run-dry-run-badge">
          Dry run: nothing left the engine
        </Badge>
      )}
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
      {progress.otherWorkflowCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {progress.otherWorkflowCount === 1
            ? "1 other workflow also ran from this event."
            : `${progress.otherWorkflowCount} other workflows also ran from this event.`}
        </p>
      )}
      {executionId && <TestRunSteps engineWorkflowId={engineWorkflowId} engineRunId={executionId} data={recorded} />}
    </div>
  );
}

type RecordedRun = FunctionReturnType<typeof api.workflowRuns.runWithSteps>;

/**
 * The run's steps as the engine records them. Read from the recorded run
 * rather than polled from the engine: the rows arrive by webhook and Convex
 * pushes each one here, so the list advances without a request per tick.
 */
function TestRunSteps({
  engineWorkflowId,
  engineRunId,
  data,
}: {
  engineWorkflowId: string;
  engineRunId: string;
  data: RecordedRun | undefined;
}) {
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
            const wouldDo = dryRunWouldDo(step.outputs ?? undefined);
            return (
              <li key={step.key} className="text-xs">
                <div className="flex items-center gap-2">
                  <Icon className={cn("h-3.5 w-3.5 shrink-0", style.color, style.spin && "animate-spin")} />
                  <span className="min-w-0 flex-1 truncate">{step.label}</span>
                  <span className="shrink-0 text-muted-foreground">{formatDuration(step.durationMs)}</span>
                </div>
                {wouldDo && (
                  <p className="pl-[1.375rem] text-muted-foreground" data-testid={`test-run-would-do-${step.taskId}`}>
                    Would: {wouldDo}
                  </p>
                )}
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
