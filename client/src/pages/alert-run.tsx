import { Loader2 } from "lucide-react";
import { useLocation, useParams } from "wouter";
import { ReplayControls } from "@/components/alert-run/replay-controls";
import { RunTrace } from "@/components/alert-run/run-trace";
import { EditorBackLink } from "@/components/layout/editor-back-link";
import { useInstance } from "@/hooks/use-instance";

const ALERTS_PATH = "/stream/alerts";

/**
 * One recorded run as a trace: the trigger that started it, every step it took and
 * the overlay alert it published, on one time axis, with each one's payloads.
 *
 * Reached from a row in the alert feed, which knows the run that published the alert.
 * Runs fired by hand are not here — the engine does not record them, because whoever
 * fired one was already watching it happen.
 */
export default function AlertRun() {
  const params = useParams<{ engineRunId: string }>();
  const engineRunId = decodeParam(params.engineRunId);
  const [, navigate] = useLocation();
  const { instance } = useInstance();

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
                />
              )}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** A route segment decoded; one that is not valid percent-encoding is kept as written, and matches nothing. */
function decodeParam(segment: string | undefined): string {
  if (!segment) {
    return "";
  }
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
