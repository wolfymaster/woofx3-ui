import { REPLAY_ORIGIN } from "@convex/lib/manualRunOrigin";
import { Loader2 } from "lucide-react";
import { useLocation, useParams } from "wouter";
import { ReplayControls } from "@/components/alert-run/replay-controls";
import { RunTrace } from "@/components/alert-run/run-trace";
import { EditorBackLink } from "@/components/layout/editor-back-link";
import { useEngineScope } from "@/engine/context";
import { decodeRouteParam } from "@/lib/route-param";

const ALERTS_PATH = "/stream/alerts";

/**
 * One recorded run as a trace: the trigger that started it, every step it took and
 * the overlay alert it published, on one time axis, with each one's payloads.
 *
 * Reached from a row in the alert feed, which knows the run that published the alert.
 */
export default function AlertRun() {
  const params = useParams<{ engineRunId: string }>();
  const engineRunId = decodeRouteParam(params.engineRunId);
  const [, navigate] = useLocation();
  const { instanceId } = useEngineScope();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 border-b px-2 py-2 sm:h-16 sm:px-4 sm:py-0">
        <EditorBackLink label="alerts" onClick={() => navigate(ALERTS_PATH)} />
        <div className="min-w-0">
          <h1 className="text-[17px] font-semibold leading-tight">Alert run</h1>
          <p className="truncate font-mono text-[13px] text-muted-foreground">{engineRunId}</p>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-[1200px] p-4 sm:p-6">
          {!instanceId ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : (
            <RunTrace
              instanceId={instanceId}
              engineRunId={engineRunId}
              actions={({ failedStepTaskId }) => (
                <ReplayControls
                  instanceId={instanceId}
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
