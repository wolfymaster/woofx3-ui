import { api } from "@convex/_generated/api";
import { REPLAY_ORIGIN } from "@convex/lib/manualRunOrigin";
import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useLocation, useParams } from "wouter";
import { ReplayControls } from "@/components/alert-run/replay-controls";
import { RunTrace } from "@/components/alert-run/run-trace";
import { EditorBackLink } from "@/components/layout/editor-back-link";
import { Badge } from "@/components/ui/badge";
import { useInstance } from "@/hooks/use-instance";
import { decodeRouteParam } from "@/lib/route-param";
import { workflowRunsPath } from "@/lib/workflow-run-route";

/**
 * One recorded run of a workflow as a trace, reached from the workflow's Runs
 * panel or a test run. The same trace the alert feed opens, with a back link to
 * the workflow; replays started here are recorded, so they join its runs.
 */
export default function WorkflowRun() {
  const params = useParams<{ id: string; engineRunId: string }>();
  const engineWorkflowId = decodeRouteParam(params.id);
  const engineRunId = decodeRouteParam(params.engineRunId);
  const [, navigate] = useLocation();
  const { instance } = useInstance();
  // The same subscription RunTrace makes, so Convex serves both from one.
  const recorded = useQuery(
    api.workflowRuns.runWithSteps,
    instance ? { instanceId: instance._id, engineRunId } : "skip"
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 border-b px-2 py-2 sm:h-16 sm:px-4 sm:py-0">
        <EditorBackLink label="workflow" onClick={() => navigate(workflowRunsPath(engineWorkflowId))} />
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-[17px] font-semibold leading-tight">
            Workflow run
            {recorded?.run.dryRun && (
              <Badge variant="outline" className="text-[10px] font-normal" data-testid="badge-dry-run">
                Dry run
              </Badge>
            )}
          </h1>
          <p className="truncate font-mono text-[13px] text-muted-foreground">{engineRunId}</p>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-[1200px] p-4 sm:p-6">
          {!instance ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : (
            <RunTrace
              instanceId={instance._id}
              engineRunId={engineRunId}
              actions={({ failedStepTaskId }) => (
                <ReplayControls
                  instanceId={instance._id}
                  engineRunId={engineRunId}
                  failedStepTaskId={failedStepTaskId}
                  origin={REPLAY_ORIGIN}
                />
              )}
            />
          )}
        </div>
      </div>
    </div>
  );
}
