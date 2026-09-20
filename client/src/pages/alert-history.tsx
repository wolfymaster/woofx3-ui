import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { History } from "lucide-react";
import { useState } from "react";
import { useSearch } from "wouter";
import { ReplayControls } from "@/components/alert-history/replay-controls";
import { RunList } from "@/components/alert-history/run-list";
import { RunTimeline } from "@/components/alert-history/run-timeline";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useInstance } from "@/hooks/use-instance";

const RUN_LIMIT = 100;

/** The run a link asked for, or null when it asked for none. */
function runFromSearch(search: string): string | null {
  const run = new URLSearchParams(search).get("run");
  return run && run.length > 0 ? run : null;
}

/**
 * Every workflow run the engine recorded, with a timeline of what each one did.
 *
 * Runs fired by hand from the dashboard are not here: the engine does not record
 * them, because whoever fired one was already watching it happen.
 */
export default function AlertHistory() {
  const { instance } = useInstance();
  const search = useSearch();
  const runs = useQuery(
    api.workflowRuns.listForInstance,
    instance ? { instanceId: instance._id, limit: RUN_LIMIT } : "skip"
  );
  // `?run=` is how the Alerts dashboard hands over the run behind an alert.
  // Read once as the initial selection rather than watched: after landing, the
  // person's clicks in the list decide what is shown, and re-reading the
  // unchanged parameter would drag them back.
  const [selectedRunId, setSelectedRunId] = useState<string | null>(() => runFromSearch(search));

  // Nothing chosen yet means the newest run, so the page opens on something
  // rather than an empty pane.
  const activeRunId = selectedRunId ?? runs?.[0]?.engineRunId ?? null;

  return (
    <div className="container mx-auto p-6">
      <PageHeader
        title="Alert History"
        description="What your workflows did when events arrived — the trigger, every step, and the payloads they used."
      />

      {!instance || runs === undefined ? (
        <Card className="space-y-3 p-4" data-testid="alert-history-loading">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </Card>
      ) : runs.length === 0 ? (
        <EmptyState
          icon={History}
          title="No runs recorded yet"
          description="Runs appear here as workflows respond to follows, subs, cheers and other events. Test fires from the dashboard are not recorded."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <Card className="max-h-[70vh] overflow-y-auto">
            <RunList runs={runs} selectedRunId={activeRunId} onSelect={setSelectedRunId} />
          </Card>
          <Card className="min-h-[20rem]">
            {activeRunId && (
              <RunTimeline
                instanceId={instance._id}
                engineRunId={activeRunId}
                actions={({ failedStepTaskId }) => (
                  <ReplayControls
                    instanceId={instance._id}
                    engineRunId={activeRunId}
                    failedStepTaskId={failedStepTaskId}
                  />
                )}
              />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
