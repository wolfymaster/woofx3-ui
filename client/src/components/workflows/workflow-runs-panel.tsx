import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { REPLAY_ORIGIN } from "@convex/lib/manualRunOrigin";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { History, Loader2, RotateCcw, Square } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { TONE_STYLE } from "@/components/alert-run/tone-style";
import { EmptyState } from "@/components/common/empty-state";
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
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useTestRunSupport } from "@/hooks/use-test-run-capabilities";
import { useToast } from "@/hooks/use-toast";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import { describeAlertFailure } from "@/lib/alert-failure";
import { formatTimeAgo } from "@/lib/time-ago";
import { cn } from "@/lib/utils";
import { workflowRunPath } from "@/lib/workflow-run-route";
import { canReplayRun, describeStopOutcome, isActiveRun, runDurationMs, runOriginLabel } from "@/lib/workflow-run-rows";
import { formatDuration, toneFor } from "@/lib/workflow-run-timeline";

type RunDoc = FunctionReturnType<typeof api.workflowRuns.listForWorkflow>[number];

const RUN_LIMIT = 50;
const CLOCK_TICK_MS = 1000;

interface WorkflowRunsPanelProps {
  instanceId: Id<"instances">;
  engineWorkflowId: string;
}

/**
 * A workflow's recorded runs, newest first, each opening its trace.
 *
 * Read from Convex's mirror of the engine's history, which webhooks keep
 * current, so a run appears and settles here without polling. Runs someone
 * fired by hand outside a test are not recorded by the engine and so are not
 * listed.
 */
export function WorkflowRunsPanel({ instanceId, engineWorkflowId }: WorkflowRunsPanelProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const runs = useQuery(api.workflowRuns.listForWorkflow, {
    instanceId,
    workflowId: engineWorkflowId,
    limit: RUN_LIMIT,
  });
  const replay = useAction(api.workflowActions.replay);
  const cancelRun = useAction(api.workflowActions.cancelRun);
  const realCancel = useTestRunSupport(instanceId).realCancel;

  const [now, setNow] = useState(() => Date.now());
  const hasActiveRun = runs?.some(isActiveRun) ?? false;
  // Only ticks while a run is going: a settled run's duration never changes.
  useVisibleInterval(() => setNow(Date.now()), CLOCK_TICK_MS, hasActiveRun);

  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [replayTarget, setReplayTarget] = useState<RunDoc | null>(null);
  const [cancelTarget, setCancelTarget] = useState<RunDoc | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  const handleReplay = async (run: RunDoc) => {
    setReplayingId(run.engineRunId);
    try {
      await replay({ instanceId, engineRunId: run.engineRunId, origin: REPLAY_ORIGIN });
      toast({ title: "Replay requested", description: "It will appear at the top of this list when it starts." });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Replay could not be started",
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setReplayingId(null);
    }
  };

  const confirmCancel = async () => {
    if (!cancelTarget) {
      return;
    }
    setIsCancelling(true);
    try {
      const result = await cancelRun({ instanceId, engineRunId: cancelTarget.engineRunId });
      setCancelTarget(null);
      toast(describeStopOutcome(result.outcome, result.status));
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Run could not be stopped",
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsCancelling(false);
    }
  };

  if (runs === undefined) {
    return (
      <div className="space-y-2 p-6" data-testid="workflow-runs-loading">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto w-full max-w-[1200px] p-4 sm:p-6">
        {runs.length === 0 ? (
          <EmptyState
            icon={History}
            title="No runs yet"
            description="Runs appear here as this workflow fires on stream. Use Test run to try it now."
          />
        ) : (
          <Card className="overflow-x-auto">
            <Table data-testid="workflow-runs-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead className="w-[120px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => {
                  const style = TONE_STYLE[toneFor(run.status)];
                  const StatusIcon = style.icon;
                  const friendly = run.error ? describeAlertFailure(run.error) : null;
                  const active = isActiveRun(run);

                  return (
                    <TableRow
                      key={run._id}
                      className="cursor-pointer"
                      onClick={() => navigate(workflowRunPath(engineWorkflowId, run.engineRunId))}
                      data-testid={`row-workflow-run-${run.engineRunId}`}
                    >
                      <TableCell>
                        <Badge variant="secondary" className={cn("gap-1 capitalize", style.color)}>
                          <StatusIcon className={cn("h-3 w-3", style.spin && "animate-spin")} />
                          {run.status}
                        </Badge>
                        {run.dryRun && (
                          <Badge variant="outline" className="ml-1.5 text-[10px]" data-testid="badge-dry-run">
                            Dry run
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground" title={run.startedAt}>
                        {formatTimeAgo(run.startedAt, now)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{runOriginLabel(run.triggeredBy)}</TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {formatDuration(runDurationMs(run, now))}
                      </TableCell>
                      <TableCell className="max-w-[320px]">
                        {run.error && (
                          <span
                            className="block truncate text-xs text-red-500"
                            title={[friendly?.hint, run.error].filter(Boolean).join("\n\n")}
                          >
                            {friendly?.title ?? run.error}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {active && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCancelTarget(run);
                              }}
                              title="Stop run"
                              data-testid={`button-cancel-run-${run.engineRunId}`}
                            >
                              <Square className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {canReplayRun(run) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              disabled={replayingId !== null}
                              onClick={(e) => {
                                e.stopPropagation();
                                setReplayTarget(run);
                              }}
                              title="Replay run"
                              data-testid={`button-replay-run-${run.engineRunId}`}
                            >
                              {replayingId === run.engineRunId ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      <AlertDialog
        open={replayTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setReplayTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replay this run?</AlertDialogTitle>
            <AlertDialogDescription>
              The workflow runs again from the run's recorded trigger event, against its current steps. Its actions
              happen for real: chat messages are sent and alerts play on your overlays. The replay is added to this
              list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Don't replay</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (replayTarget) {
                  void handleReplay(replayTarget);
                }
                setReplayTarget(null);
              }}
              data-testid="button-replay-run-confirm"
            >
              Replay
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCancelTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop this run?</AlertDialogTitle>
            <AlertDialogDescription>
              {realCancel === "supported"
                ? "The engine stops the run: the step in flight is abandoned, though an effect it already sent stands, and no further step runs."
                : "Stopping a run requires the engine test-runs update; on older engines the remaining steps still run, and the run is only marked stopped until it finishes."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCancelling}>Keep it running</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmCancel();
              }}
              disabled={isCancelling}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isCancelling && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Stop run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
