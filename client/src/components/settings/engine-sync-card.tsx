import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { CheckCircle2, Circle, Loader2, RefreshCw, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

interface EngineSyncCardProps {
  instanceId: Id<"instances">;
}

type StepStatus = "pending" | "running" | "success" | "error";

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "success") {
    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
  }
  if (status === "error") {
    return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  }
  if (status === "running") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />;
  }
  return <Circle className="h-3.5 w-3.5 text-muted-foreground" />;
}

export function EngineSyncCard({ instanceId }: EngineSyncCardProps) {
  const state = useQuery(api.engineSync.getSyncState, { instanceId });
  const syncNow = useAction(api.engineSync.syncNow);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSyncNow = async () => {
    setError(null);
    setPending(true);
    try {
      const res = await syncNow({ instanceId });
      if (!res.scheduled) {
        setError("A sync is already in progress.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  if (state === undefined) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading sync state…
        </CardContent>
      </Card>
    );
  }
  if (state === null) {
    return null;
  }

  const { syncState, currentRun, recentRuns } = state;
  const isRunning = currentRun !== null;
  const lastError = recentRuns.find((r) => r.status === "error");

  const lastSyncedLabel =
    syncState && syncState.lastSyncedAt > 0 ? `${formatDistanceToNow(new Date(syncState.lastSyncedAt))} ago` : "Never";
  const nextSyncLabel = syncState
    ? syncState.nextEligibleAt <= Date.now()
      ? "Now"
      : `in ${formatDistanceToNow(new Date(syncState.nextEligibleAt))}`
    : "—";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Engine Sync</CardTitle>
        <CardDescription>
          Reconciles the Convex mirror with the engine. Runs automatically every ~8 hours when the instance has
          activity.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Last synced</div>
            <div className="mt-1 font-medium">{lastSyncedLabel}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Next sync</div>
            <div className="mt-1 font-medium">{nextSyncLabel}</div>
          </div>
        </div>

        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={handleSyncNow}
            disabled={isRunning || pending}
            data-testid="button-sync-now"
          >
            {isRunning || pending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            {isRunning ? "Syncing…" : "Sync now"}
          </Button>
          {error && <p className="text-xs text-destructive mt-2">{error}</p>}
        </div>

        {currentRun && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {currentRun.steps.filter((s) => s.status === "success").length} of {currentRun.steps.length} steps
                complete
              </p>
              <ul className="space-y-1 text-sm">
                {currentRun.steps.map((s) => (
                  <li key={s.name} className="flex items-center gap-2">
                    <StepIcon status={s.status as StepStatus} />
                    <span className="capitalize">{s.name}</span>
                    {s.status === "success" && (
                      <span className="text-xs text-muted-foreground">({s.itemsProcessed})</span>
                    )}
                    {s.error && <span className="text-xs text-destructive">— {s.error}</span>}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        {!currentRun && lastError && syncState?.status === "error" && (
          <>
            <Separator />
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <p className="font-medium text-destructive">Last sync failed</p>
              <p className="mt-1 text-xs text-destructive/80">{syncState.lastError || "Unknown error"}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Will retry automatically on the next eligible window.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
